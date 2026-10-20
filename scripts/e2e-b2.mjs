// End-to-end checks: map clipped to the ridden stretch, no map/URL change while typing, full-screen map, departure grid, build stamp.
// Needs the dev server (npx vite --port 5173).   Usage: node scripts/e2e-b2.mjs [baseUrl]
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:5173/';
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
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
    if (p.some((x) => x.startsWith('3/0.25'))) { found = [a, b, p]; break; }
  }
  check('planner: the rest of a line outside the ride is drawn faint (opacity 0.25)', !!found, found ? `${found[0]} -> ${found[1]} ${found[2].filter((x) => /^[35]\//.test(x)).join(' ')}` : '');
  check('planner: the ridden stretch is drawn at full weight', !!found && found[2].some((x) => x.startsWith('5/0.9/')));
  check('planner: the transfer stop carries a transfer pin', (await page.$$('[data-testid=transfer-pin]')).length >= 1);
  await page.close();
}

// 2) typing does not touch the URL or the map; Enter / a pick does
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(`${base}?from=Funchal&fk=&to=Santana&time=08:00`, { waitUntil: 'networkidle0' });
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
  check('build stamp in the footer', /v\d+\.\d+\.\d+ · Build: \d{4}-\d\d-\d\d \d\d:\d\d/.test(await page.evaluate(() => document.querySelector('[data-testid="build-info"]')?.textContent ?? '')));
  await page.close();
}

// 4) own 24-hour time picker and calendar (desktop and phone)
for (const [name, vp] of [['desktop', { width: 1400, height: 900 }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }]]) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}?from=Funchal&to=Santana&time=08:00&date=2026-12-07`, { waitUntil: 'networkidle0' });
  await sleep(800);
  check(`${name}: no native time / date inputs`, (await page.$('input[type=time], input[type=date]')) === null);
  await page.click('[data-testid=time-trigger]');
  check(`${name}: the time popover has 24 hours and 12 minute steps`, (await page.$$('[data-testid^="hour-"]')).length === 24 && (await page.$$('[data-testid^="minute-"]')).length === 12);
  await page.click('[data-testid=hour-17]');
  await page.click('[data-testid=minute-45]');
  check(`${name}: hour and minute buttons set 17:45`, (await page.$eval('[data-testid=time-trigger]', (b) => b.dataset.value)) === '17:45');
  await page.focus('[data-testid=time-input]');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.type('2305');
  await page.keyboard.press('Enter');
  check(`${name}: typed 2305 becomes 23:05 (24-hour)`, (await page.$eval('[data-testid=time-trigger]', (b) => b.dataset.value)) === '23:05');
  await page.focus('[data-testid=time-input]');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.type('25:99');
  await page.keyboard.press('Enter');
  check(`${name}: 25:99 is refused`, (await page.$eval('[data-testid=time-trigger]', (b) => b.dataset.value)) === '23:05');
  await page.keyboard.press('Escape');
  check(`${name}: Escape closes the popover`, (await page.$('[data-testid=hour-3]')) === null);
  await page.click('[data-testid=date-trigger]');
  const dec8 = await page.$('[data-date="2026-12-08"]');
  check(`${name}: 8 Dec is marked as a holiday in the calendar`, !!dec8 && (await dec8.evaluate((b) => b.dataset.holiday)) === '1');
  const sunday = await page.$eval('[data-date="2026-12-06"]', (b) => getComputedStyle(b).color);
  const monday = await page.$eval('[data-date="2026-12-09"]', (b) => getComputedStyle(b).color);
  check(`${name}: Sunday is coloured differently from a weekday`, sunday !== monday, `${sunday} vs ${monday}`);
  const box = await page.$eval('[role=dialog]', (d) => { const r = d.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
  check(`${name}: the calendar stays inside the screen`, box.l >= 0 && box.r <= box.w, JSON.stringify(box));
  await page.click('[data-date="2026-12-10"]');
  await sleep(300);
  check(`${name}: picking a day sets the date and closes the calendar`, (await page.$eval('[data-testid=date-trigger]', (b) => b.dataset.value)) === '2026-12-10' && (await page.$('[role=dialog]')) === null);
  await page.close();
}

check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
