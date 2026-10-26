// End-to-end check of a line with many branches (96): two sides + destination filter, 08:15 to Corrida with its stops and an estimated arrival.
// Usage: node scripts/e2e-line96.mjs [baseUrl]   (dev server `npx vite --port 5173`)
import puppeteer from 'puppeteer-core';
import { freezeClock } from './lib-e2e-clock.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
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
await page.setRequestInterception(true);
page.on('request', (r) => (/tile\.openstreetmap\.org|cartocdn\.com/.test(r.url()) ? r.abort() : r.continue()));
await page.goto(base, { waitUntil: 'networkidle0' });
const id = await page.evaluate(async () => {
  const d = await (await fetch('data/schedules.json')).json();
  return d.lines.find((l) => l.number === '96').id;
});
await page.evaluate((i) => { location.hash = `#/line/${i}`; }, id);
await sleep(800);
const chips = (sel) => page.evaluate((s) => [...document.querySelectorAll(s + ' button')].map((b) => b.textContent.trim()), sel);
const tabs = await chips('[role=tablist]');
check('two sides instead of one pill per branch', tabs.length === 2 && /Z Funchalu/.test(tabs[0]) && /Do Funchalu/.test(tabs[1]), tabs.join(' | '));
const filt = await chips('[data-testid=dir-filter]');
check('filter: all destinations + one per branch', /Všechny cíle/.test(filt[0]) && filt.some((c) => /Jen Corrida/.test(c)) && filt.some((c) => /Jen Jardim Serra/.test(c)), filt.join(' | '));
const wd = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Pracovní/.test(b.textContent))?.click());
await sleep(300);
const first = await page.evaluate(() => [...document.querySelectorAll('[data-testid=time-end]')].slice(0, 3).map((e) => e.parentElement.textContent));
check('merged list names the destination on each time', first.length === 3 && first.every((t) => /\d\d:\d\d.+/.test(t)), first.join(' | '));
// pick the 08:15 trip to Corrida
const picked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button[aria-pressed]')].find((x) => /^08:15/.test(x.textContent) && /Corrida/.test(x.textContent));
  b?.click();
  return !!b;
});
await sleep(400);
check('08:15 to Corrida exists in the merged list', picked);
const stops = await page.evaluate(() => [...document.querySelectorAll('ol li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
const at = (re) => stops.findIndex((s) => re.test(s));
const iF = at(/^Funchal.*08:15/);
const iE = at(/^Estreito.*08:50/);
const iJ = at(/Jardim da Serra/);
check('its stops: the whole road Funchal 08:15, Estreito 08:50 (printed), Jardim da Serra, Corrida with an estimated time', stops.length > 40 && iF === 0 && iE > 0 && iJ > iE && /^Corrida.*~\d\d:\d\d/.test(stops.at(-1)) && /~\d\d:\d\d/.test(stops[iJ]) && !/~/.test(stops[iE]), `${stops.length} stops; ${stops[0]} | ${stops[iE]} | ${stops[iJ]} | ${stops.at(-1)}`);
check('estimate is labelled', await page.evaluate(() => !!document.querySelector('[data-testid=est-arrival]')));
const route = await page.evaluate(() => document.querySelectorAll('.leaflet-overlay-pane path').length);
check('the route is drawn on the map', route > 0, String(route));
// filter to one destination
await page.evaluate(() => [...document.querySelectorAll('[data-testid=dir-filter] button')].find((b) => /Jen Corrida/.test(b.textContent)).click());
await sleep(300);
const only = await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')].map((b) => b.textContent.trim()).filter((t) => /^\d\d:\d\d/.test(t)).length);
check('the filter keeps only Corrida trips', only > 0 && only < 25, String(only));
// the other side
await page.evaluate(() => [...document.querySelectorAll('[role=tablist] button')][1].click());
await sleep(400);
const back = await chips('[data-testid=dir-filter]');
check('the return side lists origins', /Všechny výchozí/.test(back[0]) && back.some((c) => /Jen z Corrida/.test(c)), back.join(' | '));
const backStops = await page.evaluate(() => [...document.querySelectorAll('ol li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)));
check('a trip is selected on the return side with its stops', backStops.length >= 2, backStops.join(' | '));
check('no page errors', errors.length === 0, errors.join('; '));
await browser.close();
process.exit(failed ? 1 : 0);
