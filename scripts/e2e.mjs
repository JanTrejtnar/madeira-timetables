// End-to-end smoke test: drives the running dev server (npm run dev / dev:mobile) in headless Chrome at phone size.
// Text based on purpose (the UI is restyled often).   Usage: node scripts/e2e.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import { freezeClock } from './lib-e2e-clock.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--lang=cs-CZ'] });
freezeClock(browser);
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const text = () => page.evaluate(() => document.body.innerText);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
};
/** click the first button whose text contains `label` */
async function clickButton(label, within = 'body') {
  const handle = await page.evaluateHandle(
    (l, w) => [...document.querySelector(w).querySelectorAll('button')].find((b) => b.offsetParent && (b.innerText || b.getAttribute('aria-label') || '').includes(l)) ?? null,
    label,
    within,
  );
  const el = handle.asElement();
  if (!el) return false;
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' })); // not under the sticky bars
  await el.click();
  await sleep(250);
  return true;
}
const openLine = async (id) => {
  await page.goto(`${base}#/line/${id}`, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('h1,h2'), { timeout: 5000 });
  await sleep(300);
};
const timeCount = (t) => (t.match(/\d\d:\d\d/g) ?? []).length;

const data = await (await fetch(`${base}data/schedules.json`)).json();
const byNum = (n, fam) => data.lines.find((l) => (l.number === n || l.oldNumber === n) && (!fam || l.family === fam));

// 1) lines that must show departure times
for (const [num, fam] of [['007'], ['181'], ['142'], ['20', 'sam'], ['23', 'sam'], ['111', 'sam']]) {
  const l = byNum(num, fam);
  await openLine(l.id);
  const t = await text();
  check(`line ${num}${fam ? ' (' + fam + ')' : ''}: no "could not parse" warning`, !/nepodařilo automaticky/.test(t));
  check(`line ${num}${fam ? ' (' + fam + ')' : ''}: departure times visible`, timeCount(t) >= 2, `${timeCount(t)} times`);
}

// 2) estimated times on an intermediate stop of line 007, real ones on a SAM line
await openLine(byNum('007').id);
check('line 007: selecting a stop works', await clickButton('BP Campo Barca'));
check('line 007: estimated times marked with ~', /~\s?\d\d:\d\d/.test(await text()));
await openLine(byNum('20', 'sam').id);
check('SAM line 20: a stop with printed times is selectable', await clickButton('Rib. Machico'));
const t20 = await text();
check('SAM line 20: mostly printed times at the stop (only Via trips are estimated)', timeCount(t20) > 3 && (t20.match(/~\s?\d\d:\d\d/g) ?? []).length * 4 < timeCount(t20));

// 3) planner
async function planner(from, to, { pick = false, time = '09:00' } = {}) {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(() => (location.hash = ''));
  await clickButton('Plánovač');
  await sleep(300);
  const inputs = await page.$$('input[aria-label]');
  const find = async (label) => {
    for (const i of inputs) if ((await i.evaluate((e) => e.getAttribute('aria-label'))) === label) return i;
    return null;
  };
  const iFrom = await find('Odkud');
  const iTo = await find('Kam');
  await iFrom.type(from, { delay: 15 });
  await sleep(300);
  await page.evaluate(() => document.querySelector('ul li button')?.click());
  await iTo.type(to, { delay: 15 });
  if (pick) {
    await sleep(300);
    await page.evaluate(() => document.querySelector('ul li button')?.click());
  } else await iTo.press('Enter'); // typing alone changes nothing: Enter applies the typed text
  await page.click('[data-testid=depart-trigger]');
  await page.select('[data-testid=depart-hour]', String(Number(time.slice(0, 2))));
  await page.select('[data-testid=depart-minute]', String(Number(time.slice(3, 5))));
  await page.keyboard.press('Escape');
  await page.click('[data-testid=search-button]');
  await sleep(900);
  return text();
}

const typePressed = await (async () => {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await clickButton('Plánovač');
  return page.evaluate(() => [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.innerText.trim()));
})();
check('planner: no filter is active by default (advanced search is collapsed)', typePressed.length === 0 || !typePressed.some((x) => /Rodoeste|SAM|CAM|Horários/.test(x)), JSON.stringify(typePressed));

const t1 = await planner('pinga', 'mercedes');
check('planner: urban connection found (type filter: all) (Pinga -> Mercedes)', /\d\d:\d\d/.test(t1) && /Pinga/.test(t1));
check('planner: estimated arrival flagged with ~', /~\s?\d\d:\d\d/.test(t1));

const t2 = await planner('machico', 'funchal', { time: '07:00' });
check('planner: SAM stops are searchable (Machico -> Funchal)', /Machico/.test(t2) && timeCount(t2) > 4, `${timeCount(t2)} times`);

// ---- selected departure, stop times, notes and map popup (line detail) ----
const idOf = (n) => data.lines.find((l) => l.number === n).id;
const TIME_BTN = /^\d\d:\d\d/;
const gridButtons = () =>
  page.$$eval('button[aria-pressed]', (bs) =>
    bs.filter((b) => /^\d\d:\d\d/.test(b.innerText.trim())).map((b) => ({ t: b.innerText.trim().slice(0, 5), on: b.getAttribute('aria-pressed') === 'true' })),
  );
const clickGrid = async (i) => {
  const hs = await page.$$('button[aria-pressed]');
  const times = [];
  for (const h of hs) if (TIME_BTN.test(await h.evaluate((e) => e.innerText.trim()))) times.push(h);
  await times[i].evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await times[i].click();
  await sleep(300);
};
const stopRows = () => page.$$eval('ol > li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ').trim()));

// line 007: terminal departures only, stop times are estimated from the route length
await openLine(idOf('007'));
let g = await gridButtons();
check('line 007: exactly one departure active by default', g.length > 3 && g.filter((x) => x.on).length === 1, `${g.length} times`);
let rows = await stopRows();
check('line 007: stop list shows real times (~HH:MM), no "+N min" offsets', rows.length > 3 && rows.slice(1).some((r) => /~\d\d:\d\d/.test(r)) && !rows.some((r) => /~\+\d+/.test(r)), rows[1]);
const before = rows[2];
await clickGrid(g.findIndex((x) => !x.on));
g = await gridButtons();
rows = await stopRows();
check('line 007: tapping another time moves the active one and shifts the stop times', g.filter((x) => x.on).length === 1 && rows[2] !== before, `${before} -> ${rows[2]}`);
await page.$$eval('ol > li button[aria-pressed]', (bs) => bs[2].click());
await sleep(1200);
const popup = await page.$eval('.leaflet-popup-content', (e) => e.innerText).catch(() => '');
check('line 007: tapping a stop opens its map popup with name, passing time and map links', /~?\d\d:\d\d/.test(popup) && /Google/i.test(popup), popup.replace(/\s+/g, ' ').slice(0, 90));

// line 181: notes of the selected departure are highlighted, the rest is dimmed
await openLine(idOf('181'));
const withNote = await page.$$eval('button[aria-pressed] sup', (s) => s.length);
check('line 181: departures with note marks are shown', withNote > 0, String(withNote));
const noted = await page.evaluate(() => {
  const all = [...document.querySelectorAll('button[aria-pressed]')].filter((b) => /^\d\d:\d\d/.test(b.innerText.trim()));
  return all.findIndex((b) => b.querySelector('sup'));
});
await clickGrid(Math.max(noted, 0));
const dim = await page.$$eval('li.opacity-40', (l) => l.length);
const lit = await page.$$eval('li.bg-sky-50', (l) => l.length);
check('line 181: notes of the selected time highlighted, others dimmed', dim > 0 && lit > 0, `dimmed ${dim}, highlighted ${lit}`);

// the school period comes from the date, no switch interaction needed
await page.evaluate(() => document.querySelector('[data-testid=open-settings]')?.click());
await new Promise((r) => setTimeout(r, 300));
const schoolLabel = await page.evaluate(() => document.body.innerText.match(/Školní období|Školní prázdniny/)?.[0] ?? '');
check('school period is detected automatically', schoolLabel !== '', schoolLabel);

await page.goto(base, { waitUntil: 'networkidle0' });
console.log(errors.length ? 'console errors:\n' + errors.join('\n') : 'no console errors');
check('no runtime errors', errors.length === 0);
await browser.close();
process.exit(failed ? 1 : 0);
