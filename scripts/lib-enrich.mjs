// Gives the terminal-only directions (timetables that print no stop list) the intermediate stops of the matching pattern of the SIGA
// journey planner (data/siga-patterns.json, `npm run enrich:stops`): the main pattern of the line between the two terminals. The planner is
// the source of truth for the stops; `npm run fetch:routes` then redraws the road line through them. Its median running times replace the distance estimate.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stopDistances } from './lib-estimate.mjs';
import { metres as flatMetres, norm } from '../shared/geo.mjs';

/** one end must lie at a terminal (or carry its name); the other may be a few stops away (the Funchal terminals of the planner differ from ours) */
const NEAR_M = 1500;
const FAR_M = 4500;
const PINNED = {
  // [a name of the direction's ends, first stop code, last stop code] (in the direction of travel)
  201: [['vargem', '01705', '10011'], ['vargem', '10004', '01705'], ['frades', '01705', '13078'], ['frades', '13105', '01705']],
};
/** a stop of a planner pattern counts as lying on the drawn route within this distance */
const ON_ROUTE_M = 400;
/** metres from a point { lat, lon } to a table row [id, lat, lon] */
const metres = (a, b) => flatMetres(a, { lat: b[1], lon: b[2] });
const fold = (s) => norm(String(s).replace(/\(.*?\)/g, ' '));
/** "Porto Moniz" matches "Porto Moniz (Piscinas)" / "Porto Moniz Centro": one name contains the other */
const sameName = (x, y) => {
  const a = fold(x);
  const b = fold(y);
  return a.length > 2 && b.length > 2 && (a === b || a.includes(b) || b.includes(a));
};

/** Planner route numbers a line may be listed under: its own, the 2026 one, and the 200-series number of a one-digit Rodoeste line (3 <-> 203) and 154 -> 254. */
const keysOf = (line) =>
  [...new Set([...(PINNED[line.number] ? ['236'] : []), line.number, line.newNumber, +line.number < 100 ? String(200 + +line.number) : null, /^2\d\d$/.test(line.number) ? String(+line.number - 200) : null].filter(Boolean))];

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
  // 201: Ponte dos Frades and the Cam. Ribeiro Real loop lie 200 m apart and the planner splits the line into five routes, so the busiest or the
  // closest pattern is not the right one; the patterns that run between the printed terminals are pinned by their end stops
  const pins = PINNED[l.number];
  if (pins) {
    const end = (c) => (c.reversed ? [c.p.stops.at(-1), c.p.stops[0]] : [c.p.stops[0], c.p.stops.at(-1)]);
    const pinned = ok.filter((c) => pins.some(([n, f, t]) => fold(d.from + ' ' + d.to).includes(n) && end(c)[0] === f && end(c)[1] === t));
    if (pinned.length) ok.splice(0, ok.length, ...pinned);
  }
  // the main variant (most daily trips) wins over one-off school or combined runs; a forward pattern is preferred over a flipped one
  // only while it runs at least half as often as the busiest candidate
  ok.sort((x, y) => y.p.trips - x.p.trips || +x.reversed - +y.reversed || y.share - x.share || x.da + x.db - (y.da + y.db));
  const top = ok[0].p.trips;
  const pick = ok.find((c) => !c.reversed && c.p.trips * 2 >= top) ?? ok[0];
  ok.unshift(ok.splice(ok.indexOf(pick), 1)[0]);
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

/** Service code at the end of a planner trip id (`1:op2_201_0_1_1230_1259_0_UE`) -> day key. */
const DAY_OF = { UE: 'weekday', S: 'saturday', D: 'sunday' };

/**
 * A timetable that prints no departures for a direction (201 Funchal > Ponte dos Frades: "-----") gets the trips of the planner pattern
 * its stops came from (data/sources/siga/siga-otp-dump.json): the departure from the first stop, per weekday / Saturday / Sunday.
 * Printed times are never replaced: the planner trips only fill a direction without any, or (line 201) add the ones the PDF lacks. Returns the number of directions filled.
 */
export function addPlannerDepartures(lines, root) {
  const file = path.join(root, 'data', 'sources', 'siga', 'siga-otp-dump.json');
  if (!existsSync(file)) return 0;
  let patterns = null;
  let n = 0;
  for (const l of lines) {
    for (const d of l.directions) {
      // a direction without printed times is filled; on the lines listed in PINNED (201) the planner trips are added to the printed ones
      if (d.enrichedFrom !== 'siga-planner' || (!PINNED[l.number] && Object.values(d.departures).some((v) => v?.length))) continue;
      patterns ??= JSON.parse(readFileSync(file, 'utf8')).routes.flatMap((r) => r.patterns ?? []);
      // the pattern whose stop codes are the ones given to the direction (terminals aside)
      const mid = d.stops.slice(1, -1).map((s) => s.code).join(',');
      const p = patterns.find((x) => x.stops.slice(1, -1).map((s) => s.code).join(',') === mid);
      if (!p) continue;
      let added = 0;
      for (const tr of p.trips ?? []) {
        const day = DAY_OF[tr.gtfsId.split('_').pop()];
        const s = tr.stoptimes?.[0]?.scheduledDeparture;
        if (!day || s === undefined) continue;
        const t = `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
        const list = (d.departures[day] ??= []);
        if (list.some((x) => x.t === t)) continue;
        list.push({ t });
        added++;
      }
      for (const v of Object.values(d.departures)) v.sort((x, y) => x.t.localeCompare(y.t));
      if (added) {
        d.departuresFrom = 'siga-planner';
        n++;
      }
    }
  }
  return n;
}

/**
 * Lines whose directions the terminal match cannot place (994 Porto Santo: the PDF prints "Centro", "Calheta" and "Aeroporto" with no
 * destination) get the full stop list of a named planner route: [direction's printed start, route id of data/siga-patterns.json].
 * Runs before the routes are drawn. Returns the number of directions filled.
 */
const PINNED_ROUTES = {
  994: { CENTRO: 'Calheta0I', CALHETA: 'Calheta0V', AEROPORTO: 'CalhetaAI' },
};
export function pinPatternStops(lines, root) {
  const file = path.join(root, 'data', 'siga-patterns.json');
  if (!existsSync(file)) return 0;
  const { stops: table, lines: byLine } = JSON.parse(readFileSync(file, 'utf8'));
  let n = 0;
  for (const l of lines) {
    const pins = PINNED_ROUTES[l.number];
    if (!pins) continue;
    for (const d of l.directions) {
      const p = (byLine[l.number] ?? []).find((x) => x.route === pins[String(d.from).toUpperCase()]);
      if (!p || d.stops.length) continue;
      d.stops = p.stops.map((c) => ({ code: c, name: table[c][0].replace(/^Calheta término$/, 'Calheta (Porto Santo)'), lat: table[c][1], lon: table[c][2], locationPrecision: 'exact' }));
      d.stopOffsets = p.offsets;
      d.isEstimated = true;
      d.enrichedFrom = 'siga-planner';
      n++;
    }
  }
  return n;
}

/**
 * Trips of a direction that follow another planner route get a direction of their own: 994 "Calheta" trips noted "a" (Termino Aeroporto)
 * continue from the centre to the airport (route CalhetaAV); the others end at the centre. Appended after the existing directions.
 * Run after pinPatternStops. Returns the number of directions added.
 */
const SPLIT_BY_NOTE = {
  994: { CALHETA: { note: 'a', route: 'CalhetaAV', to: 'AEROPORTO' } },
};
export function splitDirectionsByNote(lines, root) {
  const file = path.join(root, 'data', 'siga-patterns.json');
  if (!existsSync(file)) return 0;
  const { stops: table, lines: byLine } = JSON.parse(readFileSync(file, 'utf8'));
  let n = 0;
  for (const l of lines) {
    const rule = SPLIT_BY_NOTE[l.number];
    if (!rule) continue;
    for (const d of [...l.directions]) {
      const r = rule[String(d.from).toUpperCase()];
      const p = r && (byLine[l.number] ?? []).find((x) => x.route === r.route);
      if (!p || !d.stops.length) continue;
      const departures = {};
      for (const [day, list] of Object.entries(d.departures)) {
        const moved = list.filter((x) => x.notes?.includes(r.note));
        if (!moved.length) continue;
        departures[day] = moved;
        d.departures[day] = list.filter((x) => !x.notes?.includes(r.note));
      }
      if (!Object.keys(departures).length) continue;
      const stops = p.stops.map((c) => ({ code: c, name: table[c][0].replace(/^Calheta término$/, 'Calheta (Porto Santo)'), lat: table[c][1], lon: table[c][2], locationPrecision: 'exact' }));
      l.directions.push({ ...d, to: r.to, stops, stopOffsets: p.offsets, shapeId: null, departures });
      n++;
    }
  }
  return n;
}

/**
 * Directions whose timetable prints only a few timing points (96: Funchal, Estreito, the terminus) get the road's intermediate stops from
 * the planner pattern that runs the same road: the printed stops stay (anchors, with their printed times), the planner stops are inserted
 * between them and the trip gets an estimated time there (the planner's running times, scaled to the printed anchors). A trip that skips
 * an anchor (null time) is not served beyond its non-null anchors. Only the lines listed here, for the directions whose anchors all lie
 * near the pattern (within ANCHOR_FAR_M, in order); the others keep their stops. Run after the trips' estimated last arrival is set.
 * `printedIdx` of the direction lists the stops whose times are printed (the others are estimates). Returns { n, report }.
 */
const SPARSE = {
  96: { key: '296', route: 'Funchal - Jardim da Serra via Corticeiras', forward: 'Jardim Serra|via Corticeiras', reverse: 'Funchal|via Corticeiras' },
};
const ANCHOR_NEAR_M = 400;
const ANCHOR_FAR_M = 3000;
const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
const hhmm = (m) => String(Math.floor((m % 1440) / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
export function fillSparseStops(lines, root) {
  const file = path.join(root, 'data', 'siga-patterns.json');
  const report = [];
  if (!existsSync(file)) return { n: 0, report };
  const { stops: table, lines: byLine } = JSON.parse(readFileSync(file, 'utf8'));
  const planner = (c) => ({ code: c, name: table[c][0], lat: table[c][1], lon: table[c][2], locationPrecision: 'exact' });
  let n = 0;
  for (const l of lines) {
    const rule = SPARSE[l.number];
    if (!rule) continue;
    for (const [di, d] of l.directions.entries()) {
      if (!d.trips?.length || d.stops.length < 2 || d.stops.length > 5 || d.stopsFrom || d.enrichedFrom) continue;
      const note = (ok, why) => report.push({ line: l.number, dir: di, from: d.from, to: d.to, ok, why });
      if (d.stops.some((s) => s.lat === undefined)) { note(false, 'a printed stop has no position'); continue; }
      const forward = sameName(d.stops[0].name, 'Funchal');
      const reverse = sameName(d.stops.at(-1).name, 'Funchal');
      if (forward === reverse) { note(false, 'not a Funchal terminal direction'); continue; }
      const p = (byLine[rule.key] ?? []).find((x) => x.route === rule.route && x.headsign === (forward ? rule.forward : rule.reverse));
      if (!p) { note(false, 'no planner pattern'); continue; }
      // anchor = a printed stop; its index in the pattern = the nearest planner stop (never going back)
      const anchors = [];
      let from = 0;
      for (const s of d.stops) {
        let best = null;
        p.stops.forEach((c, i) => {
          if (i < from) return;
          const m = metres(s, table[c]);
          if (!best || m < best.m) best = { i, m };
        });
        if (!best || best.m > ANCHOR_FAR_M) break;
        anchors.push({ ...best, stop: s, near: best.m <= ANCHOR_NEAR_M });
        from = best.i;
      }
      if (anchors.length !== d.stops.length) { note(false, 'a printed stop does not lie on the planner pattern'); continue; }
      const first = anchors[0];
      const last = anchors.at(-1);
      if (first.i >= last.i) { note(false, 'anchors in the wrong order'); continue; }
      // a terminal near a planner stop replaces it; a printed place name in the middle (Estreito, Corticeiras) never deletes a real stop (a school, a church) and, like a stop off the pattern, is placed after the planner stop it is nearest to (the first one before)
      anchors.forEach((a, k) => { a.replace = a.near && (k === 0 || k === anchors.length - 1); });
      const items = [];
      anchors.forEach((a, k) => items.push({ stop: a.stop, off: p.offsets[a.i], i: a.i, order: a.replace ? 0 : k === 0 ? -1 : 1 }));
      p.stops.forEach((c, i) => {
        if (i <= first.i || i > last.i || anchors.some((a) => a.replace && a.i === i)) return;
        items.push({ stop: planner(c), off: p.offsets[i], i, order: 0 });
      });
      items.sort((x, y) => x.i - y.i || x.order - y.order);
      if (items[0].stop !== first.stop || items.at(-1).stop !== last.stop) { note(false, 'terminals not at the ends after merge'); continue; }
      for (let k = 1; k < items.length; k++) items[k].off = Math.max(items[k].off, items[k - 1].off);
      const printedAt = anchors.map((a) => items.findIndex((x) => x.stop === a.stop));
      for (const tr of d.trips) {
        let prev = -Infinity;
        let wrap = 0;
        const abs = [];
        printedAt.forEach((ix, k) => {
          if (!tr.times[k]) return;
          let m = mins(tr.times[k]) + wrap;
          if (m < prev) { wrap += 1440; m += 1440; }
          prev = m;
          abs.push({ ix, m });
        });
        const out = new Array(items.length).fill(null);
        abs.forEach((a, k) => {
          out[a.ix] = hhmm(a.m);
          const nx = abs[k + 1];
          if (!nx) return;
          const span = items[nx.ix].off - items[a.ix].off;
          for (let ix = a.ix + 1; ix < nx.ix; ix++) {
            if (printedAt.includes(ix)) continue; // a printed stop without a time: the trip skips it
            const f = span > 0 ? (items[ix].off - items[a.ix].off) / span : (ix - a.ix) / (nx.ix - a.ix);
            out[ix] = hhmm(Math.round(a.m + f * (nx.m - a.m)));
          }
        });
        tr.times = out;
      }
      const lastEst = d.trips.some((t) => t.estLast);
      d.printedIdx = printedAt.filter((_, k) => !(lastEst && k === printedAt.length - 1));
      d.stops = items.map((x) => x.stop);
      d.stopsFrom = 'siga-planner';
      note(true, `${d.stops.length} stops (${anchors.length} printed anchors, ${anchors.filter((a) => !a.near).length} of them off the pattern), ${d.trips.length} trips`);
      n++;
    }
  }
  return { n, report };
}
