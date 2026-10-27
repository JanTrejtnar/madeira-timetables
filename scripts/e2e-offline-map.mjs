// End-to-end check of the offline map: Settings -> Offline maps downloads the PMTiles archive into Cache Storage (progress, size, storage line),
// after that every map is drawn from the stored pack (vector tiles on canvases) without a single request for the archive or for OpenStreetMap
// tiles; deleting the pack returns the maps to the online tiles. Uses the archive in public/maps (the committed test archive is copied there when absent).
// Usage: node scripts/e2e-offline-map.mjs [baseUrl]   (dev server `npx vite --port 5173`)
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { freezeClock, waitForServer } from './lib-e2e-clock.mjs';

// the app looks for the archive at /maps/madeira.pmtiles; without the real one there (a local file, git-ignored) the committed test archive stands in
if (!existsSync('public/maps/madeira.pmtiles')) {
  mkdirSync('public/maps', { recursive: true });
  copyFileSync('tests/fixtures/madeira-test.pmtiles', 'public/maps/madeira.pmtiles');
}
const base = process.argv[2] ?? `http://localhost:${process.env.E2E_PORT ?? process.env.PORT ?? 5173}/`;
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
await waitForServer();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--lang=cs-CZ'] });
freezeClock(browser);
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open({ archive = true } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const seen = { archive: 0, osm: 0, errors: [] };
  const state = { blockArchive: !archive, delayMs: 0 };
  page.on('pageerror', (e) => seen.errors.push(String(e)));
  page.on('framenavigated', (f) => f === page.mainFrame() && process.env.E2E_DEBUG && console.log('navigated', f.url()));
  await page.setRequestInterception(true);
  page.on('request', async (r) => {
    const u = r.url();
    if (/tile\.openstreetmap\.org/.test(u)) {
      seen.osm++;
      return r.abort();
    }
    if (/cartocdn\.com|routing\.openstreetmap\.de/.test(u)) return r.abort();
    if (/\.pmtiles/.test(u)) {
      if (state.delayMs) await sleep(state.delayMs); // a slow connection: the download can be cancelled while it runs
      if (state.blockArchive) {
        seen.archive++;
        return r.respond({ status: 404, body: 'not found' });
      }
    }
    return r.continue();
  });
  return { ctx, page, seen, state };
}
/** waitForSelector that says what the page showed instead when the selector never came */
const waitFor = async (page, sel, timeout = 8000) => {
  try {
    await page.waitForSelector(sel, { timeout });
  } catch (e) {
    console.log('waiting for', sel, '- the page shows:', (await page.evaluate(() => document.body.innerText)).replace(/s+/g, ' ').slice(0, 400));
    throw e;
  }
};
/** a tap that lands on the element, not on the fixed bottom navigation that covers the lower edge of the page */
const tap = async (page, sel) => {
  await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
  await page.click(sel);
};
const text = (page, sel) => page.$eval(sel, (e) => e.textContent).catch(() => null);
/** canvases of the vector layer that have something drawn on them */
const drawnTiles = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('canvas.leaflet-tile')].filter((c) => {
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
      return false;
    }).length,
  );

// 1. no archive on the server: the feature is not offered
{
  const { ctx, page } = await open({ archive: false });
  await page.goto(`${base}#/settings`, { waitUntil: 'networkidle0' });
  await sleep(800);
  check('no archive on the server: no "Offline maps" section', (await page.$('[data-testid=offline-maps]')) === null);
  await ctx.close();
}

// 2. download, then maps from the stored pack
{
  const { ctx, page, seen, state } = await open();
  await page.goto(`${base}#/settings`, { waitUntil: 'networkidle0' });
  await waitFor(page, '[data-testid=offline-download]', 8000);
  const label = await text(page, '[data-testid=offline-download]');
  check('the section offers the download with its size', /Stáhnout mapu \(\d+(\.\d)? (kB|MB)\)/.test(label ?? ''), label ?? '');
  check('the storage line is shown', /Úložiště zařízení: .+ z .+/.test((await text(page, '[data-testid=offline-storage]')) ?? ''));
  await tap(page, '[data-testid=offline-download]');
  await waitFor(page, '[data-testid=offline-remove]', 30000);
  const status = await text(page, '[data-testid=offline-status]');
  check('installed: the status names the size', /Mapa je uložená v zařízení \(\d/.test(status ?? ''), status ?? '');
  const stored = await page.evaluate(async () => {
    const c = await caches.open('offline-maps-v1');
    const keys = (await c.keys()).map((k) => k.url);
    return { chunks: keys.filter((k) => /chunk-\d+$/.test(k)).length, meta: keys.some((k) => k.endsWith('/meta')), partial: keys.some((k) => k.endsWith('/partial')), flag: localStorage.getItem('offlineMap') };
  });
  check('the chunks and the install record are in Cache Storage, no leftover of the download', stored.chunks >= 1 && stored.meta && !stored.partial && !!stored.flag, JSON.stringify(stored));

  // from now on the archive is unreachable: the map must come from the stored pack
  state.blockArchive = true;
  seen.archive = 0;
  seen.osm = 0;
  await page.evaluate(() => { location.hash = '#/map'; });
  await waitFor(page, '[data-testid=map-tab] .leaflet-container', 10000);
  let drawn = 0;
  for (let i = 0; i < 40 && !drawn; i++) {
    await sleep(250);
    drawn = await drawnTiles(page);
  }
  check('the map draws vector tiles from the stored pack', drawn > 0, `${drawn} drawn canvases`);
  check('...without requesting the archive or any OpenStreetMap tile', seen.archive === 0 && seen.osm === 0, `archive ${seen.archive}, osm ${seen.osm}`);
  check('...the attribution names OpenStreetMap and Protomaps', await page.evaluate(() => /OpenStreetMap/.test(document.querySelector('.leaflet-control-attribution')?.textContent ?? '') && /Protomaps/.test(document.querySelector('.leaflet-control-attribution')?.textContent ?? '')));

  // dark theme: the layer is rebuilt in the dark flavour, nothing breaks
  await page.evaluate(() => { document.documentElement.classList.add('dark'); });
  await sleep(1500);
  check('switching to the dark theme redraws the map', (await drawnTiles(page)) > 0 && seen.errors.length === 0, seen.errors.join(' | '));
  await page.evaluate(() => { document.documentElement.classList.remove('dark'); });

  // 3. delete: back to the online tiles
  await page.evaluate(() => { location.hash = '#/settings'; });
  await waitFor(page, '[data-testid=offline-remove]', 8000);
  state.blockArchive = false;
  await tap(page, '[data-testid=offline-remove]');
  await waitFor(page, '[data-testid=offline-download]', 8000);
  const after = await page.evaluate(async () => ({ keys: (await (await caches.open('offline-maps-v1')).keys()).length, flag: localStorage.getItem('offlineMap') }));
  check('delete empties the store and clears the flag', after.keys === 0 && after.flag === null, JSON.stringify(after));
  seen.osm = 0;
  await page.evaluate(() => { location.hash = '#/map'; });
  await waitFor(page, '[data-testid=map-tab] .leaflet-container', 10000);
  await sleep(1500);
  check('without the pack the map asks for the online tiles again', seen.osm > 0, `${seen.osm} requests`);
  await ctx.close();
}

// 4. a cancelled download installs nothing and a new one completes the pack
{
  const { ctx, page, state } = await open();
  await page.goto(`${base}#/settings`, { waitUntil: 'networkidle0' });
  await waitFor(page, '[data-testid=offline-download]');
  state.delayMs = 1500;
  await tap(page, '[data-testid=offline-download]');
  await waitFor(page, '[data-testid=offline-cancel]');
  check('while downloading there is a progress bar and a cancel button', (await page.$('[data-testid=offline-progress]')) !== null);
  await tap(page, '[data-testid=offline-cancel]');
  await waitFor(page, '[data-testid=offline-download]');
  const flag = await page.evaluate(() => localStorage.getItem('offlineMap'));
  check('cancelled: nothing is installed and no error is shown', flag === null && (await page.$('[data-testid=offline-error]')) === null && (await page.$('[data-testid=offline-remove]')) === null);
  state.delayMs = 0;
  await tap(page, '[data-testid=offline-download]');
  await waitFor(page, '[data-testid=offline-remove]', 30000);
  check('a new download completes the pack', (await page.evaluate(() => localStorage.getItem('offlineMap'))) !== null);
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
