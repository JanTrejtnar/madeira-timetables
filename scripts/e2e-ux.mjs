// End-to-end check of the planner UX: title and header, settings toggle, "Odjezd nyní" picker, advanced search type switch,
// star on recent trips, one list sorted by departure, sticky bars, detail layout (map last, map / PDF icons), direction pills,
// and a different colour + legend per bus of a transfer on the map.
// Usage: node scripts/e2e-ux.mjs [baseUrl]   (dev server `npx vite --port 5173` or the preview of a build)
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:5173/';
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--lang=cs-CZ'] });
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
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); history.replaceState(null, '', location.pathname); });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await sleep(500);
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
  await page.evaluate(() => document.querySelector('[data-testid=connection]').click());
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
    await sleep(1800);
    const legend = await page.evaluate(() => [...document.querySelectorAll('[data-testid=map-legend] li')].map((li) => ({ color: li.querySelector('span').style.backgroundColor, badge: li.children[1].innerText })));
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
    await sleep(1500);
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
  await sleep(1800);
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
  await sleep(1500);
  if (!(await page.$('[data-testid=connection]'))) { await page.click('[data-testid=search-button]'); await sleep(1500); }
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
  await sleep(900);
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
  await page.click('[data-testid=open-settings]');
  await sleep(300);
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

await browser.close();
console.log(`${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
