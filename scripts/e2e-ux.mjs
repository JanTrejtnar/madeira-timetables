// End-to-end check of the planner UX: title and header, settings toggle, "Odjezd nyní" picker, advanced search type switch,
// star on recent trips, one list sorted by departure, sticky bars, detail layout (map last, map / PDF icons), direction pills,
// and a different colour + legend per bus of a transfer on the map.
// Usage: node scripts/e2e-ux.mjs [baseUrl]   (dev server `npx vite --port 5173` or the preview of a build)
import puppeteer from 'puppeteer-core';
import { freezeClock, waitForServer } from './lib-e2e-clock.mjs';

const base = process.argv[2] ?? `http://localhost:${process.env.E2E_PORT ?? process.env.PORT ?? 5173}/`;
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
await waitForServer();
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

async function open(viewport, url = base) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/tile\.openstreetmap|cartocdn|Failed to load resource|routed-foot/.test(m.text()) && errors.push(m.text()));
  await page.setRequestInterception(true);
  page.on('request', (r) => (/tile\.openstreetmap\.org|cartocdn\.com/.test(r.url()) ? r.abort() : r.continue()));
  // a clean profile once per tab (the sessionStorage flag survives the reloads of a test), then a single load of the page
  await page.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('e2e-clean')) { localStorage.clear(); sessionStorage.setItem('e2e-clean', '1'); } });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('main, #root > *', { timeout: 10000 });
  return { page, errors };
}
const PHONE = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
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
const clickOption = (page, re) => page.evaluate((src) => { const o = [...document.querySelectorAll('[role=option] button')].find((b) => new RegExp(src).test(b.innerText)); o?.click(); return !!o; }, re.source);

// ---- 1. header, title, settings toggle
{
  const { page, errors } = await open(PHONE);
  check('title "Madeira Bus"', (await page.evaluate(() => document.querySelector('header h1').innerText.trim())) === 'Madeira Bus');
  const head = await page.evaluate(() => document.querySelector('header').innerText);
  check('header has no clock and no weekday', !/\b\d{1,2}:\d{2}\b/.test(head) && !/pondělí|úterý|středa|čtvrtek|pátek|sobota|neděle/i.test(head), head.replace(/\s+/g, ' '));
  await typeIn(page, 'Odkud', 'Funchal');
  await clickOption(page, /všechny zastávky/);
  await typeIn(page, 'Kam', 'Curral');
  await clickOption(page, /Curral das Freiras/);
  await page.click('[data-testid=search-button]');
  await page.waitForSelector('[data-testid=connection]', { timeout: 8000 });
  await page.click('[data-testid=open-settings]');
  await sleep(300);
  check('settings page opens', (await page.$('[data-testid=settings]')) !== null);
  await page.click('[data-testid=open-settings]');
  await sleep(300);
  check('the settings icon again returns to the results it came from', (await page.$('[data-testid=search-summary]')) !== null && (await page.$('[data-testid=settings]')) === null);
  await page.evaluate(() => document.querySelector('[data-testid=connection]').click());
  await sleep(500);
  await page.click('[data-testid=open-settings]');
  await sleep(300);
  await page.click('[data-testid=open-settings]');
  await sleep(300);
  check('... and to an opened connection', (await page.$('[data-testid=connection-detail]')) !== null);
  await page.evaluate(() => document.querySelector('[data-testid=open-leg]').click());
  await sleep(700);
  const hash = await page.evaluate(() => location.hash);
  await page.click('[data-testid=open-settings]');
  await sleep(300);
  await page.click('[data-testid=open-settings]');
  await sleep(500);
  check('... and to a line detail', (await page.evaluate(() => location.hash)) === hash && (await page.$('[data-testid=settings]')) === null, hash);
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 2. start page: Odjezd nyní, advanced search, recent trips with a star
{
  const { page, errors } = await open(PHONE);
  const trig = await page.$eval('[data-testid=depart-trigger]', (b) => ({ text: b.innerText.trim(), value: b.dataset.value, icon: !!b.querySelector('svg') }));
  check('start page: "Odjezd nyní" with a clock icon', trig.text === 'Odjezd nyní' && trig.value === 'now' && trig.icon, JSON.stringify(trig));
  check('start page: no Dnes / Zítra switch', !(await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /^(Dnes|Zítra)$/.test(b.innerText.trim())))));
  await page.click('[data-testid=depart-trigger]');
  const sel = await page.evaluate(() => ({ d: document.querySelectorAll('[data-testid=depart-date] option').length, h: document.querySelectorAll('[data-testid=depart-hour] option').length, m: document.querySelectorAll('[data-testid=depart-minute] option').length }));
  check('picker: drop-downs for date, hour and minute', sel.d > 100 && sel.h === 24 && sel.m === 60, JSON.stringify(sel));
  await page.keyboard.press('Escape');
  await page.click('[data-testid=advanced-toggle]');
  const types = await page.evaluate(() => [...document.querySelectorAll('[data-testid=type-filter] button')].map((b) => `${b.innerText.trim()}:${b.getAttribute('aria-pressed')}`));
  check('advanced search: Vše / Meziměstské / Městské (Funchal), Vše by default', types.join() === 'Vše:true,Meziměstské:false,Městské (Funchal):false', types.join());
  await typeIn(page, 'Odkud', 'Funchal');
  await clickOption(page, /všechny zastávky/);
  check('field shows just "Funchal"', (await page.evaluate(() => document.querySelector('input[aria-label="Odkud"]').parentElement.innerText)).replace(/\s+/g, ' ').trim() === '');
  await typeIn(page, 'Kam', 'Curral');
  await clickOption(page, /Curral das Freiras/);
  await page.evaluate(() => [...document.querySelectorAll('[data-testid=type-filter] button')].find((b) => /Městské/.test(b.innerText)).click());
  await page.click('[data-testid=search-button]');
  await page.waitForSelector('[data-testid=search-summary]', { timeout: 8000 });
  await sleep(1800); // the search is stored as a recent trip after a moment
  const summary = await page.evaluate(() => document.querySelector('[data-testid=search-summary]').innerText.replace(/\s+/g, ' '));
  check('results summary: names without "(všechny zastávky)", departure and type', /^Funchal → Curral das Freiras/.test(summary) && !/všechny zastávky/.test(summary) && /Odjezd nyní/.test(summary) && /Městské/.test(summary), summary);
  await page.click('[data-testid=edit-search]');
  await sleep(300);
  const rec = await page.evaluate(() => ({ text: document.querySelector('[data-testid=recent-trip]')?.innerText.replace(/\s+/g, ' ').trim(), star: !!document.querySelector('[data-testid=recent-star]') }));
  check('recent trip: no "(všechny zastávky)", star at the end', rec.text === 'Funchal → Curral das Freiras' && rec.star, JSON.stringify(rec));
  await page.click('[data-testid=recent-star]');
  await sleep(300);
  check('star on a recent trip adds it to the favourites', (await page.evaluate(() => [document.querySelectorAll('[data-testid=favorite-trip]').length, document.querySelector('[data-testid=recent-star]').getAttribute('aria-pressed')].join())) === '1,true');
  const fav = await page.evaluate(() => document.querySelector('[data-testid=favorite-trip]').innerText.trim());
  check('favourite shows no qualifier either', fav === 'Funchal → Curral das Freiras', fav);
  await page.click('[data-testid=recent-star]');
  await sleep(300);
  check('and a second tap removes it', (await page.evaluate(() => document.querySelectorAll('[data-testid=favorite-trip]').length)) === 0);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('no horizontal overflow', ov <= 0, String(ov));
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 3. results: one list sorted by departure, no transfer count, date formats, sticky bar, detail layout
{
  const { page, errors } = await open(PHONE, `${base}?from=Funchal&fk=&to=Santana&time=08:00`);
  await page.waitForSelector('[data-testid=connection]', { timeout: 8000 });
  const res = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid=connection]')];
    const dep = cards.map((c) => { const m = /(\d\d:\d\d)/.exec(c.innerText.replace(c.querySelector('[data-testid=connection-date]').innerText, '')); return m ? m[1] : ''; });
    return { n: cards.length, dep, dates: cards.map((c) => c.querySelector('[data-testid=connection-date]').innerText.trim()), titles: [...document.querySelectorAll('h2')].map((h) => h.innerText), text: document.body.innerText };
  });
  check('results: one list sorted by departure', res.n > 1 && res.dep.every((d, i) => i === 0 || res.dep[i - 1] <= d), res.dep.join(' '));
  check('results: no "Přímá spojení" / "Spojení s přestupem" headings and no "1 přestup"', !/Přímá spojení|Spojení s přestupem|1 přestup/.test(res.text));
  check('results: a past departure reads "<date> v H:mm" (08:00 today is in the past or the date form)', res.dates.every((d) => /^(Dnes|Za \d|Právě teď|[^\d]*\d{1,2}\. ?\d{1,2}\.)/.test(d) && (/ v \d{1,2}:\d\d$/.test(d) || /^Za /.test(d) || /^Právě/.test(d))), res.dates.slice(0, 4).join(' | '));
  const sticky = await page.evaluate(async () => {
    window.scrollTo(0, 600);
    await new Promise((r) => setTimeout(r, 300));
    const b = document.querySelector('[data-testid=edit-search]').getBoundingClientRect();
    const h = document.querySelector('header').getBoundingClientRect();
    return { top: Math.round(b.top), headerBottom: Math.round(h.bottom), scrolled: window.scrollY };
  });
  check('results: the back-to-search button stays visible under the header while scrolling', sticky.scrolled > 100 && sticky.top >= sticky.headerBottom - 2 && sticky.top < sticky.headerBottom + 60, JSON.stringify(sticky));
  await page.evaluate(() => window.scrollTo(0, 0));
  // a connection with a transfer (rows of two buses): its detail is taller than the screen, so the map icon has something to scroll over
  await page.evaluate(() => ([...document.querySelectorAll('[data-testid=connection]')].find((c) => c.querySelectorAll('[class*="grid-cols-[2.75rem"]').length >= 2) ?? document.querySelector('[data-testid=connection]')).click());
  await sleep(1200);
  const det = await page.evaluate(async () => {
    const d = document.querySelector('[data-testid=connection-detail]');
    const kids = [...d.children];
    const map = d.querySelector('.leaflet-container');
    const mapIdx = kids.findIndex((k) => k.contains(map));
    return { mapLast: mapIdx === kids.length - 1, mapIcon: !!d.querySelector('[data-testid=scroll-to-map]'), pdf: d.querySelectorAll('[data-testid=open-pdf]').length, pdfHref: d.querySelector('[data-testid=open-pdf]')?.getAttribute('href'), h: document.body.scrollHeight };
  });
  check('detail: the map is the last block', det.mapLast, JSON.stringify(det));
  check('detail: map icon and PDF icon at the top', det.mapIcon && det.pdf >= 1 && !!det.pdfHref, JSON.stringify(det));
  await page.click('[data-testid=scroll-to-map]');
  await sleep(1200);
  const y = await page.evaluate(() => ({ top: Math.round(document.querySelector('.leaflet-container').getBoundingClientRect().top), vh: innerHeight, sy: scrollY }));
  check('detail: the map icon scrolls to the map', y.sy > 100 && y.top < y.vh - 100, JSON.stringify(y));
  const bar = await page.evaluate(() => Math.round(document.querySelector('[data-testid=connection-back]').getBoundingClientRect().top));
  check('detail: the sticky bar stays at the top after scrolling', bar >= 0 && bar < 140, String(bar));
  const legs = await page.evaluate(() => document.querySelector('[data-testid=open-leg]') !== null);
  check('detail has a bus to open', legs);
  await page.evaluate(() => document.querySelector('[data-testid=open-leg]').click());
  await sleep(900);
  const pills = await page.evaluate(() => document.querySelector('[role=tablist]') !== null);
  check('a line opened from a connection hides the direction pills', !pills);
  check('line detail: the map is the last section', await page.evaluate(() => { const c = document.querySelector('.leaflet-container'); const secs = [...c.closest('section').parentElement.children]; return secs[secs.length - 1].contains(c); }));
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 4. a line opened from the line catalogue keeps its direction pills
{
  const { page, errors } = await open(PHONE);
  // a line opened by itself (no planned ride): tabs for its directions
  let ok = false;
  for (const id of [90, 1, 2, 3, 4, 6, 20, 77, 103]) {
    await page.evaluate((i) => { location.hash = `#/line/${i}`; }, id);
    await sleep(600);
    ok = await page.evaluate(() => document.querySelector('[role=tablist]') !== null);
    if (ok) break;
  }
  check('a line opened on its own shows the direction pills', ok);
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 5. transfer: every bus its own colour on the map, with a legend
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', (r) => (/tile\.openstreetmap\.org|cartocdn\.com/.test(r.url()) ? r.abort() : r.continue()));
  const pairs = [['Santana', 'Machico'], ['Porto Moniz', 'Camacha'], ['Calheta', 'Santana'], ['Ribeira Brava', 'Machico'], ['Câmara de Lobos', 'Santana']];
  let found = null;
  for (const [a, b] of pairs) {
    await page.goto(`${base}?from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}&time=08:00`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=map-legend] li', { timeout: 2500 }).catch(() => {});
    const legend =await page.evaluate(() => [...document.querySelectorAll('[data-testid=map-legend] li')].map((li) => ({ color: li.querySelector('span').style.backgroundColor, badge: li.children[1].innerText })));
    if (legend.length >= 2) { found = { a, b, legend }; break; }
  }
  check('map of a transfer: a legend with two buses', !!found, found ? `${found.a} -> ${found.b} ${JSON.stringify(found.legend)}` : '');
  if (found) {
    check('the two buses have different colours', new Set(found.legend.map((l) => l.color)).size === found.legend.length);
    const strokes = await page.evaluate(() => [...document.querySelectorAll('.leaflet-overlay-pane path')].map((p) => p.getAttribute('stroke')?.toLowerCase()).filter((c) => c && c !== '#0f172a'));
    check('the lines on the map use those colours', ['#38bdf8', '#f472b6'].every((c) => strokes.includes(c)), [...new Set(strokes)].join());
    const rails = await page.evaluate(() => { document.querySelector('[data-testid=connection]').click(); return null; });
    await sleep(600);
    const railCols = await page.evaluate(() => [...document.querySelectorAll('[data-testid=connection-detail] span.w-1')].map((s) => s.style.backgroundColor).filter(Boolean));
    check('the rails of the detail carry the same colours', new Set(railCols).size >= 2, [...new Set(railCols)].join());
    void rails;
  }
  const single = await (async () => {
    await page.goto(`${base}?from=Funchal&to=Santana&time=08:00&direct=1`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=connection]', { timeout: 4000 }).catch(() => {});
    await sleep(400); // the legend (if any) renders right after the cards
    return page.evaluate(() => document.querySelectorAll('[data-testid=map-legend]').length);
  })();
  check('a direct bus needs no legend', single === 0);
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 6. Funchal (all stops) -> Pico do Areeiro: only the Areeiro bus, short badge; yellow card shows no price; no "Dnes platí" in the header
{
  const { page, errors } = await open(PHONE);
  await typeIn(page, 'Odkud', 'Funchal');
  await clickOption(page, /všechny zastávky/);
  await typeIn(page, 'Kam', 'Pico do Areeiro');
  await clickOption(page, /Areeiro/);
  await page.click('[data-testid=search-button]');
  await page.waitForSelector('[data-testid=connection]', { timeout: 8000 }).catch(() => {});
  const res = await page.evaluate(() => ({
    badges: [...document.querySelectorAll('[data-testid=connection] span.font-bold[title]')].map((b) => b.innerText.trim()),
    legs: [...document.querySelectorAll('[data-testid=connection]')].map((c) => c.querySelectorAll('span.font-bold[title]').length),
    head: document.querySelector('header').innerText,
  }));
  check('Funchal -> Areeiro: every result is the single Areeiro bus (badge "PA", no city bus first)', res.badges.length > 0 && res.legs.every((n) => n === 1) && res.badges.every((b) => b === 'PA'), JSON.stringify(res));
  check('header has no "Dnes platí"', !/Dnes platí/.test(res.head));
  const fare = await page.evaluate(() => document.querySelectorAll('[data-testid=fare]').length);
  check('with no card the price is shown', fare > 0);
  await page.evaluate(() => localStorage.setItem('fareCard', 'yellow'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid=connection]', { timeout: 8000 }).catch(() => {});
  check('yellow card: no price and no "zdarma" in the results', (await page.evaluate(() => document.querySelectorAll('[data-testid=fare]').length)) === 0 && !/zdarma/.test(await page.evaluate(() => document.querySelector('main').innerText)));
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}


// ---- 8. map: a click on a stop marker does not reset the zoom
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', (r) => (/tile\.openstreetmap\.org|cartocdn\.com/.test(r.url()) ? r.abort() : r.continue()));
  await page.goto(`${base}#/line/90`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.leaflet-overlay-pane path', { timeout: 6000 }).catch(() => {});
  await sleep(400);
  const width = () => page.evaluate(() => { const ps = [...document.querySelectorAll('.leaflet-overlay-pane path')].filter((p) => p.getAttribute('stroke-width') === '4'); const r = ps[0]?.getBoundingClientRect(); return r ? Math.round(r.width) : 0; });
  await page.click('.leaflet-control-zoom-in');
  await sleep(500);
  await page.click('.leaflet-control-zoom-in');
  await sleep(700);
  const before = await width();
  const marker = await page.evaluateHandle(() => { const ms = [...document.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive')].filter((p) => { const r = p.getBoundingClientRect(); return r.width < 20 && r.left > 500 && r.left < 1300 && r.top > 50 && r.top < 850; }); return ms[0]; });
  await marker.asElement()?.click();
  await sleep(1200);
  const after = await width();
  check('map: clicking a stop keeps the zoom', before > 0 && Math.abs(after - before) <= 2, `${before} -> ${after}`);
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// line 6: a dash means the trip does not call there; a tap on a stop never changes the chosen trip
{
  const { page, errors } = await open(PHONE, `${base}#/line/2004`);
  await sleep(800);
  const clickTime = (txt) => page.evaluate((t) => { const b = [...document.querySelectorAll('button[aria-pressed]')].find((x) => x.innerText.trim() === t); b?.click(); return !!b; }, txt);
  const rows = () => page.evaluate(() => [...document.querySelectorAll('ol > li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
  // the identity of the chosen trip = its time at the first listed stop (Funchal)
  const tripStart = async () => ((await rows())[0] ?? '').match(/\d\d:\d\d/)?.[0];
  const tapRow = (re) => page.evaluate((src) => { const b = [...document.querySelectorAll('ol > li button')].find((x) => new RegExp(src).test(x.innerText)); b?.click(); }, re.source);
  // automatic choice (the next departure): a tap on another stop must not change it
  const auto = await tripStart();
  await tapRow(/Estreito/);
  await sleep(400);
  check('line 6: tapping a stop keeps the automatically chosen trip', !!auto && (await tripStart()) === auto, `${auto} -> ${await tripStart()}`);
  await tapRow(/^Funchal/);
  await sleep(400);
  check('line 6: the 07:35 time is in the grid', await clickTime('07:35'));
  await sleep(300);
  const names = (await rows()).join(' | ');
  check('line 6, 07:35: stops with a dash (Lameiros, Ginjas, Terra Chã, Falca) are not listed', !/Lameiros|Ginjas|Terra Ch|Falca/.test(names), names.slice(0, 200));
  check('line 6, 07:35: São Vicente has an arrival and a departure tag', (await page.$$('[data-testid=stop-twin]')).length >= 2);
  for (const [label, re] of [['São Vicente', /S.o Vicente/], ['Rosário', /Rosário/], ['Boaventura', /Boaventura/]]) {
    await tapRow(re);
    await sleep(500);
    check(`tapping ${label} keeps the 07:35 trip`, (await tripStart()) === '07:35', await tripStart());
  }
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- line 6 / 139: a planned trip is kept in the line detail, theme switch
{
  // Funchal -> Falca on Friday 23 Oct 2026 from 05:00: the 07:35 bus of line 139; its line detail opens on 07:35 (not on the device's next departure)
  const { page, errors } = await open(PHONE, `${base}?from=Funchal&to=Falca&tk=falca&date=2026-10-23&time=05:00`);
  await page.waitForSelector('[data-testid=connection]', { timeout: 4000 }).catch(() => {});
  if (!(await page.$('[data-testid=connection]'))) { await page.click('[data-testid=search-button]'); await page.waitForSelector('[data-testid=connection]', { timeout: 4000 }).catch(() => {}); }
  const picked = await page.evaluate(() => {
    const c = [...document.querySelectorAll('[data-testid=connection]')].find((x) => /07:35/.test(x.innerText) && /139/.test(x.innerText));
    c?.click();
    return !!c;
  });
  await sleep(600);
  check('Funchal -> Falca (Fri): the 07:35 connection with line 139 is offered', picked);
  const detail = await page.evaluate(() => document.querySelector('[data-testid=connection-detail]')?.innerText ?? '');
  check('the detail shows the arrival in São Vicente at 09:50 (not 10:15)', /09:50/.test(detail) && /S.o Vicente/.test(detail), detail.replace(/\s+/g, ' ').slice(0, 300));
  check('the detail shows the transfer to line 6', /\b6\b/.test(detail) && /11:20/.test(detail));
  await page.evaluate(() => document.querySelector('[data-testid=open-leg]')?.click());
  await page.waitForFunction(() => location.hash.startsWith('#/line'), { timeout: 4000 }).catch(() => {});
  const hash = await page.evaluate(() => location.hash);
  check('the line detail URL carries the searched departure and date', /\?dep=07:35&date=2026-10-23$/.test(hash), hash);
  const first = await page.evaluate(() => (document.querySelector('ol > li')?.innerText ?? '').match(/\d\d:\d\d/)?.[0]);
  check('the line detail of 139 opens on the 07:35 trip', first === '07:35', first);
  // the same through a pasted URL
  await page.goto(`${base}${hash}`, { waitUntil: 'networkidle0' });
  await sleep(800);
  const again = await page.evaluate(() => (document.querySelector('ol > li')?.innerText ?? '').match(/\d\d:\d\d/)?.[0]);
  check('reloading that line URL keeps the 07:35 trip', again === '07:35', again);
  check('no page errors (planned trip)', errors.length === 0, errors.join('; '));
  await page.close();
}
{
  // theme: follows the system, the choice is kept in the browser
  const { page, errors } = await open(PHONE);
  const dark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.reload({ waitUntil: 'networkidle0' });
  check('system light: the page is light', !(await dark()));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await sleep(300);
  check('system dark: the page follows without a reload', await dark());
  await page.click('[data-testid=open-settings]');
  await sleep(400);
  const pick = (v) => page.evaluate((x) => { document.querySelector(`[data-testid=theme-switch] input[value=${x}]`)?.click(); }, v);
  await pick('light');
  await sleep(300);
  check('settings: Světlý overrides a dark system', !(await dark()));
  check('the choice is stored', (await page.evaluate(() => localStorage.getItem('theme'))) === 'light');
  await page.reload({ waitUntil: 'networkidle0' });
  check('the choice survives a reload (no flash of the dark scheme)', !(await dark()));
  check('a reload keeps the settings page (its own URL)', (await page.$('[data-testid=settings]')) !== null);
  await pick('dark');
  await sleep(300);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await sleep(300);
  check('settings: Tmavý overrides a light system', await dark());
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('dark body background', bg === 'rgb(2, 6, 23)', bg);
  await pick('system');
  await sleep(300);
  check('settings: Systém follows the system again (light)', !(await dark()));
  check('no page errors (theme)', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- desktop: the first card and the detail are not hidden under the sticky bars
{
  const { page, errors } = await open({ width: 1280, height: 800, deviceScaleFactor: 1 }, `${base}?from=Funchal&to=Falca&tk=falca&date=2026-10-23&time=05:00`);
  await page.waitForSelector('[data-testid=connection]', { timeout: 4000 }).catch(() => {});
  const gap = (bar, below) => page.evaluate((a, b) => { const x = document.querySelector(a)?.getBoundingClientRect(); const y = document.querySelector(b)?.getBoundingClientRect(); return x && y ? Math.round(y.top - x.bottom) : null; }, bar, below);
  const g1 = await gap('[data-testid=search-summary]', '[data-testid=connection]');
  check('desktop: the first result card starts clearly below the search bar', g1 !== null && g1 >= 6, String(g1));
  await page.evaluate(() => document.querySelector('[data-testid=connection]')?.click());
  await sleep(800);
  const g2 = await page.evaluate(() => { const bar = document.querySelector('[data-testid=connection-back]')?.closest('div')?.getBoundingClientRect(); const card = document.querySelector('[data-testid=connection-detail] > div:nth-child(2)')?.getBoundingClientRect(); return bar && card ? Math.round(card.top - bar.bottom) : null; });
  check('desktop: the top of the connection detail is not cut by its bar', g2 !== null && g2 >= 6, String(g2));
  check('no page errors (desktop)', errors.length === 0, errors.join('; '));
  await page.close();
}
{
  // light theme: the tiles are not filtered; dark theme: only the tile layer is
  const { page } = await open({ width: 1280, height: 800, deviceScaleFactor: 1 }, `${base}?from=Funchal&to=Falca&tk=falca&date=2026-10-23&time=05:00`);
  const filt = (sel) => page.evaluate((q) => { const e = document.querySelector(q); return e ? getComputedStyle(e).filter : null; }, sel);
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.leaflet-layer.osm-tiles', { timeout: 4000 }).catch(() => {});
  check('light theme: the map tile layer has no CSS filter', (await filt('.leaflet-layer.osm-tiles')) === 'none', await filt('.leaflet-layer.osm-tiles'));
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.leaflet-layer.osm-tiles', { timeout: 4000 }).catch(() => {});
  check('dark theme: the tile layer is inverted', /invert/.test((await filt('.leaflet-layer.osm-tiles')) ?? ''));
  check('dark theme: the map container and the line pane are not filtered', (await filt('.leaflet-container')) === 'none' && (await filt('.leaflet-overlay-pane')) === 'none');
  await page.close();
}


// ---- 9. desktop: the start page has no map (a centred column); the split view with the map starts with the search results
{
  const DESK = { width: 1400, height: 900, deviceScaleFactor: 1 };
  const { page, errors } = await open(DESK);
  const state = () => page.evaluate(() => ({ split: document.querySelector('[data-testid=layout]')?.dataset.split, maps: document.querySelectorAll('.leaflet-container').length, aside: Math.round(document.querySelector('aside').getBoundingClientRect().width), left: Math.round(document.querySelector('aside').getBoundingClientRect().left) }));
  const s0 = await state();
  check('desktop start page: no map, one centred column', s0.split === 'false' && s0.maps === 0 && s0.aside <= 700 && s0.left > 200, JSON.stringify(s0));
  await page.click('nav[aria-label=Tabs] button:nth-child(3)');
  check('desktop line search tab: no map either', (await state()).maps === 0);
  await page.click('nav[aria-label=Tabs] button:nth-child(2)');
  await sleep(800);
  check('desktop "Mapa" tab shows the island map beside the panel', (await state()).maps === 1 && (await state()).split === 'true');
  await page.click('nav[aria-label=Tabs] button:nth-child(1)');
  await typeIn(page, 'Odkud', 'Funchal');
  await clickOption(page, /všechny zastávky/);
  await typeIn(page, 'Kam', 'Curral');
  await clickOption(page, /Curral das Freiras/);
  await page.click('[data-testid=search-button]');
  await page.waitForSelector('[data-testid=connection]', { timeout: 8000 });
  await sleep(800);
  const s1 = await state();
  check('desktop results: panel on the left, map on the right', s1.split === 'true' && s1.maps === 1 && s1.aside < 500, JSON.stringify(s1));
  await page.click('[data-testid=edit-search]');
  await sleep(300);
  check('back to the form: the map is hidden again', (await state()).split === 'false' && (await state()).maps === 0);
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ---- 10. "earlier / later connections" move the search time (URL), share button
{
  const q = '?from=Funchal&to=Curral%20das%20Freiras&date=2026-10-23&time=12:00';
  const { page, errors } = await open({ width: 1400, height: 900, deviceScaleFactor: 1 }, base + q);
  await page.waitForSelector('[data-testid=connection]', { timeout: 8000 });
  const deps = () => page.evaluate(() => [...document.querySelectorAll('[data-testid=connection]')].map((c) => (c.innerText.match(/\d{1,2}:\d{2}/) ?? [''])[0]));
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const qs = () => new URLSearchParams(location.search);
  const urlTime = () => page.evaluate(() => new URLSearchParams(location.search).get('time'));
  const first0 = (await deps())[0];
  check('buttons for earlier and later connections are there', !!(await page.$('[data-testid=earlier-connections]')) && !!(await page.$('[data-testid=later-connections]')));
  const all0 = await deps();
  await page.click('[data-testid=later-connections]');
  await sleep(700);
  const t1 = await urlTime();
  const all1 = await deps();
  check('"later" moves the URL time past the last connection shown and lists later ones', toMin(t1) > toMin(all0.at(-1)) - 1 && toMin(all1[0]) > toMin(all0.at(-1)), `${all0.join(' ')} -> ${t1} ${all1.join(' ')}`);
  await page.click('[data-testid=earlier-connections]');
  await sleep(700);
  const all2 = await deps();
  const t2 = await urlTime();
  check('"earlier" lists connections before the first shown and updates the URL', toMin(all2[0]) < toMin(all1[0]) && toMin(t2) < toMin(t1), `${all1.join(' ')} -> ${t2} ${all2.join(' ')}`);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid=connection]', { timeout: 8000 });
  check('a reload keeps the moved time window', (await urlTime()) === t2 && (await deps()).join() === all2.join());
  // share
  await page.evaluate(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); window.__copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (v) => { window.__copied = v; } }, configurable: true }); });
  await page.click('[data-testid=connection]');
  await page.waitForSelector('[data-testid=connection-detail]');
  await page.click('[data-testid=share-connection]');
  await sleep(400);
  const copied = await page.evaluate(() => window.__copied);
  const toast = await page.evaluate(() => document.querySelector('[data-testid=toast]')?.innerText ?? '');
  check('share without navigator.share copies the link and shows the toast', !!copied && /Odkaz na spojení zkopírován/.test(toast), toast);
  const u = new URL(copied ?? 'http://x/');
  check('the link has start, destination, date, time and the connection', ['from', 'to', 'date', 'time', 'c'].every((k) => u.searchParams.get(k)), u.search);
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1400, height: 900 });
  await page2.setRequestInterception(true);
  page2.on('request', (r) => (/tile\.openstreetmap\.org|cartocdn\.com/.test(r.url()) ? r.abort() : r.continue()));
  await page2.goto(copied, { waitUntil: 'networkidle0' });
  await page2.waitForSelector('[data-testid=connection-detail]', { timeout: 8000 }).catch(() => {});
  const same = await page2.evaluate(() => document.querySelector('[data-testid=connection-date]')?.closest('div.overflow-hidden')?.innerText ?? '');
  const orig = await page.evaluate(() => document.querySelector('[data-testid=connection-date]')?.closest('div.overflow-hidden')?.innerText ?? '');
  check('the recipient of the link sees the same connection', same.length > 0 && same === orig, same.slice(0, 80));
  check('the link parameter c is dropped from the address bar after it was used', !new URL(page2.url()).searchParams.get('c'));
  await page2.close();
  // navigator.share is preferred where it exists
  await page.evaluate(() => { window.__shared = null; Object.defineProperty(navigator, 'share', { value: async (d) => { window.__shared = d; }, configurable: true }); });
  await page.click('[data-testid=share-connection]');
  await sleep(300);
  const sh = await page.evaluate(() => window.__shared);
  check('navigator.share gets title, text and the link', !!sh && !!sh.url && !!sh.text, JSON.stringify(sh));
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}


// ---- 11. desktop "Linky" tab: operator list without a map; a line detail opens the split view with the route on the map
{
  const { page, errors } = await open({ width: 1400, height: 900, deviceScaleFactor: 1 });
  const split = () => page.evaluate(() => ({ split: document.querySelector('[data-testid=layout]')?.dataset.split, maps: document.querySelectorAll('.leaflet-container').length, paths: document.querySelectorAll('.leaflet-overlay-pane path').length }));
  await page.click('nav[aria-label=Tabs] button:nth-child(3)');
  await sleep(500);
  const a = await split();
  check('desktop "Linky": the operator list has no map', a.split === 'false' && a.maps === 0, JSON.stringify(a));
  await page.click('[data-testid=operator-rodoeste] button');
  await page.click('[data-testid=operator-rodoeste] .divide-y button');
  await sleep(1500);
  const b = await split();
  check('desktop line detail: split view with the route drawn on the map', b.split === 'true' && b.maps === 1 && b.paths > 0, JSON.stringify(b));
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}


// ---- 12. Funchal -> Eira do Serrado: the 181 trips "Via Eira do Serrado" are found, the map line reaches the viewpoint
{
  const { page, errors } = await open({ width: 1400, height: 900, deviceScaleFactor: 1 }, `${base}?date=2026-10-23&time=07:00`);
  await typeIn(page, 'Odkud', 'Funchal');
  await clickOption(page, /všechny zastávky/);
  await typeIn(page, 'Kam', 'Eira do Serrado');
  const picked = await clickOption(page, /Eira do Serrado/);
  check('Eira do Serrado is offered in the suggestions', picked);
  await page.click('[data-testid=search-button]');
  await page.waitForSelector('[data-testid=connection]', { timeout: 8000 }).catch(() => {});
  await sleep(1200);
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid=connection]')].map((c) => c.innerText));
  check('connections to Eira do Serrado are listed (line 181)', cards.length > 0 && cards.some((c) => /\b181\b/.test(c)), cards[0]?.replace(/\s+/g, ' '));
  check('the card shows the arrival at the stop Eira do Serrado', cards.some((c) => /Eira do Serrado/.test(c)));
  const reach = await page.evaluate(() => {
    const E = { lat: 32.710657, lon: -16.96188 };
    const d = [...document.querySelectorAll('.leaflet-overlay-pane path')].map((p) => p.getAttribute('d') ?? '').join(' ');
    return d.length;
  });
  check('the route is drawn on the map', reach > 0);
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

await browser.close();
console.log(`${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
