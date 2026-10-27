// Estimated passing times at intermediate stops: distance along the route (shapedata polyline) / average speed.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { haversineKm } from '../shared/geo.mjs';

const hav = haversineKm;

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

/**
 * Timetables that print only departures plus a "Destino Final" column (line 96): the last stop has no printed time on any trip.
 * Its arrival is estimated from the route distance since the last printed time and marked `estLast` on the trip. Returns the number of trips.
 */
export function estimateTripEnds(line, shapesDir) {
  let n = 0;
  for (const dir of line.directions) {
    const trips = dir.trips;
    const last = dir.stops.length - 1;
    if (!trips?.length || last < 1 || dir.shapeId == null || dir.stops.some((s) => s.lat == null)) continue;
    if (trips.some((t) => t.times[last])) continue;
    const f = path.join(shapesDir, `${dir.shapeId}.json`);
    if (!existsSync(f)) continue;
    const d = stopDistances(JSON.parse(readFileSync(f, 'utf8')), dir.stops);
    if (d.some((x) => x.snapKm > 0.35)) continue;
    const speed = speedFor(line);
    for (const t of trips) {
      let k = last - 1;
      while (k >= 0 && !t.times[k]) k--;
      if (k < 0) continue;
      const m = +t.times[k].slice(0, 2) * 60 + +t.times[k].slice(3) + Math.max(1, Math.round(((d[last].km - d[k].km) / speed) * 60));
      t.times[last] = String(Math.floor((m % 1440) / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      t.estLast = true;
      n++;
    }
  }
  return n;
}
