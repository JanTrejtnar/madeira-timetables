// Fare of a mixed connection (a Funchal town bus of Horários do Funchal + intercity buses), against the dev server (npx vite --port 5173):
// Santana -> Porto Moniz at 08:00 (clock frozen on Friday 2026-10-23) goes over Funchal, so some connections mix both tariff zones.
// The two tickets are separate: the card shows a ticket for every bus (no free transfer between the zones), the note about the mixed
// connection is shown, and the total is the sum of the tickets. Checked with the giro card (1,45 € city / 2,00 € intercity) and with no card
// (2,05 € / 2,65 €); the yellow card rides free and shows no ticket lines.
// Usage: node scripts/e2e-fare.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import { freezeClock, waitForServer } from './lib-e2e-clock.mjs';

const base = process.argv[2] ?? `http://localhost:${process.env.E2E_PORT ?? process.env.PORT ?? 5173}/`;
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
await waitForServer();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--lang=cs-CZ'] });
freezeClock(browser);
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = `${base}?from=${encodeURIComponent('Santana')}&to=${encodeURIComponent('Porto Moniz')}&time=08:00`;
const euro = (s) => +s.replace(/[^\d,]/g, '').replace(',', '.');

/** open the planner with the given card; returns the page */
async function open(card) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', (r) => (/tile\.openstreetmap\.org|cartocdn\.com/.test(r.url()) ? r.abort() : r.continue()));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate((c) => localStorage.setItem('fareCard', c), card);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await sleep(1500);
  page.errors = errors;
  return page;
}

/** open the connections one by one until the detail carries the mixed-fare note; returns its fare lines, or null */
async function mixedDetail(page) {
  const n = await page.evaluate(() => document.querySelectorAll('[data-testid=connection]').length);
  for (let i = 0; i < n; i++) {
    await page.evaluate((k) => document.querySelectorAll('[data-testid=connection]')[k].click(), i);
    await sleep(500);
    const d = await page.evaluate(() => {
      const det = document.querySelector('[data-testid=connection-detail]');
      if (!det || !det.querySelector('[data-testid=fare-mixed]')) return null;
      return {
        legs: [...det.querySelectorAll('[data-testid=leg-fare]')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
        buses: det.querySelectorAll('[data-testid=open-leg]').length,
        total: det.querySelector('[data-testid=fare]')?.innerText ?? '',
      };
    });
    if (d) return d;
    await page.goBack().catch(() => {});
    await sleep(300);
  }
  return null;
}

for (const [card, prices, label] of [['blue', [1.45, 2], 'giro card'], ['none', [2.05, 2.65], 'no card']]) {
  const page = await open(card);
  console.log(`--- ${label}`);
  const d = await mixedDetail(page);
  check(`${label}: a connection mixing the city and an intercity bus is offered, with the mixed-fare note`, !!d);
  if (d) {
    const paid = d.legs.filter((l) => /\d/.test(l)).map(euro);
    check(`${label}: every bus has its fare line`, d.legs.length === d.buses, `${d.legs.length} lines, ${d.buses} buses`);
    check(`${label}: the tickets are the city price and the intercity price (no free transfer between the zones)`, paid.includes(prices[0]) && paid.includes(prices[1]) && paid.every((p) => prices.includes(p)), d.legs.join(' | '));
    const sum = Math.round(paid.reduce((s, p) => s + p, 0) * 100) / 100;
    check(`${label}: the total is the sum of the tickets`, euro(d.total) === sum, `${d.total} vs ${sum}`);
  }
  check(`${label}: no page errors`, page.errors.length === 0, page.errors.join('; '));
  await page.close();
}

{
  const page = await open('yellow');
  console.log('--- yellow card');
  await page.evaluate(() => document.querySelector('[data-testid=connection]')?.click());
  await sleep(500);
  const shown = await page.evaluate(() => document.querySelectorAll('[data-testid=leg-fare], [data-testid=fare-mixed], [data-testid=fare]').length);
  check('yellow card: no ticket lines, no mixed note, no price', shown === 0, `${shown} elements`);
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} FAILED of ${results.length}` : `\nAll ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
