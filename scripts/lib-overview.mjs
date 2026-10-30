// The whole bus network on one map (the "Mapa" tab): per line the simplified road geometry of its directions and how often it runs.
// Output (public/data/overview.json): { lines: [{ i: line id, t: weekday departures, p: [segment] }] }; a segment is a flat array of
// integers [lat0, lon0, dLat, dLon, ...] in 1e-5 degrees (delta encoded), so ~250 lines stay well below 1 MB and draw on one canvas.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TOLERANCE = 0.00012; // ~13 m: the road still reads as the road on a phone, the point count drops by 90 %
const CELL = 0.0006; // ~65 m: a direction that runs along the same road as one already drawn is not drawn twice
const SEEN_SHARE = 0.85;

/** Douglas-Peucker on [lat, lon] pairs (degrees, iterative so long shapes cannot overflow the stack). */
export function simplify(pts, eps = TOLERANCE) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [x1, y1] = pts[a];
    const [x2, y2] = pts[b];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let max = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      const u = len2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2)) : 0;
      const d = Math.hypot(x - (x1 + u * dx), y - (y1 + u * dy));
      if (d > max) {
        max = d;
        at = i;
      }
    }
    if (max > eps && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const cellOf = (p) => `${Math.round(p[0] / CELL)}:${Math.round(p[1] / CELL)}`;
const cellsAround = (p) => {
  const x = Math.round(p[0] / CELL);
  const y = Math.round(p[1] / CELL);
  const out = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(`${x + i}:${y + j}`);
  return out;
};

/** [lat0, lon0, dLat, dLon ...] in 1e-5 degrees */
export function encode(pts) {
  const out = [];
  let la = 0;
  let lo = 0;
  for (const [lat, lon] of pts) {
    const a = Math.round(lat * 1e5);
    const o = Math.round(lon * 1e5);
    out.push(a - la, o - lo);
    la = a;
    lo = o;
  }
  return out;
}

const weekdayRuns = (d) => {
  const n = (d.trips ?? []).filter((t) => t.days.includes('weekday')).length;
  return n || (d.departures?.weekday?.length ?? 0);
};

export async function buildOverview(lines, shapesDir) {
  const out = [];
  /** "Via X" places (no stop, no time): shown on the map as small points with the lines that pass them */
  const places = new Map();
  for (const l of lines) {
    const covered = new Set();
    const segments = [];
    const done = new Set();
    let runs = 0;
    for (const d of l.directions) {
      runs = Math.max(runs, weekdayRuns(d));
      if (d.shapeId == null || done.has(d.shapeId)) continue;
      done.add(d.shapeId);
      const f = path.join(shapesDir, `${d.shapeId}.json`);
      if (!existsSync(f)) continue;
      const pts = simplify(JSON.parse(await readFile(f, 'utf8')));
      if (pts.length < 2) continue;
      if (covered.size && pts.filter((p) => cellsAround(p).some((c) => covered.has(c))).length >= pts.length * SEEN_SHARE) continue;
      for (const p of JSON.parse(await readFile(f, 'utf8'))) covered.add(cellOf(p));
      segments.push(encode(pts));
    }
    // the detours through the via places ("Via Ilha"): trips with the note take them, the others the direct road drawn above
    for (const r of Object.values(l.viaRoutes ?? {})) {
      const pts = simplify(r.pts);
      if (pts.length < 2 || pts.filter((p) => cellsAround(p).some((c) => covered.has(c))).length >= pts.length * SEEN_SHARE) continue;
      for (const p of r.pts) covered.add(cellOf(p));
      segments.push(encode(pts));
    }
    if (segments.length) out.push({ i: l.id, t: runs, p: segments });
    for (const list of Object.values(l.via ?? {})) {
      for (const v of list) {
        const key = `${v.name}|${v.lat.toFixed(3)}|${v.lon.toFixed(3)}`;
        const at = places.get(key) ?? places.set(key, { n: v.name, la: Math.round(v.lat * 1e5), lo: Math.round(v.lon * 1e5), i: new Set() }).get(key);
        at.i.add(l.id);
      }
    }
  }
  return { lines: out, places: [...places.values()].map((p) => ({ ...p, i: [...p.i].sort((a, b) => a - b) })) };
}
