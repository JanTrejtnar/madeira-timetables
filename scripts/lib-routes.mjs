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
const WAYPOINT = new Set(['exact', 'interpolated', 'settlement_center', 'name_match']);

/** Ordered waypoints [lat, lon] of a direction: its stops with a position, consecutive duplicates removed. */
export function waypointsOf(dir) {
  const pts = [];
  dir.stops.forEach((s, i) => {
    if (!has(s) || !WAYPOINT.has(s.locationPrecision ?? 'exact')) return;
    const p = [+s.lat.toFixed(5), +s.lon.toFixed(5)];
    const last = pts.at(-1);
    if (last && last.p[0] === p[0] && last.p[1] === p[1]) return;
    pts.push({ p, i });
  });
  return pts;
}

/** stable signature of the waypoints: a route is reused only while the stops are unchanged */
export const signature = (pts) => pts.map((x) => x.p.join(',')).join(';');

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
