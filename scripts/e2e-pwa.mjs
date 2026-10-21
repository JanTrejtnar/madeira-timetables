// PWA / offline / geolocation check against the production preview (npm run build && npx vite preview --port 4173).
// Usage: node scripts/e2e-pwa.mjs [baseUrl]
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:4173/';
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); };
const text = (page) => page.evaluate(() => document.body.innerText);
// DOM click: a coordinate click can land under the fixed tab bar after puppeteer scrolls the button to the edge
const clickText = (page, re) => page.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent)); b?.click(); return !!b; }, re.source);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(base).origin, ['geolocation']);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'networkidle0' });

  // manifest
  const mf = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  const sizes = mf.icons.map((i) => `${i.sizes}/${i.purpose}`);
  check('manifest name "Madeira Buses" + theme_color', mf.name === 'Madeira Buses' && mf.short_name === 'Madeira Buses' && mf.theme_color === '#0284c7', mf.name);
  check('manifest has 192 and 512 PNG + maskable', ['192x192/any', '512x512/any', '512x512/maskable'].every((x) => sizes.includes(x)), sizes.join(' '));
  const apple = await page.evaluate(() => document.querySelector('link[rel=apple-touch-icon]')?.href);
  check('apple-touch-icon link', !!apple && (await page.evaluate(async (u) => (await fetch(u)).ok, apple)));

  // service worker precaches schedules.json
  await page.evaluate(() => navigator.serviceWorker.ready);
  await sleep(1500);
  const cached = await page.evaluate(async () => {
    const out = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url);
    return out;
  });
  check('build-time sources (OTP dump, planner patterns) are neither precached nor served', !cached.some((u) => /siga-otp-dump|siga-patterns/.test(u)) && !(await page.evaluate(async () => (await fetch('/data/sources/siga/siga-otp-dump.json')).headers.get('content-type')?.includes('json'))));
  check('schedules.json is in the SW cache', cached.some((u) => u.includes('data/schedules.json')), `${cached.length} cached files`);
  check('places (pois.json) and the network map (overview.json) are precached for offline use', cached.some((u) => u.includes('data/pois.json')) && cached.some((u) => u.includes('data/overview.json')));

  // planner is the first tab and the default one; simplified filters
  const tabs = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label=Tabs]')].map((n) => [...n.querySelectorAll('button')].map((b) => b.textContent.trim())));
  check('tab order: Plánovač, Mapa, Linky, Odjezdy', tabs.length > 0 && tabs.every((t) => /Plánovač/.test(t[0]) && /Mapa/.test(t[1]) && /Linky/.test(t[2]) && /Odjezdy/.test(t[3])), JSON.stringify(tabs));
  let body0 = await text(page);
  check('planner opens first; no "Preferovat" / "Pouze tento typ"', /Odkud|Nástupní/.test(await page.evaluate(() => document.body.innerHTML)) && !/Preferovat|Pouze tento typ/.test(body0));
  check('"Pouze přímá spojení" checkbox + Vše/Meziměstské/Městské switch', /Pouze přímá spojení/.test(body0) && ['Vše', 'Meziměstské', 'Městské'].every((x) => body0.includes(x)));
  const typeIn = async (label, value) => {
    await page.evaluate((l, v) => { const i = document.querySelector(`input[aria-label="${l}"]`); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); }, label, value);
    await sleep(500);
  };
  await typeIn('Odkud', 'santana');
  const first = await page.evaluate(() => document.querySelector('ul li button')?.innerText.replace(/\s+/g, ' '));
  check('"santana": first suggestion is the group of the parish Santana (not the municipality)', /^Santana \(všechny zastávky\)/.test(first ?? ''), first);
  await page.evaluate(() => document.querySelector('ul li button')?.click());
  await typeIn('Kam', 'funchal');
  const firstTo = await page.evaluate(() => document.querySelector('ul li button')?.innerText.replace(/\s+/g, ' '));
  check('"funchal": the city group (the one municipality group) comes first', /^Funchal \(všechny zastávky\)/.test(firstTo ?? ''), firstTo);
  await page.evaluate(() => document.querySelector('ul li button')?.click());
  await sleep(900);
  const bodyG = await text(page);
  check('Santana (all stops) -> Funchal lists connections', (bodyG.match(/\d\d:\d\d/g) ?? []).length >= 4, (bodyG.match(/\d\d:\d\d/g) ?? []).length + ' times');
  await clickText(page, /^Linky$/);
  await sleep(300);

  // Pico do Areeiro search
  await page.type('input:not([type=checkbox])', 'Arieiro');
  await sleep(700);
  let body = await text(page);
  check('"Arieiro" offers the Pico do Areeiro line with price', /Pico do Areeiro/.test(body) && /3,00|€3\.00|3,00 €/.test(body));

  // geolocation next to Pico do Areeiro
  await page.evaluate(() => { const i = document.querySelector('input:not([type=checkbox])'); i.focus(); });
  await page.setGeolocation({ latitude: 32.7358, longitude: -16.9283, accuracy: 15 });
  await page.evaluate(() => { const i = document.querySelector('input:not([type=checkbox])'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(500);
  await clickText(page, /Zastávky v mém okolí/);
  await sleep(1500);
  body = await text(page);
  check('nearby list shows distances', /Pico do Areeiro[\s\S]*\d+ m/.test(body), body.match(/Pico do Areeiro[^\n]*\n?[^\n]*/)?.[0]);
  check('pulsing position dot on the map', (await page.$('.me-dot')) !== null);
  await clickText(page, /Nejbližší odjezdy odsud/);
  await sleep(400);
  body = await text(page);
  check('"next departures from here" expands', /Skrýt odjezdy/.test(body) && /\d\d:\d\d/.test(body));
  await clickText(page, /Nastavit jako/);
  await sleep(600);
  const fromVal = await page.evaluate(() => document.querySelector('input:not([type=checkbox])')?.value);
  check('"Set as From" fills the planner', /Areeiro/i.test(fromVal ?? ''), fromVal);

  // offline: reload without network, data must still load, banner shown
  await page.setOfflineMode(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await sleep(300);
  check('offline banner shown', /Režim offline – používají se uložená data/.test(await text(page)));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(2500);
  body = await text(page);
  check('app + data load after reload while offline', !/Nepodařilo se načíst/.test(body) && (await page.$('input:not([type=checkbox])')) !== null);
  await clickText(page, /^Linky$/);
  await sleep(300);
  await page.type('input:not([type=checkbox])', 'Pico do Areeiro');
  await sleep(800);
  check('offline search finds the line', /HF Areeiro|Pico do Areeiro/.test(await text(page)));
  await page.setOfflineMode(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await sleep(300);
  check('offline banner hidden when back online', !/Režim offline/.test(await text(page)));
  check('no page errors', errors.length === 0, errors.join('; '));
} finally {
  await browser.close();
}
process.exit(results.every(Boolean) ? 0 : 1);
