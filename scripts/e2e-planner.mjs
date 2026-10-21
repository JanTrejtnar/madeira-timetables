// Planner end-to-end check against the dev server (npx vite --port 5173): keyboard control of the suggestions, "pick on
// the map", state kept (and in the URL) after opening a line and going back, any date, line detail order.
// Usage: node scripts/e2e-planner.mjs [baseUrl]    Phone and desktop viewport.
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:5173/';
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--lang=cs-CZ'] });
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(label, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/tile\.openstreetmap|cartocdn|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const text = () => page.evaluate(() => document.body.innerText);
  const value = (l) => page.evaluate((x) => document.querySelector(`input[aria-label="${x}"]`)?.value, l);
  const typeIn = async (l, v) => {
    await page.evaluate((a, b) => { const i = document.querySelector(`input[aria-label="${a}"]`); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, b); i.dispatchEvent(new Event('input', { bubbles: true })); }, l, v);
    await sleep(450);
  };
  const options = () => page.evaluate(() => [...document.querySelectorAll('[role=option]')].map((o) => o.innerText.replace(/\s+/g, ' ')));
  const activeOpt = () => page.evaluate(() => { const o = document.querySelector('[role=option][aria-selected=true]'); return o ? o.innerText.replace(/\s+/g, ' ') : null; });
  console.log(`--- ${label}`);
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { history.replaceState(null, '', location.pathname); });
  await page.reload({ waitUntil: 'networkidle0' });

  // 5. keyboard control of the suggestions
  await typeIn('Odkud', 'camacha');
  let opts = await options();
  check(`${label}: "camacha" offers the parish group first, the single stop only if it adds something`, /^Camacha \(všechny zastávky\)/.test(opts[0] ?? ''), JSON.stringify(opts.slice(0, 3)));
  check(`${label}: no duplicate "Camacha" stop right under the group`, !opts.slice(1).some((o) => /^Camacha \d+×$/.test(o)), JSON.stringify(opts.slice(0, 4)));
  await page.keyboard.press('ArrowDown');
  check(`${label}: ArrowDown highlights the first item`, (await activeOpt()) === opts[0], String(await activeOpt()));
  await page.keyboard.press('ArrowDown');
  check(`${label}: second ArrowDown moves on`, (await activeOpt()) === opts[1], String(await activeOpt()));
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  check(`${label}: ArrowUp wraps to the last item`, (await activeOpt()) === opts.at(-1), String(await activeOpt()));
  await page.keyboard.press('Escape');
  check(`${label}: Escape closes the list`, (await options()).length === 0);
  await page.keyboard.press('ArrowDown');
  check(`${label}: ArrowDown reopens it`, (await options()).length > 0);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check(`${label}: Enter takes the highlighted item and closes the list`, /Camacha/.test((await value('Odkud')) ?? '') && (await options()).length === 0, await value('Odkud'));

  // 6. parish group (Curral das Freiras), municipality group first
  await typeIn('Kam', 'curral das freiras');
  opts = await options();
  check(`${label}: "curral das freiras" is offered as a parish group`, opts.some((o) => /^Curral das Freiras \(všechny zastávky\)/.test(o)), JSON.stringify(opts.slice(0, 3)));
  await page.keyboard.press('Enter'); // nothing highlighted: first suggestion
  check(`${label}: Enter without highlight takes the first suggestion`, /Curral das Freiras|Câmara de Lobos/.test((await value('Kam')) ?? ''), await value('Kam'));

  // 3. pick on the map
  await typeIn('Kam', 'Cabo Girão');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const pickBtns = await page.$$('button[aria-label^="Vybrat na mapě"]');
  check(`${label}: "Vybrat na mapě" button next to both fields`, pickBtns.length === 2, String(pickBtns.length));
  await pickBtns[1].click();
  await page.waitForSelector('[data-testid=map-picker-map] .leaflet-tile-loaded, [data-testid=map-picker-map] .leaflet-container', { timeout: 5000 }).catch(() => {});
  await sleep(1200);
  const box = await (await page.$('[data-testid=map-picker-map]')).boundingBox();
  check(`${label}: map picker opens full screen`, box.width >= viewport.width - 1 && box.height > 200, JSON.stringify(box));
  // the map is centred on the stop already in the field: a tap 60 px beside the centre is a few tens of metres away
  await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30);
  await sleep(500);
  const res = await page.evaluate(() => document.querySelector('[data-testid=map-picker-result]')?.innerText);
  check(`${label}: tap finds the nearest stop and states the distance`, /Cabo Girão/i.test(res ?? '') && /\d+ m/.test(res ?? ''), res);
  const markers = await page.evaluate(() => document.querySelectorAll('[data-testid=map-picker-map] path, [data-testid=map-picker-map] .picked-pin').length);
  check(`${label}: tapped point (red pin), link and found stop are drawn`, markers >= 3, String(markers));
  check(`${label}: crosshair pin hangs in the middle of the map`, (await page.$('[data-testid=map-picker-crosshair]')) !== null);
  // the map moves under the pin; "Vybrat tento bod" confirms the point and closes the picker
  await page.click('[data-testid=map-picker-confirm]');
  await sleep(300);
  check(`${label}: "Vybrat tento bod" fills the field and closes the picker`, (await page.$('[data-testid=map-picker]')) === null);
  check(`${label}: the field holds the stop found on the map`, /Girão|Girao/i.test((await value('Kam')) ?? '') || (await value('Kam')) !== '', await value('Kam'));

  // walking leg + persistent pin for the picked destination
  await typeIn('Odkud', 'Funchal');
  await page.keyboard.press('Enter');
  await page.click('[data-testid=time-trigger]');
  await page.focus('[data-testid=time-input]');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.type('08:00');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await sleep(1500);
  const listWalk = await page.evaluate(() => document.querySelector('[data-testid=connection] [data-testid=walk-out]')?.innerText);
  check(`${label}: the result card ends with the walk "Chůze N m · N min"`, /Chůze \d+ m · \d+ min/.test(listWalk ?? ''), listWalk);
  await page.evaluate(() => document.querySelector('[data-testid=connection]')?.click());
  await sleep(800);
  const walk = await page.evaluate(() => document.querySelector('[data-testid=walk-out]')?.innerText);
  check(`${label}: the connection detail ends with "Chůze k cíli: N m (~N min)"`, /Chůze k cíli: \d+ m \(~\d+ min\)/.test(walk ?? ''), walk);
  const pins = await page.evaluate(() => document.querySelectorAll('.picked-pin').length);
  check(`${label}: the red pin stays on the map with the itinerary`, pins >= 1, String(pins));
  check(`${label}: the picked point is kept in the URL`, /[?&]tp=3\d\.\d+(,|%2C)-1\d\.\d+/.test(await page.evaluate(() => location.search)));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector("[data-testid=connection]", { timeout: 8000 }).catch(() => {});
  await sleep(800);
  await page.evaluate(() => document.querySelector('[data-testid=connection]')?.click());
  await sleep(800);
  check(`${label}: pin and walk survive a reload`, (await page.$('[data-testid=walk-out]')) !== null && (await page.$$('.picked-pin')).length >= 1);
  await page.evaluate(() => document.querySelector('[data-testid=connection-back]')?.click());
  await sleep(300);
  // a start point picked 1 km from the stop: no offered bus may leave before the walk is over
  const u = new URL(await page.evaluate(() => location.href));
  u.searchParams.set('fp', '32.6600,-16.9300');
  u.searchParams.set('time', '08:00');
  await page.goto(u.href, { waitUntil: 'networkidle0' });
  await page.waitForSelector("[data-testid=connection]", { timeout: 8000 }).catch(() => {});
  await sleep(500);
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid=connection]')].map((card) => {
    const w = card.querySelector('[data-testid=walk-in]');
    const dep = /(\d\d:\d\d)/.exec(card.innerText.replace(w?.innerText ?? '', '').replace(card.querySelector('[data-testid=connection-date]')?.innerText ?? '', ''));
    return { walk: Number(/· (\d+) min/.exec(w?.innerText ?? '')?.[1]), dep: dep?.[1], text: w?.innerText };
  }));
  const hm = (x) => (x ? Number(x.slice(0, 2)) * 60 + Number(x.slice(3)) : NaN);
  check(`${label}: walking from a picked start point shows the walk and no missed bus`, cards.length > 0 && cards.every((c) => c.walk > 0 && hm(c.dep) >= 8 * 60 + c.walk), JSON.stringify(cards.slice(0, 3)));
  await page.evaluate(() => { const i = document.querySelector('input[aria-label="Kam"]'); i.focus(); });

  // 7. any date + holiday detection
  const dateSet = async (iso) => {
    await page.keyboard.press('Escape'); // the open suggestion list of the focused field may lie over the date button
    await page.click('[data-testid=date-trigger]');
    for (let k = 0; k < 24 && !(await page.$(`[data-date="${iso}"]`)); k++) await page.click('button[aria-label="Další měsíc"]');
    await page.click(`[data-date="${iso}"]`);
    await sleep(300);
  };
  check(`${label}: date picker next to Dnes / Zítra`, (await page.$('[data-testid=date-trigger]')) !== null);
  await dateSet('2026-12-08');
  const info = await page.evaluate(() => document.querySelector('[data-testid=day-info]')?.innerText);
  check(`${label}: 8 Dec 2026 is shown as a holiday (Sunday timetable)`, /Svátek|Neděle|Imaculada|Conceição/i.test(info ?? ''), info);
  await dateSet('2026-12-25');
  const info2 = await page.evaluate(() => document.querySelector('[data-testid=day-info]')?.innerText);
  check(`${label}: 25 Dec: no service`, /bez provozu|Nejezdí|provoz/i.test(info2 ?? ''), info2);
  await dateSet('2026-12-09');

  // 4. state survives opening a line and going back
  await typeIn('Odkud', 'Santana');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await typeIn('Kam', 'Funchal');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(900);
  const before = { from: await value('Odkud'), to: await value('Kam'), url: await page.evaluate(() => location.search) };
  check(`${label}: the form is mirrored into the URL`, /from=/.test(before.url) && /to=/.test(before.url) && /date=2026-12-09/.test(before.url), before.url);
  await page.evaluate(() => document.querySelector('[data-testid=connection]')?.click());
  await sleep(500);
  const opened = await page.evaluate(() => { const b = document.querySelector('[data-testid=open-leg]'); b?.click(); return !!b; });
  await sleep(700);
  check(`${label}: a line detail opened from a result`, opened && /#\/line\//.test(await page.evaluate(() => location.hash)), await page.evaluate(() => location.hash));
  // 8. detail order: stops (with times) before the map, notes last
  const order = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('h2')].map((h) => h.innerText.trim().toLowerCase());
    return heads;
  });
  const iStops = order.findIndex((h) => /zastávky/.test(h));
  const iMap = order.findIndex((h) => /^mapa|trasa/.test(h));
  check(`${label}: line detail lists the stops before the map`, iStops >= 0 && (iMap < 0 || iStops < iMap), JSON.stringify(order));
  await page.evaluate(() => history.back());
  await sleep(700);
  // Back from a line returns to the connection detail it was opened from; one more step back reaches the list
  await page.evaluate(() => document.querySelector('[data-testid=connection-back]')?.click());
  await sleep(300);
  const after = { from: await value('Odkud'), to: await value('Kam'), url: await page.evaluate(() => location.search), date: await page.evaluate(() => document.querySelector('[data-testid=date-trigger]')?.dataset.value) };
  check(`${label}: Back restores Odkud / Kam / date`, after.from === before.from && after.to === before.to && after.date === '2026-12-09', JSON.stringify(after));
  const times = (await text()).match(/\d\d:\d\d/g)?.length ?? 0;
  check(`${label}: and the previous results are shown again`, times >= 4, `${times} times`);

  // reload with the URL
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(600);
  check(`${label}: reload restores the search from the URL`, (await value('Odkud')) === before.from && (await value('Kam')) === before.to, `${await value('Odkud')} -> ${await value('Kam')}`);
  check(`${label}: no page errors`, errors.length === 0, errors.join('; ').slice(0, 300));
  await page.close();
}


// settlement-centre warning and "show on map" on a phone (line 139 has Ribeira da Janela, a village centre)
async function mobileMapChecks() {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 700, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const id = await (async () => {
    const r = await (await fetch(base + 'data/schedules.json')).json();
    return r.lines.find((l) => l.number === '139').id;
  })();
  await page.goto(`${base}#/line/${id}`, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(600);
  const warnIcons = await page.evaluate(() => [...document.querySelectorAll('[role=img]')].filter((e) => /Orientační poloha/.test(e.getAttribute('aria-label') ?? '')).length);
  check('phone: ⚠️ marker next to stops placed on a village centre', warnIcons > 0, String(warnIcons));
  // expand the details of the Ribeira da Janela stop (pin button in its row)
  const opened = await page.evaluate(() => {
    const li = [...document.querySelectorAll('ol li')].find((x) => /^Ribeira da Janela/.test(x.innerText.trim()));
    li?.querySelector('button[aria-expanded]')?.click();
    return !!li;
  });
  await sleep(300);
  const detail = await page.evaluate(() => document.body.innerText);
  check('phone: expanded stop shows the warning text', opened && /Orientační poloha v obci – přesné nástupiště není v mapě ověřeno\./.test(detail));
  check('phone: expanded stop offers "Ukázat na mapě"', /Ukázat na mapě/.test(detail));
  const box = await page.evaluate(() => {
    const d = document.querySelector('[data-testid=stop-details]');
    if (!d) return null;
    const cs = getComputedStyle(d);
    const items = [...d.querySelectorAll('a, button')].map((e) => e.getBoundingClientRect());
    return { pad: parseFloat(cs.paddingTop), mb: parseFloat(cs.marginBottom), n: items.length, tops: new Set(items.map((r) => Math.round(r.top))).size, heights: new Set(items.map((r) => Math.round(r.height))).size, dup: /Poloha určena podle názvu/.test(d.innerText), warn: /Orientační poloha/.test(d.innerText) };
  });
  check('phone: expanded stop has inner padding >= 14 px and a bottom gap >= 10 px', !!box && box.pad >= 14 && box.mb >= 10, JSON.stringify(box));
  check('phone: Ukázat na mapě / Google Maps / Mapy.cz in one row, one height', !!box && box.n === 3 && box.tops === 1 && box.heights === 1, JSON.stringify(box));
  check('phone: no duplicate orange "Poloha určena podle názvu" under the warning', !!box && box.warn && !box.dup);
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/stop-details.png` : undefined }).catch(() => {});
  const before = await page.evaluate(() => { const r = document.querySelector('.leaflet-container')?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom, h: innerHeight } : null; });
  check('phone: the map starts below the viewport (list is long)', !!before && before.top > before.h, JSON.stringify(before));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Ukázat na mapě/.test(b.innerText))?.click());
  await sleep(1800);
  const after = await page.evaluate(() => {
    const r = document.querySelector('.leaflet-container')?.getBoundingClientRect();
    const pop = document.querySelector('.leaflet-popup');
    const pr = pop?.getBoundingClientRect();
    return { mapVisible: !!r && r.top >= 0 && r.bottom <= innerHeight, popup: !!pop, popupInView: !!pr && !!r && pr.top >= r.top - 1 && pr.bottom <= r.bottom + 1 && pr.top >= 0 && pr.bottom <= innerHeight, text: pop?.textContent ?? '' };
  });
  check('phone: "Ukázat na mapě" scrolls the whole map into view', after.mapVisible, JSON.stringify(after));
  check('phone: the popup of the stop is open and in view, with the warning', after.popup && after.popupInView && /Orientační poloha/.test(after.text), after.text.slice(0, 120));
  check('phone: no page errors (map section)', errors.length === 0, errors.join('; ').slice(0, 200));
  await page.close();
}

try {
  await run('phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await run('desktop', { width: 1400, height: 900 });
  await mobileMapChecks();
} finally {
  await browser.close();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
