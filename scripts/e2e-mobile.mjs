// End-to-end check of the phone behaviour: every page has its own URL (reload and Back), the brand goes home, the line-type filter also
// narrows the operator catalogue, the live position (watchPosition, follow / drag, hint for a denied permission), faint stops outside the
// ridden stretch, and the vertical timeline of a connection with a transfer (the pieces of the rail meet in the middle of the dots).
// Usage: node scripts/e2e-mobile.mjs [baseUrl]   (dev server `npx vite --port 5173` or the preview of a build)
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
const PHONE = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

async function open(url, ua) {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  if (ua) await page.setUserAgent(ua);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/tile\.openstreetmap|cartocdn|Failed to load resource|routed-foot|geolocation|Geolocation/.test(m.text()) && errors.push(m.text()));
  await page.setRequestInterception(true);
  page.on('request', (r) => (/tile\.openstreetmap\.org|cartocdn\.com/.test(r.url()) ? r.abort() : r.continue()));
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.clear();
    history.replaceState(null, '', location.pathname);
  });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await sleep(500);
  return { page, errors };
}
const hash = (page) => page.evaluate(() => location.hash);

// ---- 1. URL per page, reload, Back, brand
{
  const { page, errors } = await open(`${base}#/settings`);
  check('#/settings opens the settings', (await page.$('[data-testid=settings]')) !== null);
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(400);
  check('F5 on the settings stays on the settings', (await page.$('[data-testid=settings]')) !== null && (await hash(page)) === '#/settings');
  await page.click('[data-testid=brand-home]');
  await sleep(300);
  check('the brand goes to the start page (planner form)', (await page.$('[data-testid=settings]')) === null && (await hash(page)) === '#/route' && (await page.$('input[aria-label="Odkud"]')) !== null);
  await page.goto(`${base}#/search`, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(400);
  check('F5 on #/search stays on the line search', (await page.$('[data-testid=line-catalog]')) !== null);
  await page.evaluate(() => document.querySelectorAll('nav[aria-label=Tabs] button')[1].click());
  await sleep(300);
  check('a tab changes the URL', (await hash(page)) === '#/map');
  await page.goBack();
  await sleep(400);
  check('Back returns to the previous page', (await hash(page)) === '#/search' && (await page.$('[data-testid=line-catalog]')) !== null, await hash(page));
  await page.goto(`${base}#/line/5004/1/3-10`, { waitUntil: 'networkidle0' });
  await sleep(500);
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(500);
  check('F5 on a line detail stays on it', (await hash(page)).startsWith('#/line/5004'));
  check('no page errors (URLs)', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---- 2. the type filter also narrows the operators
{
  const { page } = await open(`${base}#/search`);
  const ops = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^=operator-]')].map((e) => e.getAttribute('data-testid')));
  const all = await ops();
  const click = (label) => page.evaluate((l) => [...document.querySelectorAll('[role=group] button')].find((b) => b.innerText.trim() === l)?.click(), label);
  await click('Městské');
  await sleep(300);
  const urban = await ops();
  const counts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^=operator-]')].map((e) => e.querySelector('button').innerText.replace(/\s+/g, ' ')));
  check('all operators with "Vše"', all.length >= 3, all.join());
  check('"Městské" hides operators without an urban line', urban.length < all.length && urban.includes('operator-hf'), `${urban.join()} | ${counts.join(' / ')}`);
  await page.close();
}

// ---- 3. live position
{
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(base).origin, ['geolocation']);
  const { page, errors } = await open(`${base}#/map`);
  await page.setGeolocation({ latitude: 32.65, longitude: -16.91, accuracy: 30 });
  const pressed = () => page.$eval('[data-testid=locate-fab]', (b) => b.getAttribute('aria-pressed'));
  const view = async () => {
    const v = await page.evaluate(() => document.querySelector('[data-testid=network-map] > div').getAttribute('data-view'));
    return { z: +v.split('|')[0], lat: +v.split('|')[1], lon: +v.split('|')[2] };
  };
  check('the locate button is on the map', (await page.$('[data-testid=locate-fab]')) !== null);
  await page.click('[data-testid=locate-fab]');
  await sleep(2000);
  check('a pulsing dot appears', (await page.$('.me-dot')) !== null);
  check('the button shows that the map follows', (await pressed()) === 'true');
  const v0 = await view();
  check('the map is centred on me', Math.abs(v0.lat - 32.65) < 0.03 && v0.z >= 14, JSON.stringify(v0));
  await page.setGeolocation({ latitude: 32.7, longitude: -16.8, accuracy: 30 });
  await sleep(2000);
  const v1 = await view();
  check('the map follows a new position', Math.abs(v1.lat - 32.7) < 0.03, JSON.stringify(v1));
  // the reader drags the map away: following stops
  const box = await (await page.$('.leaflet-container')).boundingBox();
  await page.mouse.move(box.x + 150, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 420, { steps: 8 });
  await page.mouse.up();
  await sleep(400);
  check('dragging the map turns following off', (await pressed()) === 'false');
  const v2 = await view();
  await page.setGeolocation({ latitude: 32.62, longitude: -16.95, accuracy: 30 });
  await sleep(2000);
  const v3 = await view();
  check('...and the map stays where it was dragged', Math.abs(v3.lat - v2.lat) < 0.005, `${v2.lat} -> ${v3.lat}`);
  await page.click('[data-testid=locate-fab]');
  await sleep(2000);
  const v4 = await view();
  check('the button centres the map on me again', Math.abs(v4.lat - 32.62) < 0.03 && (await pressed()) === 'true', JSON.stringify(v4));
  check('no page errors (location)', errors.length === 0, errors.join(' | '));
  await page.close();
  await ctx.clearPermissionOverrides();
}
{
  const hints = {};
  const agents = [
    ['android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'],
    ['ios', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'],
    ['desktop', undefined],
  ];
  for (const [name, ua] of agents) {
    const { page } = await open(`${base}#/map`, ua);
    // the permission is blocked: a stub that fails like a refused prompt
    await page.evaluate(() => {
      navigator.geolocation.watchPosition = (_ok, err) => {
        setTimeout(() => err({ code: 1, message: 'denied' }), 20);
        return 1;
      };
    });
    await page.click('[data-testid=locate-fab]');
    await sleep(500);
    hints[name] = await page.$eval('[data-testid=locate-hint]', (e) => e.innerText).catch(() => '');
    await page.close();
  }
  check('denied permission, Android: Chrome steps', /zámku\/nastavení.*Oprávnění.*Poloha.*Povolit/.test(hints.android), hints.android);
  check('denied permission, iOS: Safari steps', /aA.*Nastavení webu.*Poloha.*Povolit/.test(hints.ios), hints.ios);
  check('denied permission, desktop: browser bar steps', /Poloha není povolena/.test(hints.desktop) && /liště/.test(hints.desktop), hints.desktop);
}

// ---- 4. stops outside the ridden stretch are faint, boarding / alighting stand out
{
  const { page } = await open(`${base}#/line/5004/1/3-10`);
  await sleep(800);
  const st = await page.evaluate(() => {
    const dots = [...document.querySelectorAll('.leaflet-overlay-pane path')].filter((p) => p.getAttribute('fill') && p.getAttribute('fill') !== 'none');
    return {
      faint: dots.filter((p) => p.getAttribute('stroke-opacity') === '0.25').length,
      board: dots.filter((p) => p.getAttribute('fill') === '#16a34a').length,
      alight: dots.filter((p) => p.getAttribute('fill') === '#dc2626').length,
    };
  });
  check('stops outside the ridden stretch are faint', st.faint > 0, JSON.stringify(st));
  check('one boarding and one alighting stop are highlighted', st.board === 1 && st.alight === 1, JSON.stringify(st));
  await page.close();
}

// ---- 5. timeline of a connection with a transfer: the pieces of the rail meet exactly
{
  const { page } = await open(base);
  let ok = false;
  for (const [a, b] of [['Santana', 'Machico'], ['Porto Moniz', 'Camacha'], ['Calheta', 'Santana'], ['Ribeira Brava', 'Machico'], ['Câmara de Lobos', 'Santana']]) {
    await page.goto(`${base}?from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}&time=08:00`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const idx = await page.evaluate(() => [...document.querySelectorAll('[data-testid=connection]')].findIndex((c) => c.querySelectorAll('[class*="grid-cols-[2.75rem"]').length >= 2));
    if (idx < 0) continue;
    await page.evaluate((i) => document.querySelectorAll('[data-testid=connection]')[i].click(), idx);
    await sleep(600);
    ok = true;
    break;
  }
  check('found a connection with a transfer', ok);
  if (ok) {
    const measure = () =>
      page.evaluate(() => {
        const det = document.querySelector('[data-testid=connection-detail]');
        const segs = [...det.querySelectorAll('span[aria-hidden=true].absolute')].filter((s) => s.className.includes('-translate-x-1/2') && !s.className.includes('size-')).map((s) => s.getBoundingClientRect()).filter((b) => b.height > 0).sort((p, q) => p.top - q.top);
        const dots = [...det.querySelectorAll('span.z-10, svg.z-10')].map((d) => {
          const b = d.getBoundingClientRect();
          return b.top + b.height / 2;
        });
        const joins = [];
        for (let i = 1; i < segs.length; i++) joins.push(+(segs[i].top - segs[i - 1].bottom).toFixed(1));
        return {
          joins,
          axes: [...new Set(segs.map((b) => Math.round(b.left + b.width / 2)))],
          dotJoined: dots.map((c) => segs.some((b) => Math.abs(b.top - c) <= 2 || Math.abs(b.bottom - c) <= 2)),
        };
      });
    const m = await measure();
    check('the rail pieces touch (no gaps, no overlaps)', m.joins.length > 3 && m.joins.every((j) => Math.abs(j) <= 1), JSON.stringify(m.joins));
    check('one rail axis', m.axes.length === 1, JSON.stringify(m.axes));
    check('every dot sits where pieces of the rail meet', m.dotJoined.length >= 4 && m.dotJoined.every(Boolean), JSON.stringify(m.dotJoined));
    await page.evaluate(() => document.querySelector('[data-testid=toggle-stops]')?.click());
    await sleep(300);
    const after = await measure();
    check('expanding "Mezizastávky" keeps the rail continuous', after.joins.every((j) => Math.abs(j) <= 1), JSON.stringify(after.joins));
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  }
  await page.close();
}

await browser.close();
console.log(failed ? `${failed}/${total} FAILED` : `${total}/${total} passed`);
process.exit(failed ? 1 : 0);
