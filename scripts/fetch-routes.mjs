// Generates a road polyline for every direction without a SIGA shape, with the public OSRM router
// (router.project-osrm.org, OpenStreetMap data, ODbL). Needs a built public/data/schedules.json (`npm run build:data`).
// Output: data/shapes/<id>.json (arrays of [lat, lon]) and data/routes.json; afterwards run `npm run build:data` again.
// Re-runs only fetch directions whose stops changed. Usage: node scripts/fetch-routes.mjs [--force] [--line 139]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTE_RADIUS_M, END_RADIUS_M, hav, routeShapeId, signature, waypointsOf } from './lib-routes.mjs';
import { metres } from '../shared/geo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.OSRM_URL ?? 'https://router.project-osrm.org';
const force = process.argv.includes('--force');
const only = process.argv.includes('--line') ? process.argv[process.argv.indexOf('--line') + 1] : null;
/** a road route longer than this many times the straight stop-to-stop distance (mountain serpentines reach ~2.4), or one that lost this share of its waypoints, is a detour or loop (one-way streets): the existing route is kept */
const MAX_DETOUR = 2.6;
const MAX_DROPPED = 0.25;
const rad = Math.PI / 180;
const straightKm = (pts) => pts.slice(1).reduce((s, x, k) => s + metres(x.p, pts[k].p) / 1000, 0);
/** an end of the route further than this from its stop is joined to it with a straight piece */
const END_JOIN_M = 15;
const CHUNK = 40; // waypoints per request (the demo server allows 100)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function osrm(pts) {
  const coords = pts.map((x) => `${x.p[1]},${x.p[0]}`).join(';');
  // radiuses: a waypoint snaps to a road only within ROUTE_RADIUS_M (otherwise NoSegment and the waypoint is dropped by route())
  // the two ends of the whole route (the first and the last stop) may lie further from a road (a car park, a lay-by): wider search there
  const radiuses = pts.map((x) => (x.end ? END_RADIUS_M : ROUTE_RADIUS_M)).join(';');
  const url = `${BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=false&radiuses=${radiuses}`;
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'madeira-timetables (offline PWA; build-time route fetch)' }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429) throw new Error('HTTP 429');
      const j = await res.json();
      if (j.code === 'NoSegment') {
        const k = /coordinate:? (\d+)/i.exec(j.message ?? '');
        throw Object.assign(new Error(`NoSegment ${j.message ?? ''}`), { noSegment: k ? +k[1] : -1 });
      }
      if (j.code !== 'Ok') throw new Error(j.code + (j.message ? ` ${j.message}` : ''));
      return { line: j.routes[0].geometry.coordinates.map(([lon, lat]) => [+lat.toFixed(6), +lon.toFixed(6)]), snap: j.waypoints.map((w) => w.distance), km: j.routes[0].distance / 1000 };
    } catch (e) {
      if (e.noSegment !== undefined) throw e;
      last = e;
      await sleep(3000 * (attempt + 1));
    }
  }
  throw last;
}

/** Route through all waypoints, in overlapping chunks; a waypoint without a road within the radius is dropped and the route is asked again. */
async function route(pts) {
  let use = pts;
  const mark = () => use.forEach((x, k) => { x.end = k === 0 || k === use.length - 1; });
  mark();
  for (let round = 0; round < 40; round++) {
    const out = [];
    let km = 0;
    let bad = null;
    for (let a = 0; a < use.length - 1 && !bad; a += CHUNK - 1) {
      const part = use.slice(a, a + CHUNK);
      if (part.length < 2) break;
      try {
        const r = await osrm(part);
        km += r.km;
        out.push(...(out.length ? r.line.slice(1) : r.line));
      } catch (e) {
        if (e.noSegment === undefined || !part[e.noSegment]) throw e;
        bad = part[e.noSegment];
      }
      await sleep(400);
    }
    if (!bad) {
      // the road did not come within reach of an end stop: the line is joined to the stop's position (a straight piece) so that it ends on the pin
      const gap = (a, b) => hav(a, b) * 1000;
      if (gap(out[0], use[0].p) > END_JOIN_M) out.unshift(use[0].p);
      if (gap(out.at(-1), use.at(-1).p) > END_JOIN_M) out.push(use.at(-1).p);
      return { line: out, km, dropped: pts.length - use.length };
    }
    use = use.filter((x) => x !== bad);
    mark();
    if (use.length < 2) throw new Error('fewer than 2 waypoints near a road');
  }
  throw new Error('too many waypoints without a road');
}

const data = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'schedules.json'), 'utf8'));
const file = path.join(ROOT, 'data', 'routes.json');
const store = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { source: 'OSRM (router.project-osrm.org), OpenStreetMap contributors (ODbL)', routes: {} };
mkdirSync(path.join(ROOT, 'data', 'shapes'), { recursive: true });
let done = 0;
let skipped = 0;
const failed = [];
const suspect = [];
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
      const detour = r.km / Math.max(straightKm(pts), 0.1);
      const shapeFile = path.join(ROOT, 'data', 'shapes', `${shapeId}.json`);
      if ((detour > MAX_DETOUR || r.dropped > pts.length * MAX_DROPPED) && existsSync(shapeFile)) {
        suspect.push(`${l.number}#${i}`);
        console.warn(`${l.number} ${d.from} -> ${d.to}: ${r.km.toFixed(1)} km is ${detour.toFixed(1)}x the straight distance (${r.dropped} waypoints dropped): kept the existing route`);
        continue;
      }
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
console.log(`routes generated: ${done}, directions with fewer than 2 positioned stops: ${skipped}, failed: ${failed.length}, kept as suspect: ${suspect.length}`);
if (failed.length) process.exitCode = 1;
