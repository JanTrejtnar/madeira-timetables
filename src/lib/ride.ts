// Google Maps style route drawing: of the polyline of a line only the stretch the traveller rides is drawn in full colour,
// the rest (before boarding, after getting off) is faint or hidden.
import { sameCall, tripStops, type Trip } from './network';
import type { Stop } from '../types';
import { matchStopsToShape } from './shapeMatch';

type Pt = [number, number];

export interface RideSplit {
  before: Pt[];
  ride: Pt[];
  after: Pt[];
}

/**
 * Splits `shape` at the points nearest to stop `from` and stop `to` of the trip (`stops` = [lat, lon] of every stop, null where unknown).
 * The stops are matched to the polyline in driving order (`matchStopsToShape`), so a line that passes the same place twice is cut at the
 * right pass, and a stop that is not on the polyline (it was trimmed away) does not move the others.
 * null when either stop has no position or the stretch is empty (the caller then draws the whole line).
 */
export function rideSplit(shape: readonly Pt[], stops: readonly (Pt | null)[], from: number, to: number): RideSplit | null {
  const idx = matchStopsToShape(shape, stops);
  const a = idx[from];
  const b = idx[to];
  if (a == null || b == null || b <= a) return null;
  return { before: shape.slice(0, a + 1) as Pt[], ride: shape.slice(a, b + 1) as Pt[], after: shape.slice(b) as Pt[] };
}

/**
 * The stops between boarding (`from`) and alighting (`to`) that the trip really calls at: a dash in the timetable (no time) means the
 * trip does not stop there. The same stop (name and pole) twice in a row is one stop where the bus waits (arrival and departure row of the timetable).
 */
export function midStops(trip: Trip, from: number, to: number): { stop: Stop; arrive: number; depart?: number }[] {
  const stops = tripStops(trip);
  const out: { stop: Stop; arrive: number; depart?: number }[] = [];
  for (let p = from + 1; p < to; p++) {
    const tm = trip.times[p];
    if (tm === null || tm === undefined) continue;
    const prev = out[out.length - 1];
    if (prev && prev.depart === undefined && sameCall(prev.stop, stops[p])) prev.depart = tm;
    else out.push({ stop: stops[p], arrive: tm });
  }
  return out;
}
