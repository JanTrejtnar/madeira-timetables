// End-to-end check of the places search, walking routes, network map, line catalogue and recent / favourite trips.
// Usage: node scripts/e2e-showcase.mjs [baseUrl]   (dev server `npx vite --port 5173` or the preview of a build)
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
let failed = 0;
let total = 0;
const check = (name, ok, extra = '') => {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const data = JSON.parse(readFileSync(new URL('../public/data/schedules.json', import.meta.url), 'utf8'));

async function open(viewport, { blockFoot = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  const footRequests = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/tile\.openstreetmap|cartocdn|Failed to load resource|routed-foot/.test(m.text()) && errors.push(m.text()));
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.url().includes('routed-foot')) {
      footRequests.push(r.url());
      if (blockFoot) return r.abort();
    }
    if (/tile\.openstreetmap\.org|cartocdn\.com/.test(r.url())) return r.abort();
    r.continue();
  });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); history.replaceState(null, '', location.pathname); });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(500);
  return { page, errors, footRequests };
}
const typeIn = async (page, label, v) => {
  await page.evaluate((a, b) => {
    const i = document.querySelector(`input[aria-label="${a}"]`);
    i.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(i, '');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(i, b);
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }, label, v);
  await sleep(500);
};
const options = (page) => page.evaluate(() => [...document.querySelectorAll('[role=option]')].map((o) => ({ kind: o.dataset.kind, text: o.innerText.replace(/\s+/g, ' ').trim() })));
const clickOption = (page, re) => page.evaluate((src) => { const o = [...document.querySelectorAll('[role=option] button')].find((b) => new RegExp(src).test(b.innerText)); o?.click(); return !!o; }, re.source);
const clickTab = (page, name) => page.evaluate((n) => { const b = [...document.querySelectorAll('nav[aria-label=Tabs] button')].filter((x) => x.offsetParent !== null).find((x) => x.textContent.trim() === n); b?.click(); return !!b; }, name);

// ---- 1. suggestions with a category label and an icon, places of interest
{
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await typeIn(page, 'Kam', 'Cristo');
  let opts = await options(page);
  check('"Cristo": the place is offered with its category (Vyhlídka)', opts.some((o) => o.kind === 'viewpoint' && /Cristo Rei.*Vyhlídka/.test(o.text)), JSON.stringify(opts.slice(0, 4)));
  await typeIn(page, 'Kam', 'Pico do Arieiro');
  opts = await options(page);
  check('"Pico do Arieiro": peak with the category Vrchol', opts.some((o) => o.kind === 'peak' && /Vrchol/.test(o.text)), JSON.stringify(opts.slice(0, 3)));
  await typeIn(page, 'Kam', 'praia');
  opts = await options(page);
  check('"praia": beaches with the category Pláž', opts.filter((o) => o.kind === 'beach').length >= 3 && opts.every((o) => /Pláž|Zastávka|Hotel|Park|Atrakce|Vyhlídka|Příroda|Obec|Město|Přístav|Muzeum|Vrchol/.test(o.text)), JSON.stringify(opts.slice(0, 5)));
  await typeIn(page, 'Odkud', 'Machico');
  opts = await options(page);
  check('"Machico": the area comes first, stops are labelled Zastávka, a place is never a duplicate of the area', /všechny zastávky/.test(opts[0]?.text) && opts.some((o) => o.kind === 'stop' && /Zastávka/.test(o.text)) && opts.filter((o) => /^Machico (Město|Obec)/.test(o.text)).length === 0, JSON.stringify(opts.slice(0, 4)));
  const icons = await page.evaluate(() => [...document.querySelectorAll('[role=option]')].every((o) => o.querySelector('svg')));
  check('every suggestion has an icon', icons);
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 2. a place as destination: stops near it, walking route along the streets, favourites and recent trips
{
  const { page, errors, footRequests } = await open({ width: 1280, height: 900 });
  await typeIn(page, 'Odkud', 'Funchal');
  await clickOption(page, /všechny zastávky/);
  await typeIn(page, 'Kam', 'Cabo Gir');
  await clickOption(page, /Cabo Girão/);
  await sleep(2500);
  const body = await page.evaluate(() => document.body.innerText);
  check('Funchal -> Cabo Girão (place): connections are found', (body.match(/\d\d:\d\d/g) ?? []).length >= 4, (body.match(/\d\d:\d\d/g) ?? []).length + ' times');
  check('the walk from the last stop to the place is shown', /Chůze k cíli: \d+ m/.test(body), body.match(/Chůze k cíli[^\n]*/)?.[0] ?? 'missing');
  check('the walking route was requested from the foot router', footRequests.length > 0, footRequests[0]?.slice(0, 120) ?? 'no request');
  const walkDrawn = await page.evaluate(() => [...document.querySelectorAll('.leaflet-overlay-pane path')].some((p) => p.getAttribute('stroke-dasharray') === '1 7'));
  check('the walk is drawn along the streets (dotted street route, not the straight dashed line)', walkDrawn);
  const url = await page.evaluate(() => location.search);
  check('the place is kept in the URL (tk + tp)', /tk=%40poi/.test(url) && /tp=3\d\.\d+/.test(url), decodeURIComponent(url).slice(0, 140));

  // favourites
  await page.click('[data-testid=favorite-toggle]');
  await sleep(300);
  check('star: the trip is saved under Oblíbené', (await page.evaluate(() => document.querySelectorAll('[data-testid=favorite-trip]').length)) === 1 && (await page.evaluate(() => JSON.parse(localStorage.getItem('favoriteTrips.v1') ?? '[]').length)) === 1);
  // recent trips are stored after a moment
  await sleep(1500);
  check('the search is stored as a recent trip', (await page.evaluate(() => JSON.parse(localStorage.getItem('recentTrips.v1') ?? '[]').length)) === 1);
  // reload with a clean URL: the shortcuts survive and search again with one tap
  await page.goto(base, { waitUntil: 'networkidle0' });
  await sleep(800);
  check('after a reload the favourite and the recent trip are offered', (await page.evaluate(() => [document.querySelectorAll('[data-testid=favorite-trip]').length, document.querySelectorAll('[data-testid=recent-trip]').length])).join() === '1,1');
  await page.click('[data-testid=favorite-trip]');
  await sleep(2000);
  const vals = await page.evaluate(() => [document.querySelector('input[aria-label="Odkud"]').value, document.querySelector('input[aria-label="Kam"]').value, (document.body.innerText.match(/\d\d:\d\d/g) ?? []).length]);
  check('a tap on the favourite searches it again', /Funchal/.test(vals[0]) && /Cabo Girão/.test(vals[1]) && vals[2] >= 4, JSON.stringify(vals));
  await page.click('[data-testid=favorite-toggle]');
  await sleep(300);
  check('star again removes the favourite', (await page.evaluate(() => document.querySelectorAll('[data-testid=favorite-trip]').length)) === 0);
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 2b. offline / blocked foot router: the straight line stays, nothing breaks
{
  const { page, errors } = await open({ width: 1280, height: 900 }, { blockFoot: true });
  await typeIn(page, 'Odkud', 'Funchal');
  await clickOption(page, /všechny zastávky/);
  await typeIn(page, 'Kam', 'Cabo Gir');
  await clickOption(page, /Cabo Girão/);
  await sleep(2500);
  const body = await page.evaluate(() => document.body.innerText);
  check('foot router unreachable: connections and the straight-line walk are still shown', /Chůze k cíli: \d+ m/.test(body) && (body.match(/\d\d:\d\d/g) ?? []).length >= 4);
  const dashed = await page.evaluate(() => [...document.querySelectorAll('.leaflet-overlay-pane path')].some((p) => p.getAttribute('stroke-dasharray') === '5 7'));
  check('...and the walk is drawn as the straight dashed line', dashed);
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 3. network map: all lines at the start, tap a stop -> panel
{
  const { page, errors } = await open({ width: 1280, height: 900 });
  const hasMap = await page.evaluate(() => !!document.querySelector('[data-testid=network-map] canvas') && !document.querySelector('[data-testid=planner-map]'));
  check('desktop: the idle map shows the whole network on a canvas', hasMap);
  const legend = await page.evaluate(() => [...document.querySelectorAll('[data-testid=network-legend] button')].map((b) => b.innerText.trim()));
  check('the legend names the four operators', legend.join('|') === 'Horários do Funchal|Rodoeste|SAM|CAM / EACL', legend.join('|'));
  // tap Machico (a terminal of many lines): its pixel from the Web Mercator maths at the initial view
  const line701 = data.lines.find((l) => l.number === '701');
  const machico = line701.directions.flatMap((d) => d.stops).find((s) => /^Machico/.test(s.name) && s.lat !== undefined);
  const view = await page.evaluate(() => { const r = document.querySelector('[data-testid=network-map] .leaflet-container').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const proj = (lat, lon, zoom) => { const s = 256 * 2 ** zoom; const x = ((lon + 180) / 360) * s; const sin = Math.sin((lat * Math.PI) / 180); return [x, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s]; };
  const [z, vlat, vlon] = (await page.evaluate(() => document.querySelector('[data-testid=network-map] .leaflet-container').getAttribute('data-view'))).split('|').map(Number);
  const [cx, cy] = proj(vlat, vlon, z);
  const [mx, my] = proj(machico.lat, machico.lon, z);
  await page.mouse.click(view.x + view.w / 2 + (mx - cx), view.y + view.h / 2 + (my - cy));
  await sleep(500);
  const panel = await page.evaluate(() => ({ title: document.querySelector('[data-testid=stop-panel] h3')?.innerText, lines: document.querySelectorAll('[data-testid=stop-panel] button[aria-label]').length, deps: document.querySelectorAll('[data-testid=stop-panel-departures] li').length }));
  check('tap on a stop opens its panel with lines and departures', /Machico/.test(panel.title ?? '') && panel.lines >= 3 && panel.deps >= 1, JSON.stringify(panel));
  await page.click('[data-testid=stop-set-to]');
  await sleep(600);
  const to = await page.evaluate(() => document.querySelector('input[aria-label="Kam"]')?.value);
  check('"Set as To" fills the planner', /Machico/.test(to ?? ''), to);
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}
{
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  check('phone: the Mapa tab exists', await clickTab(page, 'Mapa'));
  await sleep(1200);
  const phone = await page.evaluate(() => { const m = document.querySelector('[data-testid=map-tab]'); const r = m?.getBoundingClientRect(); return { canvas: !!m?.querySelector('canvas'), h: r?.height ?? 0 }; });
  check('phone: the network map fills the screen', phone.canvas && phone.h > 380, JSON.stringify(phone));
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 4. line catalogue by operator
{
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  check('the Linky tab exists', await clickTab(page, 'Linky'));
  await sleep(500);
  const ops = await page.evaluate(() => [...document.querySelectorAll('[data-testid^=operator-]')].map((o) => o.innerText.replace(/\s+/g, ' ').trim()));
  check('four sections: Horários do Funchal, Rodoeste, SAM, CAM / EACL with line counts', ops.length === 4 && /Horários do Funchal.*Městské.*\d+ linek/.test(ops[0]) && /Rodoeste.*Západ/.test(ops[1]) && /SAM.*Východ/.test(ops[2]) && /CAM \/ EACL.*Sever/.test(ops[3]), ops.map((x) => x.slice(0, 70)).join(' // '));
  await page.click('[data-testid=operator-rodoeste] button');
  await sleep(300);
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid=operator-rodoeste] .divide-y button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
  check('Rodoeste lists its lines with their termini', rows.length >= 20 && rows.some((r) => /^221 /.test(r) && /⇄/.test(r)), rows.slice(0, 2).join(' // '));
  await page.evaluate(() => [...document.querySelectorAll('[data-testid=operator-rodoeste] .divide-y button')].find((b) => /^221/.test(b.innerText.trim()))?.click());
  await sleep(600);
  check('a line opens its timetable', /#\/line\//.test(await page.evaluate(() => location.hash)));
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 7. Funchal -> Cabo Girão: right direction and start, A / B pins, the ridden stretch in the line card, dark map, small qualifiers
{
  const { page, errors } = await open({ width: 1280, height: 900 });
  await typeIn(page, 'Odkud', 'Funchal');
  await clickOption(page, /všechny zastávky/);
  check('"(všechny zastávky)" is a small light qualifier beside the field, the field holds the name', await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="Odkud"]');
    const s = document.querySelector('[data-testid=group-suffix]');
    return i.value === 'Funchal' && !!s && /všechny zastávky/.test(s.textContent) && getComputedStyle(s).fontSize === '12px';
  }));
  await typeIn(page, 'Kam', 'Cabo Gir');
  await clickOption(page, /Cabo Girão/);
  await sleep(2500);
  const body = await page.evaluate(() => document.body.innerText);
  check('no connection boards at a Lombada or runs "... -> Funchal"', !/Lombada/i.test(body) && !/Ponta Sol\s*[→>-]+\s*Funchal/i.test(body), (body.match(/Lombada.*/) ?? [''])[0]);
  const pins = await page.evaluate(() => [...document.querySelectorAll('.picked-pin')].map((p) => p.textContent.trim()).sort().join(','));
  check('the map shows both the start (A) and the destination (B) marker', pins === 'A,B', pins);
  check('the map base is the darkened OpenStreetMap (no API key)', await page.evaluate(() => [...document.querySelectorAll('img.leaflet-tile')].some((i) => /tile\.openstreetmap\.org/.test(i.src) && !!i.closest('.leaflet-layer.dark-tiles'))));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^\s*\d+\s/.test(b.innerText) && b.className.includes('rounded-xl') && b.querySelector('svg'))?.click());
  await sleep(900);
  const ride = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('li[data-ride]')];
    return { n: rows.length, off: rows.filter((r) => r.dataset.ride === 'off').length, ends: rows.filter((r) => r.dataset.ride === 'end').length, faded: rows.filter((r) => r.dataset.ride === 'off').every((r) => r.className.includes('opacity-40')), hash: location.hash };
  });
  check('the line card opens in the ridden direction with boarding and getting-off stops marked and the rest dimmed', ride.n > 3 && ride.ends === 2 && ride.off > 0 && ride.faded && /^#\/line\/\d+\/\d+\/\d+-\d+$/.test(ride.hash), JSON.stringify(ride));
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 8. Linky: operators first, nearby stops below; the network map draws on canvas
{
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await clickTab(page, 'Linky');
  await sleep(500);
  const order = await page.evaluate(() => {
    const cat = document.querySelector('[data-testid=line-catalog]')?.getBoundingClientRect().top;
    const loc = [...document.querySelectorAll('button')].find((b) => /okolí|poloh|mém/i.test(b.textContent) && b.closest('section') !== document.querySelector('[data-testid=line-catalog]'))?.getBoundingClientRect().top;
    return { cat, loc };
  });
  check('"Linky podle dopravce" comes before the nearby stops', order.cat !== undefined && order.loc !== undefined && order.cat < order.loc, JSON.stringify(order));
  await clickTab(page, 'Mapa');
  await sleep(1500);
  check('the network map draws lines on a canvas, not thousands of SVG paths', await page.evaluate(() => !!document.querySelector('[data-testid=network-map] canvas') && document.querySelectorAll('[data-testid=network-map] svg path').length < 20));
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

await browser.close();
console.log(`${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
