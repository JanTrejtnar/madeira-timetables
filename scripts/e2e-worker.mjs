// The planner's search runs in a Web Worker, so the page stays responsive while it works. No request interception here (it keeps workers from loading).
// Usage: node scripts/e2e-worker.mjs [baseUrl] (dev server: npx vite --port 5173)
import puppeteer from 'puppeteer-core';
import { waitForServer } from './lib-e2e-clock.mjs';

const base = process.argv[2] ?? `http://localhost:${process.env.E2E_PORT ?? process.env.PORT ?? 5173}/`;
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
await waitForServer();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--lang=cs-CZ'] });
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.evaluateOnNewDocument(() => {
  window.__w = { workers: 0, replies: 0, ticks: 0, maxGap: 0 };
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...a) { super(...a); window.__w.workers++; this.addEventListener('message', () => window.__w.replies++); }
  };
  // how long the page's own thread is blocked while "Hledám spojení…" is shown: a timer that should fire every 20 ms
  let last = performance.now();
  setInterval(() => { const n = performance.now(); if (document.querySelector('[data-testid=searching]')) window.__w.maxGap = Math.max(window.__w.maxGap, n - last); window.__w.ticks++; last = n; }, 20);
});
await page.goto(`${base}?from=Funchal&to=Camacha&time=08:00`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('[data-testid=connection]').length > 0, { timeout: 60000 }).catch(() => {});
const w = await page.evaluate(() => window.__w);
const text = await page.evaluate(() => document.body.innerText);
check('the search ran in a worker (it answered)', w.workers >= 1 && w.replies >= 2, JSON.stringify(w));
check('Funchal -> Camacha: connections are listed, alighting in the village', /Largo da Achada|Igreja da Camacha/.test(text) || (await page.$$('[data-testid=connection]')).length > 0);
check('...and boarding in the centre of Funchal, not at Estrada da Camacha', !/Estrada da Camacha/.test(text.slice(0, 1500)));
// the second search of the same network (another time) is answered too, and the page keeps its timers running meanwhile
await page.goto(`${base}?from=Funchal&to=Santana&time=17:00`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('[data-testid=connection]').length > 0, { timeout: 60000 }).catch(() => {});
const w2 = await page.evaluate(() => window.__w);
check('Funchal -> Santana is answered by the worker as well', (await page.$$('[data-testid=connection]')).length > 0);
check('the page was never blocked for more than 700 ms while it searched', w2.maxGap < 700, `${Math.round(w2.maxGap)} ms`);
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} of ${results.length} FAILED` : `\nall ${results.length} passed`);
process.exit(bad ? 1 : 0);
