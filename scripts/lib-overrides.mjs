// Manual stop positions (data/stop-overrides.json) that win over every automatic source.
import { keyOf } from './lib-coords.mjs';

/** Applies the overrides to every matching stop; returns the number of stops changed. */
export function applyOverrides(lines, file) {
  const list = (file.overrides ?? []).map((o) => ({ ...o, key: keyOf(o.name) }));
  let n = 0;
  for (const l of lines) {
    for (const d of l.directions) {
      for (const s of d.stops) {
        const k = keyOf(s.name);
        const near = [d.stops[d.stops.indexOf(s) - 1], d.stops[d.stops.indexOf(s) + 1]].filter(Boolean).map((x) => keyOf(x.name));
        const o = list.find((x) => x.key === k && (!x.lines || x.lines.includes(l.number)) && (!x.adjacent || x.adjacent.some((a) => near.includes(keyOf(a)))));
        if (!o) continue;
        for (const f of ['approx', 'isEstimatedLocation']) delete s[f];
        const precision = o.locationPrecision ?? 'exact';
        // an exact override is an official position; anything else stays flagged as approximate
        Object.assign(s, { lat: o.lat, lon: o.lon, source: 'override', locationPrecision: precision, ...(precision !== 'exact' ? { approx: true } : {}), ...(o.osmNode ? { osmNode: o.osmNode } : {}) });
        n++;
      }
    }
  }
  return n;
}

/**
 * Funchal has one bus terminal per operator / sub-network (file.funchalTerminals): the Funchal end (first or last stop, name
 * starting with "Funchal") of a listed line is moved to its terminal. Returns the number of stops moved.
 */
export function applyFunchalTerminals(lines, file) {
  const byLine = new Map();
  for (const g of file.funchalTerminals?.groups ?? []) for (const n of g.lines) byLine.set(n, g);
  let n = 0;
  for (const l of lines) {
    const g = byLine.get(l.number);
    if (!g) continue;
    for (const d of l.directions) {
      for (const s of [d.stops[0], d.stops.at(-1)]) {
        if (!s || !keyOf(s.name).startsWith('funchal')) continue;
        for (const f of ['approx', 'isEstimatedLocation']) delete s[f];
        Object.assign(s, { lat: g.lat, lon: g.lon, source: 'override', locationPrecision: 'exact', terminal: g.id });
        n++;
      }
    }
  }
  return n;
}

const WALK_M_PER_MIN = 70;
/**
 * Walking links between the Funchal terminals (file.funchalTerminals.walks): `minutes` is a floor, the straight-line distance at 70 m
 * per minute raises it, so the planner never lets a far terminal count as next door. Returns [{a, b, min}].
 */
export function terminalWalks(file) {
  const groups = new Map((file.funchalTerminals?.groups ?? []).map((g) => [g.id, g]));
  const out = [];
  for (const w of file.funchalTerminals?.walks?.links ?? []) {
    const a = groups.get(w.a);
    const b = groups.get(w.b);
    if (!a || !b) throw new Error(`funchalTerminals.walks: unknown terminal ${!a ? w.a : w.b}`);
    const m = Math.hypot((a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110540);
    out.push({ a: w.a, b: w.b, min: Math.max(w.minutes, Math.ceil(m / WALK_M_PER_MIN)) });
  }
  return out;
}
