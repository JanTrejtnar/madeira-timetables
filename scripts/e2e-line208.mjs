// Line 208 (weekday-only and weekend-only branches): opening it must not loop (the day flipping between weekday and Saturday) and Leaflet must stay quiet.
// Usage: node scripts/e2e-line208.mjs [baseUrl]   (dev server `npx vite --port 5173`)
import puppeteer from 'puppeteer-core';
import { freezeClock, waitForServer } from './lib-e2e-clock.mjs';

const base = process.argv[2] ?? `http://localhost:${process.env.E2E_PORT ?? process.env.PORT ?? 5173}/`;
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
await waitForServer();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--lang=cs-CZ'] });
freezeClock(browser);
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/tile|ERR_FAILED|net::/.test(m.text()) && errors.push(m.text()));
await page.setRequestInterception(true);
page.on('request', (r) => (/tile\.openstreetmap\.org|cartocdn\.com/.test(r.url()) ? r.abort() : r.continue()));
await page.goto(base, { waitUntil: 'networkidle0' });
const id = await page.evaluate(async () => (await (await fetch('data/schedules.json')).json()).lines.find((l) => l.number === '208').id);
await page.evaluate((i) => { location.hash = `#/line/${i}`; }, id);
// sample the active day chip for two seconds: a loop would change it again and again
const seen = [];
for (let i = 0; i < 20; i++) {
  seen.push(await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed=true], button.bg-sky-600, [role=tab][aria-selected=true]')].map((b) => b.textContent.trim()).join('|')));
  await sleep(100);
}
const changes = seen.filter((s, i) => i && s !== seen[i - 1]).length;
check('the selection settles (no flicker)', changes <= 2, `${changes} changes: ${[...new Set(seen)].join(' // ')}`);
const hasTimes = await page.evaluate(() => document.querySelectorAll('button[aria-pressed]').length);
check('times are listed', hasTimes > 0, String(hasTimes));
const route = await page.evaluate(() => document.querySelectorAll('.leaflet-overlay-pane path').length);
check('route is drawn', route > 0, String(route));
const codes = await page.evaluate(() => [...document.querySelectorAll('[data-testid=note-code]')].map((e) => e.textContent));
check('legend notes carry their code as a badge', codes.length > 0, codes.join(','));
// switch the side and the day a few times quickly, with the map mid-animation
for (const label of [/Z Funchalu/, /Do Funchalu/, /Sobota/, /Pracovní/, /Neděle/]) {
  await page.evaluate((src) => [...document.querySelectorAll('button')].find((b) => new RegExp(src).test(b.textContent))?.click(), label.source);
  await sleep(120);
}
await sleep(1200);
check('no console / page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
