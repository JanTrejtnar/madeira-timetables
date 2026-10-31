// End-to-end check of the places search, walking routes, network map, line catalogue and recent / favourite trips.
// Usage: node scripts/e2e-showcase.mjs [baseUrl]   (dev server `npx vite --port 5173` or the preview of a build)
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { freezeClock } from './lib-e2e-clock.mjs';

const base = process.argv[2] ?? `http://localhost:${process.env.E2E_PORT ?? process.env.PORT ?? 5173}/`;
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--lang=cs-CZ'] });
freezeClock(browser);
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
const clickTab = (page, name) => page.evaluate((n) => { const b = [...document.querySelectorAll('nav[data-testid=tabs] button')].filter((x) => x.offsetParent !== null).find((x) => x.textContent.trim() === n); b?.click(); return !!b; }, name);

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
  await page.click('[data-testid=search-button]');
  await sleep(2500);
  const body = await page.evaluate(() => document.body.innerText);
  check('Funchal -> Cabo Girão (place): connections are found', (body.match(/\d\d:\d\d/g) ?? []).length >= 4, (body.match(/\d\d:\d\d/g) ?? []).length + ' times');
  check('the walk from the last stop to the place is shown', /Chůze \d+ m · \d+ min/.test(body), body.match(/Chůze \d[^\n]*/)?.[0] ?? 'missing');
  check('the walking route was requested from the foot router', footRequests.length > 0, footRequests[0]?.slice(0, 120) ?? 'no request');
  const walkDrawn = await page.evaluate(() => [...document.querySelectorAll('.leaflet-overlay-pane path')].some((p) => p.getAttribute('stroke-dasharray') === '1 7'));
  check('the walk is drawn along the streets (dotted street route, not the straight dashed line)', walkDrawn);
  const url = await page.evaluate(() => location.search);
  check('the place is kept in the URL (tk + tp)', /tk=%40poi/.test(url) && /tp=3\d\.\d+/.test(url), decodeURIComponent(url).slice(0, 140));

  // favourites
  await page.click('[data-testid=favorite-toggle]');
  await sleep(300);
  check('star: the trip is saved under Oblíbené', (await page.evaluate(() => JSON.parse(localStorage.getItem('favoriteTrips.v1') ?? '[]').length)) === 1);
  // recent trips are stored after a moment
  await sleep(1500);
  check('the search is stored as a recent trip', (await page.evaluate(() => JSON.parse(localStorage.getItem('recentTrips.v1') ?? '[]').length)) === 1);
  // reload with a clean URL: the shortcuts survive and search again with one tap
  await page.goto(base, { waitUntil: 'networkidle0' });
  await sleep(800);
  check('after a reload the favourite and the recent trip are offered', (await page.evaluate(() => [document.querySelectorAll('[data-testid=favorite-trip]').length, document.querySelectorAll('[data-testid=recent-trip]').length])).join() === '1,1');
  await page.click('[data-testid=favorite-trip]');
  await sleep(2000);
  const vals = await page.evaluate(() => [document.querySelector('[data-testid=search-summary]')?.innerText ?? '', (document.body.innerText.match(/\d\d:\d\d/g) ?? []).length]);
  check('a tap on the favourite opens the results of that search', /Funchal/.test(vals[0]) && /Cabo Girão/.test(vals[0]) && vals[1] >= 4, JSON.stringify(vals));
  await page.click('[data-testid=favorite-toggle]');
  await sleep(300);
  check('star again removes the favourite', (await page.evaluate(() => JSON.parse(localStorage.getItem('favoriteTrips.v1') ?? '[]').length)) === 0);
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
  await page.click('[data-testid=search-button]');
  await sleep(2500);
  const body = await page.evaluate(() => document.body.innerText);
  check('foot router unreachable: connections and the straight-line walk are still shown', /Chůze \d+ m · \d+ min/.test(body) && (body.match(/\d\d:\d\d/g) ?? []).length >= 4);
  const dashed = await page.evaluate(() => [...document.querySelectorAll('.leaflet-overlay-pane path')].some((p) => p.getAttribute('stroke-dasharray') === '5 7'));
  check('...and the walk is drawn as the straight dashed line', dashed);
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 3. network map (Mapa tab): all lines, tap a stop -> panel
{
  const { page, errors } = await open({ width: 1280, height: 900 });
  // desktop: the start page has no map; the island map is the "Mapa" tab
  check('desktop start page shows no map', (await page.$('[data-testid=network-map]')) === null);
  await page.click('nav[data-testid=tabs] button:nth-child(2)');
  await sleep(1200);
  const hasMap = await page.evaluate(() => !!document.querySelector('[data-testid=network-map] canvas') && !document.querySelector('[data-testid=planner-map]'));
  check('desktop: the idle map shows the whole network on a canvas', hasMap);
  const legend = await page.evaluate(() => [...document.querySelectorAll('[data-testid=network-legend] > span')].map((b) => b.innerText.trim()));
  check('the legend names the four operators', legend.join('|') === 'Horários do Funchal|Rodoeste|SAM|CAM / EACL', legend.join('|'));
  // island switch: Porto Santo flies to the island (its lines are drawn there), Madeira flies back
  const viewOf = async () => (await page.evaluate(() => document.querySelector('[data-testid=network-map] .leaflet-container').getAttribute('data-view'))).split('|').map(Number);
  await page.click('[data-testid=island-portoSanto]');
  await sleep(1800);
  const ps = await viewOf();
  check('island switch: Porto Santo centres the map on the island', Math.abs(ps[1] - 33.06) < 0.1 && Math.abs(ps[2] + 16.34) < 0.1 && ps[0] >= 11, ps.join('|'));
  check('island switch: Porto Santo button is pressed', await page.evaluate(() => document.querySelector('[data-testid=island-portoSanto]').getAttribute('aria-pressed') === 'true'));
  await page.click('[data-testid=island-madeira]');
  await sleep(1800);
  const md = await viewOf();
  check('island switch: Madeira returns to the main island', Math.abs(md[1] - 32.74) < 0.15 && Math.abs(md[2] + 16.96) < 0.3, md.join('|'));
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
  check('the field holds just "Funchal", without the "(všechny zastávky)" qualifier', await page.evaluate(() => document.querySelector('input[aria-label="Odkud"]').value === 'Funchal' && !document.querySelector('[data-testid=group-suffix]') && !/všechny zastávky/.test(document.querySelector('input[aria-label="Odkud"]').parentElement.innerText)));
  await typeIn(page, 'Kam', 'Cabo Gir');
  await clickOption(page, /Cabo Girão/);
  await page.click('[data-testid=search-button]');
  await sleep(2500);
  const body = await page.evaluate(() => document.body.innerText);
  check('no connection boards at a Lombada or runs "... -> Funchal"', !/Lombada/i.test(body) && !/Ponta Sol\s*[→>-]+\s*Funchal/i.test(body), (body.match(/Lombada.*/) ?? [''])[0]);
  const pins = await page.evaluate(() => [...document.querySelectorAll('.picked-pin')].map((p) => p.textContent.trim()).sort().join(','));
  check('the map shows both the start (A) and the destination (B) marker', pins === 'A,B', pins);
  check('the map base is the darkened OpenStreetMap (no API key)', await page.evaluate(() => [...document.querySelectorAll('img.leaflet-tile')].some((i) => /tile\.openstreetmap\.org/.test(i.src) && !!i.closest('.leaflet-layer.osm-tiles'))));
  await page.evaluate(() => document.querySelector('[data-testid=connection]')?.click());
  await sleep(500);
  await page.evaluate(() => document.querySelector('[data-testid=open-leg]')?.click());
  await sleep(1200);
  const linePins = await page.evaluate(() => [...document.querySelectorAll('.picked-pin')].map((p) => p.textContent.trim()).sort().join(','));
  check('the line detail map shows the start (A) and destination (B) of the search', linePins === 'A,B', linePins);
  const ride = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('li[data-ride]')];
    return { n: rows.length, off: rows.filter((r) => r.dataset.ride === 'off').length, ends: rows.filter((r) => r.dataset.ride === 'end').length, faded: rows.filter((r) => r.dataset.ride === 'off').every((r) => r.className.includes('opacity-40')), hash: location.hash };
  });
  check('the line card opens in the ridden direction with boarding and getting-off stops marked and the rest dimmed', ride.n > 3 && ride.ends === 2 && ride.off > 0 && ride.faded && /^#\/line\/\d+\/\d+\/\d+-\d+(\?dep=\d\d:\d\d&date=\d{4}-\d\d-\d\d)?$/.test(ride.hash), JSON.stringify(ride));
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
  await page.click('[data-testid=network-map] [data-testid=map-fullscreen]');
  await sleep(500);
  const fs = await page.evaluate(() => { const r = document.querySelector('[data-testid=network-map]').getBoundingClientRect(); return r.width === innerWidth && r.height === innerHeight && r.top === 0; });
  check('the network map has a fullscreen button that fills the screen', fs);
  await page.click('[data-testid=network-map] [data-testid=map-fullscreen]');
  await sleep(400);
  check('...and it closes again', await page.evaluate(() => document.querySelector('[data-testid=network-map]').getBoundingClientRect().height < innerHeight));
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 9. settings, language dropdown, clear buttons, IDOS-style results
{
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const head = await page.evaluate(() => document.querySelector('header').innerText);
  check('the header has no school switch and no Now / +15 min chips', !/Školní (období|prázdniny)/.test(head) );
  await typeIn(page, 'Odkud', 'Funchal');
  await clickOption(page, /všechny zastávky/);
  check('the planner has no Now / +15 min / +30 min / +1 hour chips', !/Nyní|\+15 min|\+30 min|\+1 hodina/.test(await page.evaluate(() => document.body.innerText)));
  check('clear button in a filled planner field empties it', await (async () => {
    await page.click('[data-testid=clear-input]');
    return (await page.evaluate(() => document.querySelector('input[aria-label="Odkud"]').value)) === '';
  })());
  await typeIn(page, 'Odkud', 'Funchal');
  await clickOption(page, /všechny zastávky/);
  await typeIn(page, 'Kam', 'Cabo Gir');
  await clickOption(page, /Cabo Girão/);
  await page.click('[data-testid=search-button]');
  await sleep(2000);
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid=connection]')].map((c) => ({ date: c.querySelector('[data-testid=connection-date]')?.innerText, text: c.innerText.replace(/\s+/g, ' ') })));
  check('every result card shows when it leaves (in N min / date at time)', cards.length > 0 && cards.every((c) => /(\d{1,2}\. ?\d{1,2}\.|dnes|za \d|právě teď)/i.test(c.date ?? '')), JSON.stringify(cards.slice(0, 2).map((c) => c.date)));
  check('results from Funchal name the terminal, e.g. "Funchal (Rodoeste)"', cards.some((c) => /Funchal \((Rodoeste|CAM|SAM|Teleférico)\)/.test(c.text)), cards[0]?.text);
  await page.evaluate(() => document.querySelector('[data-testid=connection]').click());
  await sleep(1200);
  const det = await page.evaluate(() => ({
    back: !!document.querySelector('[data-testid=connection-back]'),
    form: !!document.querySelector('input[aria-label="Odkud"]'),
    fold: !!document.querySelector('[data-testid=toggle-stops]'),
    mid: document.querySelectorAll('[data-testid=mid-stops] li').length,
    pins: [...document.querySelectorAll('.picked-pin')].map((p) => p.textContent.trim()).sort().join(','),
    legs: document.querySelectorAll('[data-testid=open-leg]').length,
  }));
  check('a click on a result opens the connection detail (no form), with the map and A/B', det.back && !det.form && det.legs >= 1 && det.pins === 'A,B', JSON.stringify(det));
  await page.evaluate(() => document.querySelector('[data-testid=toggle-stops]')?.click());
  check('"Mezizastávky: N" unfolds the intermediate stops', (await page.evaluate(() => document.querySelectorAll('[data-testid=mid-stops] li').length)) > 0);
  await page.evaluate(() => document.querySelector('[data-testid=open-leg]').click());
  await sleep(1000);
  check('a bus of the detail opens its line', /^#\/line\//.test(await page.evaluate(() => location.hash)));
  await page.evaluate(() => history.back());
  await sleep(700);
  check('Back from the line returns to the connection detail', await page.evaluate(() => !!document.querySelector('[data-testid=connection-detail]')));
  await page.evaluate(() => document.querySelector('[data-testid=connection-back]').click());
  await sleep(300);
  check('"Zpět na výsledky" returns to the list', (await page.$$('[data-testid=connection]')).length > 0);

  // settings: the school switch and the build stamp live there
  await page.click('[data-testid=open-settings]');
  await sleep(300);
  const set = await page.evaluate(() => ({
    school: !!document.querySelector('[data-testid=settings] input[type=checkbox]'),
    lastIsBuild: !!document.querySelector('[data-testid=settings] > p:last-child [data-testid=build-info]'),
    info: document.querySelector('[data-testid=build-info]')?.closest('p')?.innerText.replace(/\s+/g, ' '),
    inHeader: !!document.querySelector('header input[type=checkbox]'),
  }));
  check('settings: school switch inside, the data / build line is the last element, nothing in the header', set.school && set.lastIsBuild && !set.inHeader && /Data ze siga\.madeira\.gov\.pt, zpracováno \d{4}-\d\d-\d\d v\d+\.\d+\.\d+ · Build:/.test(set.info ?? ''), JSON.stringify(set));

  // language dropdown with flags
  await page.click('[data-testid=lang-menu] button');
  const opts = await page.evaluate(() => [...document.querySelectorAll('[data-testid=lang-menu] [role=option]')].map((o) => ({ t: o.innerText.trim(), flag: !!o.querySelector('svg') })));
  check('language dropdown lists three languages, each with a flag', opts.length === 3 && opts.every((o) => o.flag), JSON.stringify(opts));
  await page.evaluate(() => [...document.querySelectorAll('[data-testid=lang-menu] [role=option] button')].find((b) => /English/.test(b.innerText))?.click());
  await sleep(300);
  check('choosing English switches the app', (await page.evaluate(() => document.documentElement.lang)) === 'en' && /School term|School holidays/.test(await page.evaluate(() => document.body.innerText)));
  await page.click('[data-testid=lang-menu] button');
  await page.evaluate(() => [...document.querySelectorAll('[data-testid=lang-menu] [role=option] button')].find((b) => /Čeština/.test(b.innerText))?.click());
  await sleep(300);

  // Linky search clear + the network map legend is a plain legend
  await clickTab(page, 'Linky');
  await sleep(300);
  await page.type('input[aria-label]:not([type=checkbox])', 'Areeiro');
  await page.click('[data-testid=clear-search]');
  check('the Linky search has a clear button', (await page.evaluate(() => document.querySelector('input[type=text]').value)) === '');
  await clickTab(page, 'Mapa');
  await sleep(1200);
  check('the network map legend is a small plain legend (no filter buttons)', await page.evaluate(() => !!document.querySelector('[data-testid=network-legend]') && document.querySelectorAll('[data-testid=network-legend] button').length === 0));
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 10. default language by the browser, fare card in settings, price in results
{
  const fresh = async (locale) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.evaluateOnNewDocument((l) => Object.defineProperty(navigator, 'languages', { get: () => [l] }), locale);
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(base, { waitUntil: 'networkidle0' });
    return { page, ctx };
  };
  const en = await fresh('en-US');
  check('a non-Czech browser starts in English', (await en.page.evaluate(() => document.documentElement.lang)) === 'en');
  await en.ctx.close();
  const de = await fresh('de-DE');
  check('an unknown browser language falls back to English', (await de.page.evaluate(() => document.documentElement.lang)) === 'en');
  await de.ctx.close();
  const cs = await fresh('cs-CZ');
  const page = cs.page;
  check('a Czech browser starts in Czech', (await page.evaluate(() => document.documentElement.lang)) === 'cs');
  await typeIn(page, 'Odkud', 'Funchal');
  await clickOption(page, /všechny zastávky/);
  await typeIn(page, 'Kam', 'Cabo Gir');
  await clickOption(page, /Cabo Girão/);
  await page.click('[data-testid=search-button]');
  await sleep(2000);
  const fare = () => page.evaluate(() => document.querySelector('[data-testid=connection] [data-testid=fare]')?.textContent.replace(/\s+/g, ' ').trim());
  const setCard = async (v) => {
    await page.click('[data-testid=open-settings]');
    await sleep(300);
    await page.evaluate((c) => document.querySelector(`[data-testid=fare-card] input[value=${c}]`).click(), v);
    await clickTab(page, 'Plánovač');
    await sleep(600);
  };
  const f0 = await fare();
  check('without a card the price is 2,65 € per bus', /2,65|5,30/.test(f0 ?? ''), f0);
  await setCard('blue');
  const f1 = await fare();
  check('blue card: 2,05 € per journey', /2,05|4,10/.test(f1 ?? ''), f1);
  await setCard('yellow');
  const f2 = await fare();
  check('yellow card: no price shown at all', !f2, f2);
  await cs.ctx.close();
}

// ---- 11. search form and results are separate pages; advanced search; long recent trips do not widen the page
{
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  check('the start page is only the form: no results, a Hledat button', (await page.$('[data-testid=search-button]')) !== null && (await page.$$('[data-testid=connection]')).length === 0);
  check('advanced search is collapsed, the operators and the direct switch are inside', await (async () => {
    const closed = (await page.$('[data-testid=op-rodoeste]')) === null;
    await page.click('[data-testid=advanced-toggle]');
    const ops = (await page.$$('[data-testid^=op-]')).length;
    return closed && ops === 4 && (await page.$('[data-testid=advanced] input[type=checkbox]')) !== null;
  })());
  check('no "all timetables" drop-down any more; the connection type lives in the advanced search', !/Všechny jízdní řády/.test(await page.evaluate(() => document.body.innerText)) && (await page.$('[data-testid=advanced] [data-testid=type-filter]')) !== null);
  await page.click('[data-testid=advanced-toggle]');
  await typeIn(page, 'Odkud', 'Funchal');
  await clickOption(page, /všechny zastávky/);
  await typeIn(page, 'Kam', 'Curral das Freiras');
  await clickOption(page, /všechny zastávky/);
  check('picking the destination does not start the search', (await page.$$('[data-testid=connection]')).length === 0);
  await page.click('[data-testid=search-button]');
  await sleep(1500);
  const all = (await page.$$('[data-testid=connection]')).length;
  check('Hledat opens the results page with a summary of the search', all > 0 && (await page.$('input[aria-label="Odkud"]')) === null && /Funchal.*→.*Curral das Freiras/s.test(await page.evaluate(() => document.querySelector('[data-testid=search-summary]')?.innerText ?? '')), String(all));
  await page.click('[data-testid=edit-search]');
  await sleep(300);
  check('the back arrow returns to the form with the values kept', (await page.evaluate(() => document.querySelector('input[aria-label="Kam"]')?.value)) === 'Curral das Freiras');
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, pill: Math.max(0, ...[...document.querySelectorAll('[data-testid=recent-trip]')].map((b) => b.getBoundingClientRect().right)) }));
  check('a long recent trip wraps and the page does not scroll sideways', overflow.sw <= overflow.iw && overflow.pill <= overflow.iw, JSON.stringify(overflow));
  await page.click('[data-testid=advanced-toggle]');
  await page.click('[data-testid=op-sam]');
  await page.click('[data-testid=search-button]');
  await sleep(1500);
  const sam = (await page.$$('[data-testid=connection]')).length;
  check('the operator filter narrows the results (SAM does not serve Curral das Freiras)', sam < all && /SAM/.test(await page.evaluate(() => document.querySelector('[data-testid=search-summary]').innerText)), `${sam} < ${all}`);
  await page.click('[data-testid=edit-search]');
  await sleep(300);
  await page.click('[data-testid=op-sam]');
  await page.evaluate(() => document.querySelector('[data-testid=advanced] input[type=checkbox]').click());
  await page.click('[data-testid=search-button]');
  await sleep(1500);
  check('"Jen přímá spojení" leaves no connection with a transfer', !/čekání/.test(await page.evaluate(() => [...document.querySelectorAll('[data-testid=connection]')].map((c) => c.innerText).join(' '))));
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

await browser.close();
console.log(`${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
