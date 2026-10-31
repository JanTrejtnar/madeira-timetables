// End-to-end check that damaged or missing timetable data never gives a blank screen:
//  1. first visit, the data is truncated            -> the friendly "data unavailable" page (with a retry button), no blank page
//  2. first visit, the data is an HTML error page   -> the same
//  3. a good visit, then a damaged download         -> the app silently runs on the last good copy (Cache Storage)
//  4. data that passes the check but crashes a page -> the error boundary shows a "something went wrong" page (not the data one), the other tabs still work
// Usage: node scripts/e2e-robust.mjs [baseUrl]   (dev server `npx vite --port 5173`)
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

/** A fresh browser profile (own Cache Storage); `schedules(real)` decides what the data request gets: undefined = the real file. */
async function visit(schedules, { hash = '' } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  let real = null;
  page.on('request', async (r) => {
    const u = r.url();
    if (/tile\.openstreetmap\.org|cartocdn\.com|routing\.openstreetmap\.de/.test(u)) return r.abort();
    if (!/\/data\/schedules\.json/.test(u)) return r.continue();
    const body = schedules ? await schedules(async () => (real ??= await (await fetch(u)).text())) : undefined;
    return body === undefined ? r.continue() : r.respond({ status: 200, contentType: 'application/json', body });
  });
  await page.goto(base + hash, { waitUntil: 'networkidle0' });
  return { ctx, page, errors };
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const pageCrashed = (page) => page.evaluate(() => !!document.querySelector('[data-testid=page-error]'));
const unavailable = (page) => page.evaluate(() => !!document.querySelector('[data-testid=data-unavailable]'));
const planner = (page) => page.evaluate(() => !!document.querySelector('[data-testid=search-button]'));

// 1. truncated data, nothing cached
{
  const { ctx, page } = await visit(async (real) => (await real()).slice(0, 5000));
  await sleep(300);
  check('truncated data on a first visit: the friendly page', await unavailable(page), (await bodyText(page)).replace(/\s+/g, ' ').slice(0, 120));
  check('...with the wording and a retry button', /Data jízdních řádů jsou dočasně nedostupná/.test(await bodyText(page)) && (await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Zkusit znovu/.test(b.textContent)))));
  check('...and the page is not blank', (await bodyText(page)).trim().length > 40);
  await ctx.close();
}
// 2. an HTML error page in place of the JSON
{
  const { ctx, page } = await visit(async () => '<!doctype html><html><body>502 Bad Gateway</body></html>');
  await sleep(300);
  check('an HTML error page instead of the data: the friendly page', await unavailable(page));
  await ctx.close();
}
// 2b. data of a shape the app cannot use (lines without directions)
{
  const { ctx, page } = await visit(async (real) => {
    const d = JSON.parse(await real());
    for (const l of d.lines) delete l.directions;
    return JSON.stringify(d);
  });
  await sleep(300);
  check('lines without directions are rejected before they reach the planner', await unavailable(page));
  await ctx.close();
}
// 3. a good visit remembers the data; a damaged download afterwards is covered by it
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  let broken = false;
  let real = null;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', async (r) => {
    const u = r.url();
    if (/tile\.openstreetmap\.org|cartocdn\.com|routing\.openstreetmap\.de/.test(u)) return r.abort();
    if (!/\/data\/schedules\.json/.test(u)) return r.continue();
    if (!broken) return r.continue();
    return r.respond({ status: 200, contentType: 'application/json', body: (real ??= '').slice(0, 3000) });
  });
  await page.goto(base, { waitUntil: 'networkidle0' });
  check('good data: the planner shows', await planner(page));
  real = await page.evaluate(async () => await (await fetch('data/schedules.json')).text());
  await sleep(500);
  const stored = await page.evaluate(async () => {
    const c = await caches.open('dataset-last-good');
    return (await c.keys()).length;
  });
  check('the validated data is kept as the last good copy', stored === 1, `${stored} entry`);
  broken = true;
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(300);
  check('a damaged download afterwards: the app runs on the last good copy', (await planner(page)) && !(await unavailable(page)));
  check('...without any error page', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
// 4. data that passes the check but crashes a page once it is used: the error boundary, the other tabs keep working
{
  const { ctx, page } = await visit(async (real) => {
    const d = JSON.parse(await real());
    // a parish that is not text: valid for the shape check, but the stop suggestions split its name as soon as something is typed
    d.lines.find((l) => l.directions[0]?.stops.length).directions[0].stops[0].par = 7;
    return JSON.stringify(d);
  });
  const logged = [];
  page.on('console', (m) => m.type() === 'error' && logged.push(m.text()));
  check('such data loads normally (the planner shows)', await planner(page) && !(await unavailable(page)));
  await page.click('input[role=combobox]');
  await page.keyboard.type('fun', { delay: 30 });
  await sleep(500);
  check('typing in the planner crashes it into the friendly page, caught by the error boundary', (await pageCrashed(page)) && !(await unavailable(page)) && logged.some((x) => /Rendering failed/.test(x)), logged.join(' | ').slice(0, 100));
  check('...the navigation is still there', await page.evaluate(() => document.querySelectorAll('nav button').length >= 4));
  await page.evaluate(() => { location.hash = '#/departures'; });
  await sleep(500);
  check('...and another page works again', !(await pageCrashed(page)) && !(await unavailable(page)));
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
