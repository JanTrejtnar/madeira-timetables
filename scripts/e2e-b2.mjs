// End-to-end checks: map clipped to the ridden stretch, no map/URL change while typing, full-screen map, departure grid, build stamp.
// Needs the dev server (npx vite --port 5173).   Usage: node scripts/e2e-b2.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import { freezeClock } from './lib-e2e-clock.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--lang=cs-CZ'] });
freezeClock(browser);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
};
const errors = [];
const paths = (page) => page.evaluate(() => [...document.querySelectorAll('.leaflet-overlay-pane path')].map((p) => `${p.getAttribute('stroke-width')}/${p.getAttribute('stroke-opacity')}/${(p.getAttribute('d') || '').length}`));

// 1) desktop: a transfer is drawn full colour for the ride only, the rest faint
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on('pageerror', (e) => errors.push(String(e)));
  const pairs = [['Santana', 'Machico'], ['Porto Moniz', 'Camacha'], ['Calheta', 'Santana'], ['Ribeira Brava', 'Machico'], ['Câmara de Lobos', 'Santana']];
  let found = null;
  for (const [a, b] of pairs) {
    await page.goto(`${base}?from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}&time=08:00`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const p = await paths(page);
    if (p.some((x) => x.startsWith('3/0.6'))) { found = [a, b, p]; break; }
  }
  check('planner: the rest of a line outside the ride is drawn faint (opacity 0.6)', !!found, found ? `${found[0]} -> ${found[1]} ${found[2].filter((x) => /^[35]\//.test(x)).join(' ')}` : '');
  check('planner: the ridden stretch is drawn at full weight', !!found && found[2].some((x) => x.startsWith('6/1/')));
  check('planner: the transfer stop carries a transfer pin', (await page.$$('[data-testid=transfer-pin]')).length >= 1);
  await page.close();
}

// 2) typing does not touch the URL or the map; Enter / a pick does
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(`${base}?from=Funchal&fk=&to=Santana&time=08:00`, { waitUntil: 'networkidle0' });
  await page.click('[data-testid=edit-search]');
  await sleep(500);
  await sleep(1500);
  const urlBefore = await page.evaluate(() => location.search);
  const mapBefore = (await paths(page)).join('|');
  const input = await page.$('input[aria-label="Odkud"]');
  await input.click();
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.type('Camac', { delay: 60 });
  await sleep(500);
  check('typing: the URL is unchanged', (await page.evaluate(() => location.search)) === urlBefore);
  check('typing: the map is unchanged', (await paths(page)).join('|') === mapBefore);
  await page.keyboard.press('Enter');
  await sleep(1200);
  const urlAfter = await page.evaluate(() => location.search);
  check('Enter on a suggestion: the URL follows the pick', urlAfter !== urlBefore && /from=Camacha|fk=/.test(decodeURIComponent(urlAfter)), decodeURIComponent(urlAfter).slice(0, 100));
  await page.close();
}

// 3) phone: full-screen map, grid buttons, build stamp
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(String(e)));
  const data = await (await fetch(`${base}data/schedules.json`)).json();
  const l103 = data.lines.find((l) => l.number === '103');
  await page.goto(`${base}#/line/${l103.id}/0`, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.leaflet-container');
  const btn = await page.$('[data-testid="map-fullscreen"]');
  await btn.evaluate((b) => b.scrollIntoView({ block: 'center' }));
  await btn.tap();
  await sleep(600);
  const r = await page.evaluate(() => { const c = document.querySelector('.leaflet-container').getBoundingClientRect(); return { w: c.width, h: c.height, top: c.top }; });
  check('full screen: the map covers the viewport', r.w >= 389 && r.h >= 843 && r.top === 0, JSON.stringify(r));
  await (await page.$('[data-testid="map-fullscreen"]')).tap();
  await sleep(400);
  const h2 = await page.evaluate(() => document.querySelector('.leaflet-container').getBoundingClientRect().height);
  check('full screen: the close button restores the card', h2 > 250 && h2 < 400, String(h2));
  const touch = await page.evaluate(() => getComputedStyle(document.querySelector('.leaflet-container')).touchAction);
  check('map: one finger pans (touch-action none)', touch === 'none', touch);
  const hs = await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')].filter((b) => /^\d\d:\d\d/.test(b.textContent.trim())).map((b) => Math.round(b.getBoundingClientRect().height)));
  check('departure grid: all time buttons have one height', hs.length > 0 && new Set(hs).size === 1, [...new Set(hs)].join(','));
  await page.evaluate(() => document.querySelector('[data-testid=open-settings]')?.click());
  await sleep(300);
  check('build stamp at the end of the settings page', /v\d+\.\d+\.\d+ · Build: \d{4}-\d\d-\d\d \d\d:\d\d/.test(await page.evaluate(() => document.querySelector('[data-testid="build-info"]')?.textContent ?? '')));
  await page.close();
}

// 4) departure picker: "Odjezd nyní" with date / hour / minute drop-downs (desktop and phone)
for (const [name, vp] of [['desktop', { width: 1400, height: 900 }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }]]) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}?from=Funchal&to=Santana&time=08:00&date=2026-12-07`, { waitUntil: 'networkidle0' });
  await page.click('[data-testid=edit-search]');
  await sleep(1100);
  check(`${name}: no native time / date inputs`, (await page.$('input[type=time], input[type=date]')) === null);
  const val = () => page.$eval('[data-testid=depart-trigger]', (b) => b.dataset.value);
  await page.click('[data-testid=depart-trigger]');
  check(`${name}: the popover has 24 hours and 60 minutes`, (await page.$$('[data-testid=depart-hour] option')).length === 24 && (await page.$$('[data-testid=depart-minute] option')).length === 60);
  await page.select('[data-testid=depart-hour]', '17');
  await page.select('[data-testid=depart-minute]', '45');
  check(`${name}: the drop-downs set 17:45`, (await val()) === '2026-12-07 17:45', await val());
  check(`${name}: the date list has the 8 Dec 2026 holiday`, (await page.$('[data-testid=depart-date] option[value="2026-12-08"]')) !== null);
  const box = await page.$eval('[role=dialog]', (d) => { const r = d.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
  check(`${name}: the popover stays inside the screen`, box.l >= 0 && box.r <= box.w, JSON.stringify(box));
  await page.select('[data-testid=depart-date]', '2026-12-10');
  check(`${name}: picking a day sets the date`, (await val()) === '2026-12-10 17:45', await val());
  await page.keyboard.press('Escape');
  check(`${name}: Escape closes the popover`, (await page.$('[data-testid=depart-hour]')) === null);
  await page.click('[data-testid=depart-trigger]');
  await page.click('[data-testid=depart-now]');
  check(`${name}: "Nyní" returns to Odjezd nyní`, (await val()) === 'now' && /Odjezd nyní/.test(await page.$eval('[data-testid=depart-trigger]', (b) => b.innerText)));
  await page.close();
}

check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
