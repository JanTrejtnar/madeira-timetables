// Connections with two transfers and a walk between the lines (RAPTOR planner), against the dev server (npx vite --port 5173):
// Santana (the parish, as the suggestion list picks it: fk=@par:Santana) -> Porto Moniz at 08:00 (clock frozen on Friday 2026-10-23): the mountains
// leave no other way than over Funchal (103 > 139 / 80), a ride away from the destination that the router offers only when nothing else is found.
// Checks that the first bus really leaves from Santana (not from the Funchal stops named "Santana"), then a connection with three buses (any
// card: Funchal > ... ), the card, the detail (a walk step before every bus reached on foot, the walking total, the duration), and the map legend.
// Usage: node scripts/e2e-transfers.mjs [baseUrl]    Phone and desktop viewport.
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
const url = `${base}?from=${encodeURIComponent('Santana')}&fk=${encodeURIComponent('@par:Santana')}&to=${encodeURIComponent('Porto Moniz')}&tk=${encodeURIComponent('@par:Porto Moniz')}&time=08:00`;
const plainUrl = `${base}?from=${encodeURIComponent('Santana')}&to=${encodeURIComponent('Porto Moniz')}&time=08:00`;

/** "2 h 14 min" / "45 min" -> minutes */
const minutesOf = (s) => {
  const h = /(\d+)\s*h/.exec(s);
  const m = /(\d+)\s*min/.exec(s);
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
};
const clock = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

async function run(label, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/tile\.openstreetmap|cartocdn|Failed to load resource|routed-foot/.test(m.text()) && errors.push(m.text()));
  await page.setRequestInterception(true);
  page.on('request', (r) => (/tile\.openstreetmap\.org|cartocdn\.com/.test(r.url()) ? r.abort() : r.continue()));
  console.log(`--- ${label}`);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(url, { waitUntil: 'networkidle0' });
  await sleep(1500);

  // Santana by its parish: connections exist, and each one starts in Santana (the first stop of the first leg is named in the card)
  // the first row of each card: line, departure time, the stop it leaves from, arrival time, the stop it arrives at
  const santana = await page.evaluate(() => [...document.querySelectorAll('[data-testid=connection]')].map((c) => c.querySelector('[class*="grid-cols-[2.75rem"]')?.innerText.replace(/\s+/g, ' ') ?? ''));
  check(`${label}: Santana -> Porto Moniz (parishes) offers connections`, santana.length > 0, `${santana.length} cards`);
  const origin = (row) => /\d{1,2}:\d{2} (.+?) \d{1,2}:\d{2}/.exec(row)?.[1] ?? '';
  check(`${label}: every connection leaves from a stop outside Funchal (the Funchal stops named "Santana" are not the parish)`, santana.length > 0 && santana.every((r) => origin(r) && !/Funchal|CAM|Rampa/.test(origin(r))), santana.map(origin).join(' | '));
  // plain text "Santana" also matches the Funchal stops of that name: it is the 3-bus case below
  await page.goto(plainUrl, { waitUntil: 'networkidle0' });
  await sleep(1500);

  // the card of a connection with three buses (one row per bus)
  const idx = await page.evaluate(() => [...document.querySelectorAll('[data-testid=connection]')].findIndex((c) => c.querySelectorAll('[class*="grid-cols-[2.75rem"]').length >= 3));
  check(`${label}: the results offer a connection with three buses`, idx >= 0);
  if (idx < 0) { await page.close(); return; }
  const card = await page.evaluate((i) => {
    const c = document.querySelectorAll('[data-testid=connection]')[i];
    const times = [...c.querySelectorAll('span.tabular-nums.font-semibold')].map((s) => s.innerText.match(/\d{1,2}:\d{2}/)?.[0]).filter(Boolean);
    return { times, lines: [...c.querySelectorAll('[class*="grid-cols-[2.75rem"]')].map((g) => g.children[0].innerText.trim()), waits: [...c.querySelectorAll('span')].filter((s) => /^čekání \d+ min$/.test(s.innerText)).length };
  }, idx);
  check(`${label}: the card shows the three lines and two waits`, card.lines.length === 3 && card.waits === 2, JSON.stringify(card.lines));
  await page.evaluate((i) => document.querySelectorAll('[data-testid=connection]')[i].click(), idx);
  await sleep(800);

  const d = await page.evaluate(() => {
    const det = document.querySelector('[data-testid=connection-detail]');
    if (!det) return null;
    return {
      legs: det.querySelectorAll('[data-testid=open-leg]').length,
      transfers: [...det.querySelectorAll('[data-testid=transfer]')].map((p) => p.innerText.replace(/\s+/g, ' ')),
      walks: [...det.querySelectorAll('[data-testid=walk-transfer]')].map((p) => p.innerText.replace(/\s+/g, ' ')),
      total: det.querySelector('[data-testid=walk-total]')?.innerText.replace(/\s+/g, ' ') ?? '',
      // the span next to the date: the duration comes first, then the walking total and the fare
      head: det.querySelector('[data-testid=connection-date]')?.nextElementSibling?.firstChild?.textContent ?? '',
    };
  });
  check(`${label}: the detail opens with three buses`, !!d && d.legs === 3);
  if (!d) { await page.close(); return; }
  check(`${label}: two transfer rows`, d.transfers.length === 2, JSON.stringify(d.transfers));
  check(`${label}: a walking step before each of the buses reached on foot, with minutes and the stop to walk to`, d.walks.length === 2 && d.walks.every((w) => /Pěšky \d+ min na zastávku \S+/.test(w)), JSON.stringify(d.walks));
  const walkSum = d.walks.reduce((s, w) => s + Number(/Pěšky (\d+) min/.exec(w)[1]), 0);
  check(`${label}: the walking total is the sum of the steps (${walkSum} min)`, new RegExp(`chůze celkem ${walkSum} min`).test(d.total), d.total);
  const first = clock(card.times[0]);
  let last = clock(card.times[card.times.length - 1]);
  if (last < first) last += 1440;
  check(`${label}: the duration in the header is the first departure to the last arrival (${first}-${last})`, minutesOf(d.head) === last - first, d.head);
  check(`${label}: the walking step is not counted as waiting (wait + walk = gap between the buses)`, d.transfers.every((t, i) => {
    const wait = Number(/čekání (\d+) min/.exec(t)?.[1]);
    const walk = Number(/Pěšky (\d+) min/.exec(d.walks[i])?.[1]);
    return Number.isFinite(wait) && wait >= 5 && walk >= 1 && /^Přestup · čekání/.test(t);
  }));
  // the map: a legend with three buses, each in its own colour
  const legend = await page.evaluate(() => [...document.querySelectorAll('[data-testid=map-legend] li')].map((li) => li.querySelector('span').style.backgroundColor));
  if (legend.length) check(`${label}: the map legend has three buses in three colours`, legend.length === 3 && new Set(legend).size === 3, JSON.stringify(legend));
  check(`${label}: no errors in the console`, errors.length === 0, errors.slice(0, 2).join(' | '));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace('.png', `-${label}.png`) });
  await page.close();
}

try {
  await run('phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await run('desktop', { width: 1400, height: 900 });
} finally {
  await browser.close();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
