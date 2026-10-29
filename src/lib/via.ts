// "Via X" notes (e.g. 208 "a" = "Via Aeroporto"): for a trip carrying such a note, the place is a real call between two stops of
// the list. build:data resolves the place (`line.via`); here it is inserted into the stop list of the selected trip (and into the
// planner's trips) with a time interpolated between the neighbouring stops. "Via Rápida" (motorway) has no entry and stays a note.
import type { Direction, Line, Stop, ViaPlace, ViaRoute, ViaRoutes } from '../types';
import { fmtMinutes, toMinutes } from './time';
import { haversineKm, localSq } from '../../shared/geo.mjs';

export interface ShownStops {
  stops: Stop[];
  /** index into `dir.stops`, null for an inserted "via" place */
  srcIdx: (number | null)[];
  /** estimated passing time of the inserted places ("HH:MM"), null elsewhere / when the neighbours have no time */
  viaTimes: (string | null)[];
}

const km = haversineKm;
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

/** Minutes per km of straight line on the winding roads of Madeira (about 25 km/h on the road, a detour factor of 1.3 included). */
const MIN_PER_KM = 3.1;
/** A place further than this from the timed stop it hangs on is not a short branch: no time is guessed. */
const MAX_BRANCH_KM = 8;

/** Times of `places` reached from the timed stop `anchor` (`dir` 1: after it, -1: before it, in the order given), by the way travelled. */
function extrapolate(anchor: { lat: number; lon: number }, places: readonly { lat: number; lon: number }[], dir: 1 | -1, t0: number): (number | null)[] {
  // forward the places are visited in the order given; backward the last one is nearest to the anchor
  const way = dir === 1 ? [anchor, ...places] : [anchor, ...[...places].reverse()];
  const at: number[] = [t0];
  let total = 0;
  for (let i = 1; i < way.length; i++) {
    total += km(way[i - 1], way[i]);
    at.push(Math.round(t0 + dir * total * MIN_PER_KM));
  }
  if (total > MAX_BRANCH_KM) return places.map(() => null);
  const out = at.slice(1);
  return dir === 1 ? out : out.reverse();
}

/** Passing times of several places that follow the same stop, in the order given: proportional to the way travelled through them. */
export function viaMinutesChain(dir: Direction, after: number, places: readonly { lat: number; lon: number }[], times: readonly (number | null)[]): (number | null)[] {
  let a = after;
  while (a >= 0 && times[a] == null) a--;
  let b = after + 1;
  while (b < dir.stops.length && times[b] == null) b++;
  const sa = dir.stops[a];
  const sb = dir.stops[b];
  // the branch at the end (or the start) of a trip: no time on one side, but the timed stop right next to the place is the end of the
  // trip's printed part, so the place is reached after (or before) it at the pace of a road
  if (a >= 0 && b >= dir.stops.length && a === after && placed(sa)) return extrapolate(sa, places, 1, times[a]!);
  if (a < 0 && b < dir.stops.length && b === after + 1 && placed(sb)) return extrapolate(sb, places, -1, times[b]!);
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

/** Road routes (of `line.hasViaRoutes` lines, from `useViaRoutes`) through the via places a trip with `notes` calls at in direction `dirIndex` (drawn instead of the straight stretch of the shape). */
export function detoursFor(routes: ViaRoutes | undefined, dirIndex: number, notes: readonly string[] | undefined): ViaRoute[] {
  if (!routes || !notes?.length) return [];
  const out: ViaRoute[] = [];
  for (const code of notes) for (const [key, r] of Object.entries(routes)) if (key.startsWith(`${code}|${dirIndex}|`)) out.push(r);
  return out;
}

const sq = localSq;
/** The shape with each detour replacing the stretch between its two anchor points (detours that do not fit the shape are ignored). */
export function spliceDetours(shape: [number, number][], detours: readonly ViaRoute[] | undefined): [number, number][] {
  if (!detours?.length) return shape;
  const nearest = (p: readonly [number, number], from: number) => {
    let best = from;
    let bd = Infinity;
    for (let i = from; i < shape.length; i++) {
      const d = sq(shape[i], p);
      if (d < bd) { bd = d; best = i; }
    }
    return { i: best, d: bd };
  };
  const found = detours
    .map((r) => {
      const a = nearest(r.a, 0);
      const b = nearest(r.b, a.i);
      return a.d < 1e-6 && b.d < 1e-6 && b.i > a.i ? { r, from: a.i, to: b.i } : null;
    })
    .filter((x): x is { r: ViaRoute; from: number; to: number } => x !== null)
    .sort((x, y) => x.from - y.from);
  const out: [number, number][] = [];
  let at = 0;
  for (const f of found) {
    if (f.from < at - 1) continue; // overlaps the previous detour (neighbouring ones share their anchor point)
    out.push(...shape.slice(at, Math.max(at, f.from)));
    const prev = out.at(-1);
    out.push(...(prev && prev[0] === f.r.pts[0][0] && prev[1] === f.r.pts[0][1] ? f.r.pts.slice(1) : f.r.pts));
    at = f.to + 1;
  }
  out.push(...shape.slice(at));
  return out;
}
