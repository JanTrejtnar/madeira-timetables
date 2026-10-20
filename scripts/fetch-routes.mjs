// Generates a road polyline for every direction without a SIGA shape, with the public OSRM router
// (router.project-osrm.org, OpenStreetMap data, ODbL). Needs a built public/data/schedules.json (`npm run build:data`).
// Output: data/shapes/<id>.json (arrays of [lat, lon]) and data/routes.json; afterwards run `npm run build:data` again.
// Re-runs only fetch directions whose stops changed. Usage: node scripts/fetch-routes.mjs [--force] [--line 139]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeShapeId, signature, waypointsOf } from './lib-routes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.OSRM_URL ?? 'https://router.project-osrm.org';
const force = process.argv.includes('--force');
const only = process.argv.includes('--line') ? process.argv[process.argv.indexOf('--line') + 1] : null;
const CHUNK = 40; // waypoints per request (the demo server allows 100)
const MAX_SNAP_M = 250; // a waypoint farther from any road than this is dropped (stop position in a field)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function osrm(pts) {
  const coords = pts.map((x) => `${x.p[1]},${x.p[0]}`).join(';');
  const url = `${BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=false`;
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'madeira-timetables (offline PWA; build-time route fetch)' }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429) throw new Error('HTTP 429');
      const j = await res.json();
      if (j.code !== 'Ok') throw new Error(j.code + (j.message ? ` ${j.message}` : ''));
      return { line: j.routes[0].geometry.coordinates.map(([lon, lat]) => [+lat.toFixed(6), +lon.toFixed(6)]), snap: j.waypoints.map((w) => w.distance), km: j.routes[0].distance / 1000 };
    } catch (e) {
      last = e;
      await sleep(3000 * (attempt + 1));
    }
  }
  throw last;
}

/** Route through all waypoints, in overlapping chunks; waypoints that snap far from a road are removed and the route is asked again. */
async function route(pts) {
  let use = pts;
  for (let round = 0; round < 3; round++) {
    const out = [];
    const bad = new Set();
    let km = 0;
    for (let a = 0; a < use.length - 1; a += CHUNK - 1) {
      const part = use.slice(a, a + CHUNK);
      if (part.length < 2) break;
      const r = await osrm(part);
      await sleep(400);
      km += r.km;
      r.snap.forEach((d, k) => { if (d > MAX_SNAP_M && k > 0 && k < part.length - 1) bad.add(part[k]); });
      out.push(...(out.length ? r.line.slice(1) : r.line));
    }
    if (!bad.size) return { line: out, km, dropped: pts.length - use.length };
    use = use.filter((x) => !bad.has(x));
  }
  throw new Error('waypoints keep snapping far from roads');
}

const data = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'schedules.json'), 'utf8'));
const file = path.join(ROOT, 'data', 'routes.json');
const store = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { source: 'OSRM (router.project-osrm.org), OpenStreetMap contributors (ODbL)', routes: {} };
mkdirSync(path.join(ROOT, 'data', 'shapes'), { recursive: true });
let done = 0;
let skipped = 0;
const failed = [];
for (const l of data.lines) {
  if (only && l.number !== only) continue;
  for (let i = 0; i < l.directions.length; i++) {
    const d = l.directions[i];
    const key = `${l.id}:${i}`;
    // a SIGA shape exists (generated shapes carry shapeSource 'osrm' when build:data attaches them)
    if (d.shapeId != null && d.shapeSource !== 'osrm') continue;
    const pts = waypointsOf(d);
    if (pts.length < 2) { skipped++; continue; }
    const sig = signature(pts);
    const old = store.routes[key];
    if (!force && old && old.sig === sig && existsSync(path.join(ROOT, 'data', 'shapes', `${old.shapeId}.json`))) continue;
    try {
      const r = await route(pts);
      const shapeId = routeShapeId(l.id, i);
      writeFileSync(path.join(ROOT, 'data', 'shapes', `${shapeId}.json`), JSON.stringify(r.line));
      store.routes[key] = { shapeId, sig, line: l.number, from: d.from, to: d.to, waypoints: pts.length - r.dropped, dropped: r.dropped, km: +r.km.toFixed(1) };
      done++;
      console.log(`${l.number} ${d.from} -> ${d.to}: ${r.line.length} points, ${r.km.toFixed(1)} km, ${r.dropped} waypoints dropped`);
    } catch (e) {
      failed.push(`${l.number}#${i}: ${e.message}`);
      console.error(`${l.number}#${i} failed: ${e.message}`);
    }
  }
}
store.fetched = new Date().toISOString().slice(0, 10);
writeFileSync(file, JSON.stringify(store, null, 1));
console.log(`routes generated: ${done}, directions with fewer than 2 positioned stops: ${skipped}, failed: ${failed.length}`);
if (failed.length) process.exitCode = 1;
