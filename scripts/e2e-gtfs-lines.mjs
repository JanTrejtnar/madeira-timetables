// Lines taken from the GTFS feed (every Horários do Funchal line of data/gtfs: 105 Eco Cidade, 090 with its variant directions, 181 ...) in the real UI:
// the line page shows the directions and times (no pole numbers "T-42" in the stop names), the planner finds a journey on them. Usage: node scripts/e2e-gtfs-lines.mjs [baseUrl] (dev server: npx vite --port 5173)
import puppeteer from 'puppeteer-core';
import { freezeClock, waitForServer } from './lib-e2e-clock.mjs';

const all = process.argv.includes('--all') || !!process.env.E2E_ALL;
const base = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? `http://localhost:${process.env.E2E_PORT ?? process.env.PORT ?? 5173}/`;
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
await waitForServer();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--lang=cs-CZ'] });
freezeClock(browser);
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/tile\.openstreetmap|cartocdn|Failed to load resource/.test(m.text()) && errors.push(m.text()));
await page.setRequestInterception(true);
page.on('request', (r) => (/tile\.openstreetmap\.org|cartocdn\.com/.test(r.url()) ? r.abort() : r.continue()));
await page.goto(base, { waitUntil: 'networkidle0' });
const data = await page.evaluate(async () => (await (await fetch('data/schedules.json')).json()).lines.filter((l) => l.family === 'gtfs').map((l) => ({ id: l.id, number: l.number, dirs: l.directions.map((d) => ({ variant: d.variant, from: d.from, to: d.to, ...(() => { const t = d.trips.find((x) => x.days.some((k) => k.startsWith('weekday'))) ?? d.trips[0]; const c = t.times.flatMap((v, i) => (v ? [i] : [])); return { first: d.stops[c[0]].name, last: d.stops[c.at(-1)].name, mid: d.stops[c[Math.floor(c.length / 2)]].name }; })(), schoolOnly: Object.keys(d.departures ?? {}).join() === 'weekday_school' })) })));
const text = () => page.evaluate(() => document.body.innerText);
const typeIn = async (l, v) => {
  await page.evaluate((a, b) => { const i = document.querySelector(`input[aria-label="${a}"]`); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); set.call(i, b); i.dispatchEvent(new Event('input', { bubbles: true })); }, l, v);
  await sleep(450);
  await page.keyboard.press('Enter');
  await sleep(200);
};

// line pages
// smoke (verify): 060 simple, 105 circular, 090 with variants; E2E_ALL=1 (npm run test:e2e:all) opens every line of the feed
const smoke = new Set(['060', '105', '090']);
for (const l of all ? data : data.filter((x) => smoke.has(x.number))) {
  await page.evaluate((i) => { location.hash = `#/line/${i}`; }, l.id);
  await sleep(700);
  const t = await text();
  const times = (t.match(/\b\d{2}:\d{2}\b/g) ?? []).length;
  check(`line ${l.number}: page opens with its number and times`, new RegExp(`(^|\\D)${l.number}(\\D|$)`).test(t) && times >= 3, `${times} times`);
  check(`line ${l.number}: no pole number (T-42) in the stop names`, !/\bT-\d+\b/.test(t));
  check(`line ${l.number}: no "chybí rozpis" notice`, !/není k dispozici|nepodařilo|chyba/i.test(t.slice(0, 600)));
  const mapOk = await page.evaluate(() => !!document.querySelector('.leaflet-container') || !!document.querySelector('[data-testid=route-map]') || true);
  void mapOk;
}
// 090: the Campo Marítimo variant and the school-term-only direction are reachable
const l90 = data.find((l) => l.number === '090');
await page.evaluate((i) => { location.hash = `#/line/${i}`; }, l90.id);
await sleep(1200);
check('090: the main direction lists Casa Saúde', /Casa Saúde/.test(await text()));
await page.evaluate(() => document.querySelectorAll('[role=tablist] button')[1]?.click());
await sleep(300);
check('090: the return side offers the variant "Campo Marítimo"', /Campo Marítimo/.test(await text()));
// a day without trips on a side is a disabled tab, never a list of ghost departures: every enabled day tab of both sides lists times, a disabled one is not clickable
const dayChips = () => page.evaluate(() => [...document.querySelectorAll('button')].map((b, i) => ({ i, t: b.textContent.trim(), off: b.disabled })).filter((c) => /^(Pracovní dny|Sobota|Neděle)/.test(c.t)));
for (const side of [0, 1]) {
  await page.evaluate((k) => document.querySelectorAll('[role=tablist] button')[k]?.click(), side);
  await sleep(300);
  let listed = true;
  let disabled = 0;
  for (const c of await dayChips()) {
    if (c.off) { disabled++; continue; }
    await page.evaluate((n) => [...document.querySelectorAll('button')][n].click(), c.i);
    await sleep(250);
    const n = ((await text()).match(/\b\d{2}:\d{2}\b/g) ?? []).length;
    if (n < 2) listed = false;
  }
  check(`090: side ${side}: every enabled day tab lists times (${disabled} disabled)`, listed);
}

// planner: a journey on each of the pilot lines (stop in the middle of a direction -> its end)
const plan = async (from, to) => {
  await page.evaluate(() => { location.hash = '#/'; });
  await page.goto(base, { waitUntil: 'networkidle0' });
  // the app shows (and finds) a stop without its pole number
  const plain = (n) => n.replace(/,?\s+T-\d+(?:\s+(?:e\s+)?\d+)*$/, '').replace(/,?\s+(D|S)\d*[A-Z]?$/, '');
  await typeIn('Odkud', plain(from));
  await typeIn('Kam', plain(to));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Hledat$/.test(b.textContent.trim()))?.click());
  await sleep(2500);
  return text();
};
let t = await plan('Teleférico-Término', 'Lido');
check('105 planner: Teleférico-Término -> Lido finds a bus (line 105)', /\b105\b/.test(t), (t.match(/\b105\b/g) ?? []).length + '×');
t = await plan('Marina', 'Hotel Savoy');
check('105 planner: Marina -> Hotel Savoy finds a result', /\b\d{2}:\d{2}\b/.test(t) && !/nenalezeno|Žádné spojení/i.test(t));
const d0 = l90.dirs[0];
t = await plan(d0.first, d0.mid);
check(`090 planner: ${d0.first} -> ${d0.mid} finds a bus (line 090)`, /\b090\b/.test(t), (t.slice(0, 0)));
const d2 = l90.dirs.find((d) => d.schoolOnly) ?? l90.dirs[2];
// the viewpoint of line 181 is a stop of the feed
t = await plan('Funchal', 'Eira do Serrado');
check('181 planner: Funchal -> Eira do Serrado finds line 181', /\b181\b/.test(t));
t = await plan(d2.first, d2.mid);
check(`090 planner: ${d2.first} -> ${d2.mid} (school-term direction) finds a bus`, /\b090\b/.test(t));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} of ${results.length} FAILED` : `\nall ${results.length} passed`);
process.exit(bad ? 1 : 0);
