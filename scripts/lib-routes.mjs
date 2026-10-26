// Road routes (OSRM) for directions that have no SIGA polyline. `npm run fetch:routes` reads the stops of the built
// public/data/schedules.json, asks the OSRM router for a driving route through them and stores the polyline as
// data/shapes/<id>.json plus data/routes.json (committed). build:data then attaches those shapes (shapeSource: 'osrm').
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** shape ids of generated routes start here; SIGA ids are five digits */
export const ROUTE_ID_BASE = 1_000_000;
export const routeShapeId = (lineId, dirIdx) => ROUTE_ID_BASE + lineId * 10 + dirIdx;

const has = (s) => s.lat !== undefined && s.lon !== undefined;
// name_match / settlement_center positions may lie in a field: they are only waypoints when the router finds a road next to them
const WAYPOINT = new Set(['exact', 'interpolated', 'settlement_center', 'name_match', 'manual_osm_match']);

/** Ordered waypoints [lat, lon] of a direction: its stops with a position, consecutive duplicates removed. */
export function waypointsOf(dir) {
  const pts = [];
  dir.stops.forEach((s, i) => {
    if (!has(s) || !WAYPOINT.has(s.locationPrecision ?? 'exact')) return;
    const p = [+s.lat.toFixed(5), +s.lon.toFixed(5)];
    const last = pts.at(-1);
    if (last && last.p[0] === p[0] && last.p[1] === p[1]) return;
    pts.push({ p, i, prec: s.locationPrecision ?? 'exact' });
  });
  return dropOutliers(pts);
}

const R = 6371.0088;
const rad = Math.PI / 180;
export function hav(a, b) {
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const MIN_EXCESS_KM = 4;
const RUN = 3; // runs of up to this many consecutive waypoints are tested together (a wrong namesake often comes with its neighbour)

/**
 * A stop matched by name to a namesake far away ("Moinhos" in Caniço instead of the one by Porto da Cruz) would send the route
 * across the island and back. Runs of 1-3 consecutive waypoints without an official position are left out when going through
 * them is much longer than going straight between their neighbours (more than MIN_EXCESS_KM and more than 1.5x that distance);
 * the run with the biggest excess per waypoint goes first, until none is left. A curving road (Cabo Girão - Ribeira Brava - Serra de Água) stays.
 */
export function dropOutliers(pts) {
  const out = [...pts];
  for (;;) {
    let best = null;
    for (let k = 1; k < out.length - 1; k++) {
      for (let len = 1; len <= RUN && k + len < out.length; len++) {
        const run = out.slice(k, k + len);
        if (run.some((x) => x.prec === 'exact')) break;
        let via = hav(out[k - 1].p, run[0].p) + hav(run.at(-1).p, out[k + len].p);
        for (let r = 1; r < len; r++) via += hav(run[r - 1].p, run[r].p);
        const direct = hav(out[k - 1].p, out[k + len].p);
        const excess = via - direct;
        if (direct >= 1 && excess > MIN_EXCESS_KM && excess > 1.5 * direct && (!best || excess / len > best.score)) best = { k, len, score: excess / len };
      }
    }
    if (!best) return out;
    out.splice(best.k, best.len);
  }
}

/** a waypoint must lie within this many metres of a road (OSRM `radiuses`), else it is left out: no detour into a dead end for a stop beside the road */
export const ROUTE_RADIUS_M = 45;

/** the first and the last waypoint of a route snap to a road within this many metres (not part of the signature: existing routes stay) */
export const END_RADIUS_M = 200;

/** stable signature of the waypoints and the snapping rule: a route is reused only while both are unchanged */
export const signature = (pts) => `r${ROUTE_RADIUS_M}|` + pts.map((x) => x.p.join(',')).join(';');

/** Attaches the generated routes of data/routes.json to directions without a shape; returns the number attached. */
export function attachRoutes(lines, root) {
  const f = path.join(root, 'data', 'routes.json');
  if (!existsSync(f)) return { attached: 0, stale: 0 };
  const routes = JSON.parse(readFileSync(f, 'utf8')).routes;
  let attached = 0;
  let stale = 0;
  for (const l of lines) {
    l.directions.forEach((d, i) => {
      if (d.shapeId != null) return;
      const r = routes[`${l.id}:${i}`];
      if (!r) return;
      if (!existsSync(path.join(root, 'data', 'shapes', `${r.shapeId}.json`))) { stale++; return; }
      d.shapeId = r.shapeId;
      d.shapeSource = 'osrm';
      attached++;
    });
  }
  return { attached, stale };
}
