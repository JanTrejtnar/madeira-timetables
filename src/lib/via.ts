// "Via X" notes (e.g. 208 "a" = "Via Aeroporto"): for a trip carrying such a note, the place is a real call between two stops of
// the list. build:data resolves the place (`line.via`); here it is inserted into the stop list of the selected trip with a time
// interpolated between the neighbouring stops. "Via Rápida" (motorway) has no entry and stays a plain note.
import type { Direction, Line, Stop } from '../types';
import { fmtMinutes, toMinutes } from './time';

export interface ShownStops {
  stops: Stop[];
  /** index into `dir.stops`, null for an inserted "via" place */
  srcIdx: (number | null)[];
  /** estimated passing time of the inserted places ("HH:MM"), null elsewhere / when the neighbours have no time */
  viaTimes: (string | null)[];
}

const R = 6371.0088;
const rad = Math.PI / 180;
function km(a: Stop, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat!) * rad;
  const dLon = (b.lon - a.lon!) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat! * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const placed = (s: Stop | undefined): s is Stop & { lat: number; lon: number } => !!s && s.lat !== undefined && s.lon !== undefined;

/**
 * The stops of `dir` as shown for a trip with `notes`; `times` = passing time at every stop of `dir` (null = none).
 * Returns `dir.stops` itself (same array) when the trip has no "via" place, so memoised consumers do not rebuild.
 */
export function withVia(line: Line, dirIndex: number, dir: Direction, notes: readonly string[] | undefined, times: readonly (string | null)[]): ShownStops {
  const none: ShownStops = { stops: dir.stops, srcIdx: dir.stops.map((_, i) => i), viaTimes: dir.stops.map(() => null) };
  if (!line.via || !notes?.length) return none;
  const inserts = new Map<number, Stop[]>();
  for (const code of notes) {
    const v = line.via[code];
    const after = v?.after[dirIndex];
    if (!v || after === undefined) continue;
    (inserts.get(after) ?? inserts.set(after, []).get(after)!).push({ code: null, name: v.name, lat: v.lat, lon: v.lon, approx: true, locationPrecision: 'exact', via: true });
  }
  if (!inserts.size) return none;
  const stops: Stop[] = [];
  const srcIdx: (number | null)[] = [];
  const viaTimes: (string | null)[] = [];
  dir.stops.forEach((s, i) => {
    stops.push(s);
    srcIdx.push(i);
    viaTimes.push(null);
    const list = inserts.get(i);
    if (!list) return;
    // time: between the nearest stops before and after that have one, in proportion to the distance along those stops
    let a = i;
    while (a >= 0 && !times[a]) a--;
    let b = i + 1;
    while (b < dir.stops.length && !times[b]) b++;
    list.sort((x, y) => km(s, { lat: x.lat!, lon: x.lon! }) - km(s, { lat: y.lat!, lon: y.lon! }));
    for (const p of list) {
      let t: string | null = null;
      if (a >= 0 && b < dir.stops.length && placed(dir.stops[a]) && placed(dir.stops[b])) {
        const pt = { lat: p.lat!, lon: p.lon! };
        const d1 = km(dir.stops[a], pt);
        const d2 = km(dir.stops[b], pt);
        const t1 = toMinutes(times[a]!);
        let t2 = toMinutes(times[b]!);
        if (t2 < t1) t2 += 1440;
        t = fmtMinutes(Math.round(t1 + ((t2 - t1) * d1) / ((d1 + d2) || 1)) % 1440);
      }
      stops.push(p);
      srcIdx.push(null);
      viaTimes.push(t);
    }
  });
  return { stops, srcIdx, viaTimes };
}
