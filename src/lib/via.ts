// "Via X" notes (e.g. 208 "a" = "Via Aeroporto"): for a trip carrying such a note, the place is a real call between two stops of
// the list. build:data resolves the place (`line.via`); here it is inserted into the stop list of the selected trip (and into the
// planner's trips) with a time interpolated between the neighbouring stops. "Via Rápida" (motorway) has no entry and stays a note.
import type { Direction, Line, Stop, ViaPlace } from '../types';
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
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const placed = (s: Stop | undefined): s is Stop & { lat: number; lon: number } => !!s && s.lat !== undefined && s.lon !== undefined;

export interface ViaCall {
  code: string;
  place: ViaPlace;
}

/** The "via" places a trip with `notes` calls at in direction `dirIndex`, per stop index they follow (nearest to that stop first). */
export function viaAt(line: Line, dirIndex: number, dir: Direction, notes: readonly string[] | undefined): Map<number, ViaCall[]> {
  const out = new Map<number, ViaCall[]>();
  if (!line.via || !notes?.length) return out;
  for (const code of notes) {
    const place: ViaPlace | undefined = line.via[code];
    const after = place?.after[dirIndex];
    if (!place || after === undefined || !dir.stops[after]) continue;
    (out.get(after) ?? out.set(after, []).get(after)!).push({ code, place });
  }
  for (const [after, list] of out) {
    const s = dir.stops[after];
    if (placed(s)) list.sort((x, y) => km(s, x.place) - km(s, y.place));
  }
  return out;
}

/**
 * Passing time (minutes) of a via place that follows stop `after`: between the nearest stops before and after that have a time,
 * in proportion to the distance. null when the trip has no time on one side (it does not run through that stretch).
 */
export function viaMinutes(dir: Direction, after: number, place: { lat: number; lon: number }, times: readonly (number | null)[]): number | null {
  let a = after;
  while (a >= 0 && times[a] == null) a--;
  let b = after + 1;
  while (b < dir.stops.length && times[b] == null) b++;
  const sa = dir.stops[a];
  const sb = dir.stops[b];
  if (a < 0 || b >= dir.stops.length || !placed(sa) || !placed(sb)) return null;
  const d1 = km(sa, place);
  const d2 = km(sb, place);
  const t1 = times[a]!;
  let t2 = times[b]!;
  if (t2 < t1) t2 += 1440;
  return Math.round(t1 + ((t2 - t1) * d1) / (d1 + d2 || 1));
}

/** The stop objects of an inserted via place. */
export const viaStop = (p: ViaPlace): Stop => ({ code: null, name: p.name, lat: p.lat, lon: p.lon, approx: true, locationPrecision: 'exact', via: true });

/**
 * The stops of `dir` as shown for a trip with `notes`; `times` = passing time at every stop of `dir` (null = none).
 * Returns `dir.stops` itself (same array) when the trip has no "via" place, so memoised consumers do not rebuild.
 */
export function withVia(line: Line, dirIndex: number, dir: Direction, notes: readonly string[] | undefined, times: readonly (string | null)[]): ShownStops {
  const none: ShownStops = { stops: dir.stops, srcIdx: dir.stops.map((_, i) => i), viaTimes: dir.stops.map(() => null) };
  const inserts = viaAt(line, dirIndex, dir, notes);
  if (!inserts.size) return none;
  const mins = times.map((t) => (t ? toMinutes(t) : null));
  const stops: Stop[] = [];
  const srcIdx: (number | null)[] = [];
  const viaTimes: (string | null)[] = [];
  dir.stops.forEach((s, i) => {
    stops.push(s);
    srcIdx.push(i);
    viaTimes.push(null);
    for (const { place } of inserts.get(i) ?? []) {
      const m = viaMinutes(dir, i, place, mins);
      stops.push(viaStop(place));
      srcIdx.push(null);
      viaTimes.push(m === null ? null : fmtMinutes(m % 1440));
    }
  });
  return { stops, srcIdx, viaTimes };
}
