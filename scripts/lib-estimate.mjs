// Estimated passing times at intermediate stops: distance along the route (shapedata polyline) / average speed.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const R = 6371.0088;
const rad = Math.PI / 180;
function hav(a, b) {
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Average commercial speed (km/h). Assumptions, not data: the PDFs only give times for terminals. */
export function speedFor(line) {
  if (line.type === 'interurbano') return 25;
  return line.municipality === 'Funchal' ? 16 : 20;
}

/**
 * Km from the first stop for every stop of a direction, measured along the polyline. Each stop snaps to the nearest
 * polyline vertex at or after the previous stop's vertex, so a route that passes the same place twice stays ordered.
 */
export function stopDistances(poly, stops) {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + hav(poly[i - 1], poly[i]));
  const out = [];
  let from = 0;
  for (const s of stops) {
    let best = from;
    let bd = Infinity;
    for (let i = from; i < poly.length; i++) {
      const d = hav(poly[i], [s.lat, s.lon]);
      if (d < bd) { bd = d; best = i; }
    }
    out.push({ km: cum[best], snapKm: bd });
    from = best;
  }
  const base = out[0].km;
  return out.map((o) => ({ km: o.km - base, snapKm: o.snapKm }));
}

/** Adds stopKm / stopOffsets / isEstimated to directions of a line (mutates). Returns number of directions estimated. */
export function addEstimates(line, shapesDir) {
  let n = 0;
  for (const dir of line.directions) {
    if (dir.trips?.length) { dir.isEstimated = false; continue; }
    const f = path.join(shapesDir, `${dir.shapeId}.json`);
    if (dir.shapeId == null || !dir.stops.length || dir.stops.some((s) => s.lat == null) || !existsSync(f)) { dir.isEstimated = false; continue; }
    const poly = JSON.parse(readFileSync(f, 'utf8'));
    const d = stopDistances(poly, dir.stops);
    // a stop far from the polyline means the geometry does not belong to this stop list; do not guess
    if (d.some((x) => x.snapKm > 0.35)) { dir.isEstimated = false; dir.estimateRejected = 'stops do not follow the route geometry'; continue; }
    const speed = speedFor(line);
    dir.speedKmh = speed;
    dir.stopKm = d.map((x) => +x.km.toFixed(2));
    dir.stopOffsets = d.map((x) => Math.round((x.km / speed) * 60));
    dir.isEstimated = true;
    n++;
  }
  return n;
}
