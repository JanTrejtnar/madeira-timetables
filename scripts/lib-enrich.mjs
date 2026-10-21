// Gives the terminal-only directions (timetables that print no stop list) the intermediate stops of the matching pattern of the SIGA
// journey planner (data/siga-patterns.json, `npm run enrich:stops`): the main pattern of the line between the two terminals. The planner is
// the source of truth for the stops; `npm run fetch:routes` then redraws the road line through them. Its median running times replace the distance estimate.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stopDistances } from './lib-estimate.mjs';

/** one end must lie at a terminal (or carry its name); the other may be a few stops away (the Funchal terminals of the planner differ from ours) */
const NEAR_M = 1500;
const FAR_M = 4500;
/** a stop of a planner pattern counts as lying on the drawn route within this distance */
const ON_ROUTE_M = 400;
const rad = Math.PI / 180;
const metres = (a, b) => Math.hypot((a.lon - b[2]) * 111320 * Math.cos(a.lat * rad), (a.lat - b[1]) * 110540);
const fold = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** "Porto Moniz" matches "Porto Moniz (Piscinas)" / "Porto Moniz Centro": one name contains the other */
const sameName = (x, y) => {
  const a = fold(x);
  const b = fold(y);
  return a.length > 2 && b.length > 2 && (a === b || a.includes(b) || b.includes(a));
};

/** Planner route numbers a line may be listed under: its own, the 2026 one, and the 200-series number of a one-digit Rodoeste line (3 <-> 203) and 154 -> 254. */
const keysOf = (line) =>
  [...new Set([line.number, line.newNumber, +line.number < 100 ? String(200 + +line.number) : null, /^2\d\d$/.test(line.number) ? String(+line.number - 200) : null].filter(Boolean))];

/** Share of the pattern's stops that lie within ON_ROUTE_M of the polyline. */
function onRoute(poly, codes, table) {
  let near = 0;
  for (const c of codes) if (poly.some((p) => metres({ lat: p[0], lon: p[1] }, table[c]) <= ON_ROUTE_M)) near++;
  return near / codes.length;
}

/**
 * The best planner pattern for a terminal-only direction. The planner (OTP dump) is the source of truth for the stops: the drawn
 * route only ranks the candidates and never vetoes one (our OSRM line may run along another road than the bus), since the route is
 * redrawn through the planner stops afterwards (`npm run fetch:routes`). A pattern qualifies when it runs from one terminal to the
 * other, in either orientation (a reversed one is flipped); under the line's own numbers one end may be a few km off, under any
 * other number (the planner renumbered some lines) both ends must be at the terminals.
 * Candidates rank by orientation, then by the planner's trips (the main variant) when the route is unreliable, then by overlap.
 * Returns { best, share, reversed } or { why }.
 */
export function pickPattern(l, d, poly, byLine, table) {
  const [a, b] = d.stops;
  const keys = keysOf(l);
  const own = keys.flatMap((k) => byLine[k] ?? []);
  const others = Object.entries(byLine).filter(([k]) => !keys.includes(k)).flatMap(([, ps]) => ps);
  let why = own.length ? 'ends far from the terminals' : 'no planner pattern under ' + keys.join('/');
  const ok = [];
  const scan = (pool, strict) => {
    for (const p of pool) {
      if (p.stops.length <= 2) continue;
      const sa = table[p.stops[0]];
      const sb = table[p.stops.at(-1)];
      for (const reversed of [false, true]) {
        const [first, last] = reversed ? [sb, sa] : [sa, sb];
        const da = metres(a, first);
        const db = metres(b, last);
        const atA = da <= NEAR_M || sameName(first[0], a.name);
        const atB = db <= NEAR_M || sameName(last[0], b.name);
        const closeA = da <= FAR_M || atA;
        const closeB = db <= FAR_M || atB;
        if (strict ? !(atA && atB) : !((atA && closeB) || (atB && closeA))) continue;
        ok.push({ p, reversed, share: poly ? onRoute(poly, p.stops, table) : 0, da, db });
      }
    }
  };
  scan(own, false);
  if (!ok.length) scan(others, true);
  if (!ok.length) return { why };
  // forward patterns first; the main variant (most trips) before the overlap with a route that may be drawn wrongly
  ok.sort((x, y) => +x.reversed - +y.reversed || y.p.trips - x.p.trips || y.share - x.share || x.da + x.db - (y.da + y.db));
  return { best: ok[0].p, share: ok[0].share, reversed: ok[0].reversed };
}

/** Mutates lines; returns the number of directions that got intermediate stops. `report` (optional) collects { line, dir, ok, why }. */
export function enrichStops(lines, root, report) {
  const shapesDir = path.join(root, 'data', 'shapes');
  const file = path.join(root, 'data', 'siga-patterns.json');
  if (!existsSync(file)) return 0;
  const { stops: table, lines: byLine } = JSON.parse(readFileSync(file, 'utf8'));
  let n = 0;
  for (const l of lines) {
    for (const [di, d] of l.directions.entries()) {
      if (!d.terminalsOnly || d.stops.length !== 2 || d.stops.some((s) => s.lat === undefined)) continue;
      const note = (ok, why) => report?.push({ line: l.number, dir: di, from: d.from, to: d.to, ok, why });
      const shape = d.shapeId == null ? null : path.join(shapesDir, `${d.shapeId}.json`);
      const poly = shape && existsSync(shape) ? JSON.parse(readFileSync(shape, 'utf8')) : null;
      const [a, b] = d.stops;
      const { best, why, share, reversed } = pickPattern(l, d, poly, byLine, table);
      if (!best) {
        note(false, why);
        continue;
      }
      const codes = reversed ? [...best.stops].reverse() : best.stops;
      const offsets = reversed ? [...best.offsets].reverse().map((o) => best.offsets.at(-1) - o) : best.offsets;
      const mid = codes.slice(1, -1).map((c) => ({ code: c, name: table[c][0], lat: table[c][1], lon: table[c][2], locationPrecision: 'exact' }));
      d.stops = [a, ...mid, b];
      d.stopOffsets = offsets;
      d.isEstimated = true;
      d.speedKmh = undefined;
      d.stopKm = undefined;
      d.enrichedFrom = 'siga-planner';
      note(true, `${codes.length} planner stops${reversed ? ' (pattern reversed)' : ''}, ${Math.round(share * 100)} % on the old route, ${best.trips} trips`);
      n++;
    }
  }
  return n;
}

/** Distances along the drawn route for the enriched directions (after their shapes are in place). */
export function enrichedKm(lines, shapesDir) {
  for (const l of lines) {
    for (const d of l.directions) {
      if (d.enrichedFrom !== 'siga-planner' || d.shapeId == null) continue;
      const f = path.join(shapesDir, `${d.shapeId}.json`);
      if (!existsSync(f)) continue;
      const dist = stopDistances(JSON.parse(readFileSync(f, 'utf8')), d.stops);
      if (!dist.some((x) => x.snapKm > 0.35)) d.stopKm = dist.map((x) => +x.km.toFixed(2));
    }
  }
}
