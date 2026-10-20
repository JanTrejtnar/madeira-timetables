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
  /** index of the place within the note ("Via Ilha e St. António" has two) */
  k: number;
  place: ViaPlace;
}

/** The "via" places a trip with `notes` calls at in direction `dirIndex`, per stop index they follow (the places of one note in printed order, notes nearest to that stop first). */
export function viaAt(line: Line, dirIndex: number, dir: Direction, notes: readonly string[] | undefined): Map<number, ViaCall[]> {
  const out = new Map<number, ViaCall[]>();
  if (!line.via || !notes?.length) return out;
  for (const code of notes) {
    (line.via[code] ?? []).forEach((place, k) => {
      const after = place.after[dirIndex];
      if (after === undefined || !dir.stops[after]) return;
      (out.get(after) ?? out.set(after, []).get(after)!).push({ code, k, place });
    });
  }
  for (const [after, list] of out) {
    const s = dir.stops[after];
    if (!placed(s)) continue;
    // physical order along the route polyline when every place has one (the printed order of a note may run against the direction of travel)
    if (list.every((c) => c.place.at?.[dirIndex] !== undefined)) {
      list.sort((x, y) => x.place.at![dirIndex] - y.place.at![dirIndex]);
      continue;
    }
    // otherwise different notes: nearest first; the places of one note keep the order the timetable prints
    const first = new Map<string, number>();
    for (const c of list) first.set(c.code, Math.min(first.get(c.code) ?? Infinity, km(s, c.place)));
    list.sort((x, y) => (x.code === y.code ? x.k - y.k : first.get(x.code)! - first.get(y.code)!));
  }
  return out;
}

/**
 * Passing time (minutes) of a via place that follows stop `after`: between the nearest stops before and after that have a time,
 * in proportion to the distance. null when the trip has no time on one side (it does not run through that stretch).
 */
export function viaMinutes(dir: Direction, after: number, place: { lat: number; lon: number }, times: readonly (number | null)[]): number | null {
  return viaMinutesChain(dir, after, [place], times)[0];
}

/** Passing times of several places that follow the same stop, in the order given: proportional to the way travelled through them. */
export function viaMinutesChain(dir: Direction, after: number, places: readonly { lat: number; lon: number }[], times: readonly (number | null)[]): (number | null)[] {
  let a = after;
  while (a >= 0 && times[a] == null) a--;
  let b = after + 1;
  while (b < dir.stops.length && times[b] == null) b++;
  const sa = dir.stops[a];
  const sb = dir.stops[b];
  if (a < 0 || b >= dir.stops.length || !placed(sa) || !placed(sb)) return places.map(() => null);
  const way = [sa, ...places, sb];
  const cum = [0];
  for (let i = 1; i < way.length; i++) cum.push(cum[i - 1] + km(way[i - 1], way[i]));
  const t1 = times[a]!;
  let t2 = times[b]!;
  if (t2 < t1) t2 += 1440;
  return places.map((_, i) => Math.round(t1 + ((t2 - t1) * cum[i + 1]) / (cum[way.length - 1] || 1)));
}

/**
 * "*Serviço a pedido: Ilha, A. Marques e Silveira": the trip calls at these places only after a phone booking, so they are not
 * inserted as stops. Returns the place names; null for other notes (also the booking instructions, which name no place).
 */
export function onRequestPlaces(note: string): string[] | null {
  const m = /^\*?\s*servi[çc]o a pedido:\s*(.+)$/i.exec(note.normalize('NFC').trim());
  if (!m || /[0-9@]/.test(m[1]) || m[1].length > 120) return null;
  const names = m[1].replace(/\.$/, '').split(/,|\s+e\s+/i).map((x) => x.trim()).filter(Boolean);
  return names.length ? names : null;
}

/** The stop objects of an inserted via place. */
export const viaStop = (p: ViaPlace): Stop => ({
  code: null,
  name: p.name,
  lat: p.lat,
  lon: p.lon,
  approx: true,
  locationPrecision: 'exact',
  via: true,
  ...(p.muni ? { muni: p.muni } : {}),
  ...(p.par ? { par: p.par } : {}),
});

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
    const calls = inserts.get(i) ?? [];
    const ms = viaMinutesChain(dir, i, calls.map((c) => c.place), mins);
    calls.forEach(({ place }, j) => {
      stops.push(viaStop(place));
      srcIdx.push(null);
      viaTimes.push(ms[j] === null ? null : fmtMinutes(ms[j]! % 1440));
    });
  });
  return { stops, srcIdx, viaTimes };
}
