// Timetables that print only departure times and no stop list (scanned PDFs, CAM sheets) have directions without stops, which
// the planner cannot use. data/terminals.json holds hand-checked positions of their terminals: such a direction gets the two
// terminals as its stops, a road route (OSRM, `npm run fetch:routes`) and estimated times, so "Via X" places can be inserted.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { keyOf } from './lib-coords.mjs';
import { stopDistances, speedFor } from './lib-estimate.mjs';

/** The terminal entry of a printed name for a line: an entry, or a list of entries when namesakes (Vargem, Moinhos, Corrida ...) exist, each limited by `lines`. */
export function findTerminal(terminals, line, name) {
  const v = terminals[keyOf(name.replace(/�/g, ''))];
  return (Array.isArray(v) ? v : v ? [v] : []).find((t) => !t.lines || t.lines.includes(String(line.number))) ?? null;
}
const resolve = findTerminal;

/** Gives stop-less directions their two terminals. Returns { done: number of directions, skipped: [line:name, ...] }. */
export function addTerminalStops(lines, root) {
  const f = path.join(root, 'data', 'terminals.json');
  const out = { done: 0, skipped: [] };
  if (!existsSync(f)) return out;
  const terminals = JSON.parse(readFileSync(f, 'utf8')).terminals;
  for (const l of lines) {
    if (!l.hasParsedSchedule) continue;
    for (const d of l.directions) {
      if (d.stops.length || !d.from || !d.to) continue;
      const a = resolve(terminals, l, d.from);
      const b = resolve(terminals, l, d.to);
      if (!a || !b) { out.skipped.push(`${l.number}: ${d.from} - ${d.to}`); continue; }
      // a bus stop of OSM is an official position; the middle of a village (or a hand-checked terminal) is only approximate
      d.stops = [a, b].map((t) => ({ code: null, name: t.name, lat: t.lat, lon: t.lon, ...(t.precision === 'exact' ? { locationPrecision: 'exact' } : { approx: true, locationPrecision: 'settlement_center' }) }));
      d.terminalsOnly = true;
      out.done++;
    }
  }
  return out;
}

/** Estimated times for the terminal-only directions once their route is attached (no printed times at the far terminal). */
export function estimateTerminals(lines, shapesDir) {
  let n = 0;
  for (const l of lines) {
    for (const d of l.directions) {
      if (!d.terminalsOnly || d.shapeId == null) continue;
      const file = path.join(shapesDir, `${d.shapeId}.json`);
      if (!existsSync(file)) continue;
      const dist = stopDistances(JSON.parse(readFileSync(file, 'utf8')), d.stops);
      if (dist.some((x) => x.snapKm > 0.35)) continue;
      const speed = speedFor(l);
      d.speedKmh = speed;
      d.stopKm = dist.map((x) => +x.km.toFixed(2));
      d.stopOffsets = dist.map((x) => Math.round((x.km / speed) * 60));
      d.isEstimated = true;
      n++;
    }
  }
  return n;
}
