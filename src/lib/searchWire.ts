// A search result as it crosses the Web Worker boundary: an itinerary holds `Trip` objects, which reference the page's own lines and directions
// (a clone would be copies the page cannot compare with its own). The worker sends each trip once, as the line id and direction index plus what
// differs per trip (stops, times ...), and the legs point into that table; the page puts its own line and direction objects back.
import type { Line } from '../types';
import type { SearchResult } from './plannerSearch';
import type { Trip } from './network';
import type { Itinerary, Leg, Plan } from './router';

type WireTrip = Omit<Trip, 'line' | 'dir'> & { lineId: number };
type WireLeg = Omit<Leg, 'trip'> & { t: number };
type WireItinerary = Omit<Itinerary, 'legs'> & { legs: WireLeg[] };
export type WireResult = Omit<SearchResult, 'plan'> & { trips: WireTrip[]; plan: { direct: WireItinerary[]; transfers: WireItinerary[] } };

export function toWire(result: SearchResult): WireResult {
  const table: WireTrip[] = [];
  const index = new Map<Trip, number>();
  const at = (trip: Trip) => {
    let i = index.get(trip);
    if (i === undefined) {
      const { line, dir: _dir, ...rest } = trip;
      i = table.push({ ...rest, lineId: line.id }) - 1;
      index.set(trip, i);
    }
    return i;
  };
  const itin = (it: Itinerary): WireItinerary => ({ ...it, legs: it.legs.map(({ trip, ...rest }) => ({ ...rest, t: at(trip) })) });
  const plan = { direct: result.plan.direct.map(itin), transfers: result.plan.transfers.map(itin) };
  return { ...result, trips: table, plan };
}

/** `lines`: the page's own lines by id */
export function fromWire(wire: WireResult, lines: ReadonlyMap<number, Line>): SearchResult {
  const trips: Trip[] = wire.trips.map(({ lineId, ...rest }) => {
    const line = lines.get(lineId) as Line;
    return { ...rest, line, dir: line.directions[rest.dirIndex] };
  });
  const itin = (it: WireItinerary): Itinerary => ({ ...it, legs: it.legs.map(({ t, ...rest }) => ({ ...rest, trip: trips[t] })) });
  const { trips: _t, ...result } = wire;
  const plan: Plan = { direct: wire.plan.direct.map(itin), transfers: wire.plan.transfers.map(itin) };
  return { ...result, plan };
}
