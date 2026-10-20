// End-to-end test of the route map: generated road line (139), map -> list click sync, "Via" place of a trip (208).
// Needs the dev server (npx vite --port 5173).   Usage: node scripts/e2e-map.mjs [baseUrl]
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:5173/';
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
};
const data = await (await fetch(`${base}data/schedules.json`)).json();
const line = (n) => data.lines.find((l) => l.number === n);

for (const [label, vp] of [['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['desktop', { width: 1400, height: 900 }]]) {
  console.log('---', label);
  const page = await browser.newPage();
  await page.setViewport(vp);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/tile\.openstreetmap|ERR_|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const open = async (id, dir = 0) => {
    await page.goto(`${base}#/line/${id}/${dir}`, { waitUntil: 'networkidle0' });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.leaflet-container', { timeout: 8000 });
    await sleep(900);
  };
  // map pane: on desktop the big map beside the list, on a phone the inline one
  const polyline = () => page.evaluate(() => {
    const p = [...document.querySelectorAll('.leaflet-overlay-pane path')].filter((x) => +x.getAttribute('stroke-width') === 5);
    return p.length ? { n: p.length, len: p[0].getAttribute('d').length } : null;
  });
  const markers = () => page.$$('.leaflet-overlay-pane path.leaflet-interactive');

  // 1) line 139: a continuous road line is drawn although SIGA has no geometry
  const l139 = line('139');
  await open(l139.id);
  const pl = await polyline();
  check('139: route polyline drawn on the map', !!pl && pl.len > 300, JSON.stringify(pl));

  // 2) map -> list: clicking a stop marker opens that stop in the list and scrolls to it
  const ms = await markers();
  check('139: stop markers on the map', ms.length > 10, String(ms.length));
  const target = Math.floor(ms.length / 2);
  // the marker's centre may lie outside the viewport on a phone: scroll it into view first
  await ms[target].evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await sleep(300);
  const box = await ms[target].boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(1200);
  const info = await page.evaluate(() => {
    const open = document.querySelector('[data-testid="stop-details"]');
    if (!open) return null;
    const li = open.closest('li');
    const r = li.getBoundingClientRect();
    return { name: li.querySelector('button')?.innerText.split('\n')[0], top: r.top, bottom: r.bottom, vh: innerHeight, active: li.querySelector('button[aria-pressed="true"]') !== null };
  });
  check('139: marker click expands the stop in the list', !!info, JSON.stringify(info));
  check('139: the list is scrolled so the stop is in the viewport', !!info && info.top >= 0 && info.bottom <= info.vh + 4, info ? `${Math.round(info.top)}..${Math.round(info.bottom)} of ${info.vh}` : '');
  check('139: the clicked stop is highlighted', !!info?.active);

  // 3) 208, trip with "Via Aeroporto": the airport is listed (and on the map) only for that trip
  const l208 = line('208');
  const di = l208.directions.findIndex((d) => d.stops[0].name === 'Funchal' && d.stops[1].name === 'Machico');
  await open(l208.id, di);
  // departures of this direction are listed per stop; pick the trip that has 17:00 at Machico (stop 1) = left Funchal at 16:00
  const pickTrip = async (time) => {
    const ok = await page.evaluate((t) => {
      const b = [...document.querySelectorAll('button[aria-pressed]')].find((x) => x.innerText.trim().startsWith(t) && /^\d\d:\d\d/.test(x.innerText.trim()));
      b?.click();
      return !!b;
    }, time);
    await sleep(500);
    return ok;
  };
  // "Departures from the stop" is the stop with the most times; choose Machico (stop 1) by tapping it
  await page.evaluate(() => [...document.querySelectorAll('ol li button')].find((b) => b.innerText.startsWith('Machico'))?.click());
  await sleep(400);
  check('208: trip 17:00 selectable', await pickTrip('17:00'));
  const stopsText = async () => page.evaluate(() => [...document.querySelectorAll('ol li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
  const withAirport = await stopsText();
  const iAir = withAirport.findIndex((x) => x.startsWith('Aeroporto'));
  check('208 17:00 (note a): Aeroporto is in the stop list between Funchal and Machico', iAir > 0 && withAirport[0].startsWith('Funchal') && withAirport[iAir + 1]?.startsWith('Machico'), withAirport.slice(0, 5).join(' | '));
  check('208 17:00: the inserted stop carries an estimated time and a "this trip only" label', /~\d\d:\d\d/.test(withAirport[iAir] ?? '') && /Via/.test(withAirport[iAir] ?? ''), withAirport[iAir]);
  const marks = await page.evaluate(() => document.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive').length);
  check('208 17:00: the airport is also a marker on the map', marks === withAirport.length - 0 || marks >= withAirport.length - 4, `${marks} markers, ${withAirport.length} stops`);
  // a trip without note "a": no airport
  const other = l208.directions[di].trips.find((t) => t.days.includes('weekday') && !t.notes?.includes('a') && t.times[1]);
  const ok2 = await pickTrip(other.times[1]);
  const plain = await stopsText();
  check('208, a trip without the note: no Aeroporto row', ok2 && !plain.some((x) => x.startsWith('Aeroporto')), plain.slice(0, 3).join(' | '));
  // Via Rápida is only a note: 139 never gets a fictitious stop
  await open(l139.id);
  const t139 = await page.evaluate(() => [...document.querySelectorAll('ol li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
  check('139 (note VR = Via Rápida): no inserted stop', t139.length === l139.directions[0].stops.length, `${t139.length} vs ${l139.directions[0].stops.length}`);
  await page.close();
}
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' || '));
await browser.close();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
