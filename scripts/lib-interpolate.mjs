// Places stops that still have no coordinates on the route polyline of their direction: a run of such stops between two
// stops with known positions gets evenly spaced points (by stop_sequence) on the stretch of the polyline between them.
// The result is marked `approx: true, isEstimatedLocation: true`.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const R = 6371.0088;
const rad = Math.PI / 180;
function hav(a, b) {
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const has = (s) => s.lat !== undefined && s.lon !== undefined;
const MAX_SNAP_KM = 0.35;

/** Position (km from the start) of the polyline vertex nearest to p, searching from vertex `from` onwards. */
function snap(poly, cum, p, from) {
  let best = -1;
  let bd = Infinity;
  for (let i = from; i < poly.length; i++) {
    const d = hav(poly[i], p);
    if (d < bd) { bd = d; best = i; }
  }
  return { i: best, d: bd };
}
const pointAt = (poly, cum, km) => {
  let i = 1;
  while (i < poly.length - 1 && cum[i] < km) i++;
  const span = cum[i] - cum[i - 1] || 1;
  const f = Math.min(1, Math.max(0, (km - cum[i - 1]) / span));
  return [poly[i - 1][0] + (poly[i][0] - poly[i - 1][0]) * f, poly[i - 1][1] + (poly[i][1] - poly[i - 1][1]) * f];
};

/** Returns the number of stops that got a position. */
export function interpolateStops(lines, shapesDir) {
  let n = 0;
  for (const l of lines) {
    for (const d of l.directions) {
      if (d.shapeId == null || d.stops.every(has) || !d.stops.some(has)) continue;
      const f = path.join(shapesDir, `${d.shapeId}.json`);
      if (!existsSync(f)) continue;
      const poly = JSON.parse(readFileSync(f, 'utf8'));
      const cum = [0];
      for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + hav(poly[i - 1], poly[i]));
      // known stops that lie on the polyline, in route order
      const anchors = [];
      let from = 0;
      d.stops.forEach((s, idx) => {
        if (!has(s)) return;
        const sn = snap(poly, cum, [s.lat, s.lon], from);
        if (sn.d > MAX_SNAP_KM) return;
        anchors.push({ idx, km: cum[sn.i] });
        from = sn.i;
      });
      for (let a = 0; a + 1 < anchors.length; a++) {
        const A = anchors[a];
        const C = anchors[a + 1];
        for (let k = A.idx + 1; k < C.idx; k++) {
          if (has(d.stops[k])) continue;
          const km = A.km + ((C.km - A.km) * (k - A.idx)) / (C.idx - A.idx);
          const p = pointAt(poly, cum, km);
          Object.assign(d.stops[k], { lat: +p[0].toFixed(6), lon: +p[1].toFixed(6), approx: true, isEstimatedLocation: true });
          n++;
        }
      }
    }
  }
  return n;
}
