// Road geometry through the "Via X" places of a stretch, so the route line on the map really passes them (Santana -> Ilha -> São Jorge)
// instead of running straight past. For every (line, note, direction, stop the places follow) the stretch of the SIGA / OSRM polyline between
// that stop and the next one with a position is replaced by an OSRM route stop -> place(s) -> stop. Needs a built public/data/schedules.json.
// Output: data/via-routes.json (committed); build:data attaches the entries whose places did not move as `line.viaRoutes`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placesSig, routeKey } from './lib-via.mjs';
import { haversineKm, localSq } from '../shared/geo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.OSRM_URL ?? 'https://router.project-osrm.org';
const STOP_RADIUS_M = 200;
const PLACE_RADIUS_M = 400;
const hav = haversineKm;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (s) => s.lat !== undefined && s.lon !== undefined;


async function osrm(pts) {
  const coords = pts.map((x) => `${x.p[1]},${x.p[0]}`).join(';');
  const radiuses = pts.map((x) => x.r).join(';');
  const url = `${BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=false&radiuses=${radiuses}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'madeira-timetables (offline PWA; build-time route fetch)' }, signal: AbortSignal.timeout(60_000) });
      const j = await res.json();
      if (j.code !== 'Ok') return null;
      return { pts: j.routes[0].geometry.coordinates.map(([lon, lat]) => [+lat.toFixed(5), +lon.toFixed(5)]), km: j.routes[0].distance / 1000 };
    } catch {
      await sleep(3000 * (attempt + 1));
    }
  }
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'schedules.json'), 'utf8'));
  const file = path.join(ROOT, 'data', 'via-routes.json');
  const store = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { source: 'OSRM (router.project-osrm.org), OpenStreetMap contributors (ODbL)', routes: {} };
  const out = {};
  let fetched = 0;
  let kept = 0;
  const nearest = (poly, p, from) => {
    let best = from;
    let bd = Infinity;
    for (let i = from; i < poly.length; i++) {
      const d2 = localSq(poly[i], p);
      if (d2 < bd) { bd = d2; best = i; }
    }
    return best;
  };
  /** p is (still) a vertex of the polyline */
  const anchored = (poly, p) => localSq(poly[nearest(poly, p, 0)], p) < 1e-10;
  for (const line of data.lines) {
    if (!line.via) continue;
    for (const [code, places] of Object.entries(line.via)) {
      for (let di = 0; di < line.directions.length; di++) {
        const d = line.directions[di];
        const f = d.shapeId != null ? path.join(ROOT, 'public', 'data', 'shapes', `${d.shapeId}.json`) : null;
        if (!f || !existsSync(f)) continue;
        const poly = JSON.parse(readFileSync(f, 'utf8'));
        const groups = new Map(); // stop the places follow -> places in travel order
        for (const p of places) if (p.after[di] !== undefined) (groups.get(p.after[di]) ?? groups.set(p.after[di], []).get(p.after[di])).push(p);
        for (const [after, list] of groups) {
          if (list.every((p) => p.at?.[di] !== undefined)) list.sort((a, b) => a.at[di] - b.at[di]);
          const a = d.stops[after];
          const bIdx = d.stops.findIndex((s, i) => i > after && has(s));
          if (!has(a) || bIdx < 0) continue;
          const b = d.stops[bIdx];
          const key = `${line.id}|${routeKey(code, di, after)}`;
          const sig = placesSig(list);
          // a stored route is reused while the places did not move AND the polyline it replaces is still the one it was made for (its anchor points are vertices of it):
          // when the route of the direction was redrawn (a stop moved), the anchors no longer fit and the detour would silently not be drawn
          const old = store.routes[key];
          if (old?.sig === sig && anchored(poly, old.a) && anchored(poly, old.b)) { out[key] = old; kept++; continue; }
          let at = 0;
          let stopAt = null;
          for (let i = 0; i < d.stops.length && i <= bIdx; i++) {
            if (!has(d.stops[i])) continue;
            at = nearest(poly, [d.stops[i].lat, d.stops[i].lon], at);
            if (i === after) stopAt = { from: at };
            if (i === bIdx && stopAt) stopAt.to = at;
          }
          if (!stopAt || stopAt.to === undefined || stopAt.to <= stopAt.from) continue;
          const r = await osrm([{ p: [a.lat, a.lon], r: STOP_RADIUS_M }, ...list.map((p) => ({ p: [p.lat, p.lon], r: PLACE_RADIUS_M })), { p: [b.lat, b.lon], r: STOP_RADIUS_M }]);
          await sleep(400);
          // a detour is a few km longer than the road it replaces (5 km for every place it visits: out to a spur and back); much more means the router took another way round
          let own = 0;
          for (let i = stopAt.from + 1; i <= stopAt.to; i++) own += hav(poly[i - 1], poly[i]);
          if (r && r.km > own * 2.5 + 5 * list.length) { console.warn('skipped (route', r.km.toFixed(1), 'km vs', own.toFixed(1), 'km of the line)', line.number, code, di, after); continue; }
          if (!r) { console.warn('no route', line.number, code, di, after); continue; }
          out[key] = { sig, a: poly[stopAt.from], b: poly[stopAt.to], km: +r.km.toFixed(2), pts: r.pts };
          fetched++;
          console.log(line.number, code, 'dir', di, 'after', after, list.map((p) => p.name).join('+'), r.km.toFixed(1), 'km', r.pts.length, 'points');
        }
      }
    }
  }
  writeFileSync(file, JSON.stringify({ source: store.source, routes: out }));
  console.log('fetched', fetched, 'kept', kept);
}
