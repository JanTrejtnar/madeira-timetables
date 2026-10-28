// The bridge between the planner's types (Network, Trip, Itinerary) and the pure RAPTOR search in raptor.ts: turns the day's trips into
// the flat index, carries the router's rules over as hooks (anti-reversal, short hops, no U-turn onto the same line ...) and turns the
// journeys back into Itineraries for the UI. Not wired into the planner yet.
import { dwellsAt, type Network, type Trip } from './network';
import {
  HUB_DETOUR_M, MAX_WAIT, MAX_WAIT_FALLBACK, MIN_TRANSFER, MIN_TRANSFER_ESTIMATED, TRANSFER_PENALTY,
  lastHop, leg, routeGuard, shortHop, type Itinerary, type Plan, type WalkIn, type WalkOut,
} from './router';
import { buildRaptorIndex, raptor, type RaptorHooks, type RaptorIndex, type RaptorJourney, type RaptorTrip } from './raptor';

/** A trip reduced to what the search needs: a wait at a stop (arrival row + departure row) is one call, calls without a time are gone. */
export interface CompactTrip extends RaptorTrip {
  /** row of the trip (`trip.nodes` / `trip.times`) of the arrival and of the departure at each call */
  arrRow: number[];
  depRow: number[];
}

export function compactTrip(trip: Trip): CompactTrip {
  const out: CompactTrip = { nodes: [], arr: [], dep: [], arrRow: [], depRow: [], estimated: trip.estimated };
  const nodes = out.nodes as number[];
  const arr = out.arr as number[];
  const dep = out.dep as number[];
  for (let i = 0; i < trip.nodes.length; ) {
    let end = i;
    while (dwellsAt(trip, end)) end++;
    // one stop, several rows: one gets off with the first printed time, the bus leaves with the last
    let a = -1;
    let d = -1;
    for (let r = i; r <= end; r++) {
      if (trip.times[r] === null) continue;
      if (a < 0) a = r;
      d = r;
    }
    if (a >= 0) {
      nodes.push(trip.nodes[i]);
      arr.push(trip.times[a] as number);
      dep.push(trip.times[d] as number);
      out.arrRow.push(a);
      out.depRow.push(d);
    }
    i = end + 1;
  }
  return out;
}

export interface Prepared {
  index: RaptorIndex;
  compact: CompactTrip[];
}

const cache = new WeakMap<readonly Trip[], { net: Network; prepared: Prepared }>();

/** The index of a day's trips, built once per trips array (a new day / school switch / operator filter builds a new array). */
export function prepare(net: Network, trips: readonly Trip[]): Prepared {
  const hit = cache.get(trips);
  if (hit && hit.net === net) return hit.prepared;
  const compact = trips.map(compactTrip);
  const footpaths: [number, number, number][] = [];
  for (const [from, list] of net.near) for (const { node, walk } of list) if (node !== from) footpaths.push([from, node, walk]);
  const prepared = { index: buildRaptorIndex({ stopCount: net.nodes.length, trips: compact, footpaths }), compact };
  cache.set(trips, { net, prepared });
  return prepared;
}

export interface JourneyOptions {
  /** minutes after departAt in which a journey may start (default 180) */
  window?: number;
  /** longest wait at a transfer (default MAX_WAIT) */
  maxWait?: number;
  /** default 2 */
  maxTransfers?: number;
  /** search every departure from scratch (slow reference for tests) */
  independentRuns?: boolean;
  /** one run: the journeys for a traveller who leaves at departAt and takes the first buses that go (any time of the services' 48 hours) */
  earliestOnly?: boolean;
}

/**
 * Every journey worth offering (no other one leaves later, arrives earlier and changes less) as Itineraries, up to two transfers.
 * `walkIn` / `walkOut` as in `plan()`; the router's rules for what is not a sensible ride are applied as in `plan()`.
 */
export function raptorJourneys(net: Network, trips: readonly Trip[], from: Set<number>, to: Set<number>, departAt: number, walkIn?: WalkIn, walkOut?: WalkOut, opts: JourneyOptions = {}): Itinerary[] {
  if (!from.size || !to.size) return [];
  const { index, compact } = prepare(net, trips);
  const guard = routeGuard(net, from, to);
  const { closer } = guard;
  const hooks: RaptorHooks = {
    // the first bus must not head back into the starting area; a transfer never goes back onto the same line (a U-turn)
    board: (trip, _stop, round, prev) => (round === 1 ? !guard.intoOrigin(trips[trip]) : trips[prev].line.id !== trips[trip].line.id),
    leg: (trip, f, t, round, final) => {
      const ct = compact[trip];
      const a = ct.nodes[f];
      const b = ct.nodes[t];
      const stops = ct.arrRow[t] - ct.depRow[f];
      const minutes = ct.arr[t] - ct.dep[f];
      if (final) return !(round > 1 && lastHop(net, a, b, stops, minutes)) && (!closer || closer(a, b));
      if (round === 1 && shortHop(net, a, b, stops, minutes)) return false;
      return !closer || closer(a, b, HUB_DETOUR_M);
    },
  };
  const journeys = raptor(index, {
    from: new Map([...from].map((id) => [id, walkIn?.get(id) ?? 0])),
    to: new Map([...to].map((id) => [id, walkOut?.get(id) ?? 0])),
    departAt,
    maxTransfers: opts.maxTransfers ?? 2,
    window: opts.window,
    maxWait: opts.maxWait ?? MAX_WAIT,
    buffer: { printed: MIN_TRANSFER, estimated: MIN_TRANSFER_ESTIMATED },
    hooks,
    independentRuns: opts.independentRuns,
    earliestOnly: opts.earliestOnly,
  });
  return journeys.map((j) => toItinerary(j, trips, compact));
}

function toItinerary(j: RaptorJourney, trips: readonly Trip[], compact: CompactTrip[]): Itinerary {
  const legs = j.legs.map((l) => ({ ...leg(trips[l.trip], compact[l.trip].depRow[l.from], compact[l.trip].arrRow[l.to]), walkBefore: l.walkBefore }));
  return { legs, depart: j.depart, arrive: j.arrive, finish: j.finish, walk: legs.slice(1).reduce((s, l) => s + l.walkBefore, 0) };
}

/** Departures this many minutes after the wanted time are shown (and after the first connection, when none leaves sooner). */
const SHOWN_WINDOW = 180;

/** The same result shape as `plan()` (direct connections, then connections with transfers), found by RAPTOR. */
export function planRaptor(net: Network, trips: readonly Trip[], from: Set<number>, to: Set<number>, departAt: number, walkIn?: WalkIn, walkOut?: WalkOut): Plan {
  if (!from.size || !to.size) return { direct: [], transfers: [] };
  const search = (maxWait: number) => {
    const run = (o: JourneyOptions) => raptorJourneys(net, trips, from, to, departAt, walkIn, walkOut, { maxWait, ...o });
    let all = run({ window: SHOWN_WINDOW });
    if (!all.length) {
      // nothing in the next hours (the last bus has gone, a sparse line): one cheap run finds when a connection first runs, then what leaves around then is shown
      const first = run({ earliestOnly: true });
      if (first.length) all = run({ window: Math.min(...first.map((j) => j.depart)) - departAt + SHOWN_WINDOW });
    }
    const direct = all.filter((it) => it.legs.length === 1).sort((a, b) => a.depart - b.depart || a.finish - b.finish);
    // one itinerary per last bus: the latest departure that still makes it; a journey with more changes ranks as if it arrived later
    const byTrip = new Map<Trip, Itinerary>();
    for (const it of all) {
      if (it.legs.length === 1) continue;
      const key = it.legs[it.legs.length - 1].trip;
      const prev = byTrip.get(key);
      if (!prev || it.depart > prev.depart) byTrip.set(key, it);
    }
    const rank = (it: Itinerary) => it.finish + (it.legs.length - 2) * TRANSFER_PENALTY;
    return { direct, transfers: [...byTrip.values()].sort((a, b) => rank(a) - rank(b) || b.depart - a.depart) };
  };
  const first = search(MAX_WAIT);
  const bestDirectArrive = first.direct.length ? Math.min(...first.direct.slice(0, 5).map((x) => x.finish)) : Infinity;
  const nearest = first.direct[0];
  // transfers help when there is no direct trip, it leaves much later, or a transfer arrives clearly earlier
  const needTransfers = !nearest || nearest.depart - departAt > 60;
  let { direct, transfers } = first;
  transfers = transfers.filter((x) => needTransfers || x.finish + TRANSFER_PENALTY < bestDirectArrive);
  // nothing else: a long wait beats no connection at all
  if (!direct.length && !transfers.length) transfers = search(MAX_WAIT_FALLBACK).transfers;
  return { direct: direct.slice(0, 8), transfers: transfers.slice(0, 6) };
}
