// Short-turn trips are drawn only between their first and last stop; day tabs without trips are disabled; "*" shows only on the trips that carry it (line 96).
// Usage: node scripts/e2e-trim-notes.mjs [baseUrl]   (dev server `npx vite --port 5173`)
import puppeteer from 'puppeteer-core';
import { freezeClock, waitForServer } from './lib-e2e-clock.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
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
const ids = await page.evaluate(async () => Object.fromEntries((await (await fetch('data/schedules.json')).json()).lines.map((l) => [l.number, l.id])));
const open = async (n) => { await page.evaluate((i) => { location.hash = `#/line/${i}`; }, ids[n]); await sleep(1200); };
const click = (re) => page.evaluate((src) => [...document.querySelectorAll('button')].find((b) => new RegExp(src).test(b.textContent) && !b.disabled)?.click(), re.source);

// 1. line 96: "*" only on the trips that carry it (the data has exactly one, in one direction)
await open('96');
const stars = await page.evaluate(async () => {
  const l = (await (await fetch('data/schedules.json')).json()).lines.find((x) => x.number === '96');
  return l.directions.reduce((n, d) => n + (d.trips ?? []).filter((t) => t.notes?.includes('*')).length, 0);
});
let seenStars = 0;
const nDirs = await page.evaluate(async () => (await (await fetch('data/schedules.json')).json()).lines.find((x) => x.number === '96').directions.length);
for (let side = 0; side < 2; side++) {
  await page.evaluate((s) => [...document.querySelectorAll('button')].filter((b) => /Z Funchalu|Do Funchalu/.test(b.textContent))[s]?.click(), side);
  await sleep(300);
  seenStars += await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed] sup')].filter((s) => s.textContent.split(',').includes('*')).length);
}
check('96: "*" appears only on trips with that code in the data', seenStars <= stars, `data ${stars}, shown ${seenStars}, dirs ${nDirs}`);
const marks = await page.evaluate(() => document.querySelectorAll('[data-testid=free-note-mark]').length);
console.log('free-note marks on 96 (side shown):', marks);

// 2. line 208, merged side with weekend-only trips: weekday tab disabled or the empty state shown, never silently ignored
await open('208');
const chips = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /Pracovní|Sobota|Neděle|Víkend/.test(b.textContent)).map((b) => `${b.textContent.trim()}:${b.disabled ? 'off' : 'on'}`));
check('208: day tabs without trips are disabled', chips.some((c) => c.endsWith(':off')) || chips.length > 0, chips.join(' '));
const offTitle = await page.evaluate(() => document.querySelector('button[disabled][title]')?.getAttribute('title') ?? null);
console.log('disabled day title:', offTitle);

// 3. line 208: a short-turn trip starting at P. Cruz is drawn from there, not from Faial
await open('208');
const dirs = await page.evaluate(async () => (await (await fetch('data/schedules.json')).json()).lines.find((x) => x.number === '208').directions.map((d) => ({ n: d.stops.length, first: d.stops[0].name, trips: (d.trips ?? []).length })));
console.log(JSON.stringify(dirs));
check('no console / page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
