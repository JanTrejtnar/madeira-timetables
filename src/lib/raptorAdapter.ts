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
  /**
   * For a trip that is in the index: itself first, then the trips of other lines that run the very same bus (same calls, same times:
   * lines 6 and 139 share runs). The index holds one of them; which line the traveller is shown is decided when the itinerary is made.
   */
  aliases: number[][];
}

const NOTHING: RaptorTrip = { nodes: [], arr: [], dep: [], estimated: false };

const cache = new WeakMap<readonly Trip[], { net: Network; prepared: Prepared }>();

/** The index of a day's trips, built once per trips array (a new day / school switch / operator filter builds a new array). */
export function prepare(net: Network, trips: readonly Trip[]): Prepared {
  const hit = cache.get(trips);
  if (hit && hit.net === net) return hit.prepared;
  const compact = trips.map(compactTrip);
  const aliases: number[][] = trips.map(() => []);
  const first = new Map<string, number>();
  const indexTrips = compact.map((ct, i) => {
    const key = [ct.estimated ? 1 : 0, trips[i].nodes.join(), trips[i].times.join(), ct.arrRow.join(), ct.depRow.join()].join('|');
    const rep = first.get(key);
    if (rep === undefined) {
      first.set(key, i);
      aliases[i] = [i];
      return ct;
    }
    aliases[rep].push(i);
    return NOTHING;
  });
  // the group of a trip is its line: never back onto the same line right at the stop one got off. A bus that several lines run is of no
  // group (default), the line is chosen afterwards (toItinerary), so that it is not the line of the bus before or after.
  aliases.forEach((list, i) => {
    if (list.length && list.every((a) => trips[a].line.id === trips[i].line.id)) compact[i].group = trips[i].line.id;
  });
  const footpaths: [number, number, number][] = [];
  for (const [from, list] of net.near) for (const { node, walk } of list) if (node !== from) footpaths.push([from, node, walk]);
  const prepared = { index: buildRaptorIndex({ stopCount: net.nodes.length, trips: indexTrips, footpaths }), compact, aliases };
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
  /** at most this many departures are searched, the earliest (default: all of the window) */
  maxRuns?: number;
  /** search every departure from scratch (slow reference for tests) */
  independentRuns?: boolean;
  /** no "gets closer to the destination" test (the last resort when nothing is found, see `routeGuard`) */
  relaxed?: boolean;
  /** one run: the journeys for a traveller who leaves at departAt and takes the first buses that go (any time of the services' 48 hours) */
  earliestOnly?: boolean;
}

/**
 * Every journey worth offering (no other one leaves later, arrives earlier and changes less) as Itineraries, up to two transfers.
 * `walkIn` / `walkOut` as in `plan()`; the router's rules for what is not a sensible ride are applied as in `plan()`.
 */
export function raptorJourneys(net: Network, trips: readonly Trip[], from: Set<number>, to: Set<number>, departAt: number, walkIn?: WalkIn, walkOut?: WalkOut, opts: JourneyOptions = {}): Itinerary[] {
  if (!from.size || !to.size) return [];
  const { index, compact, aliases } = prepare(net, trips);
  const guard = routeGuard(net, from, to, opts.relaxed);
  const { closer } = guard;
  const hooks: RaptorHooks = {
    // the first bus must not head back into the starting area
    // (a transfer never goes back onto the same line: that is the group of a trip in the search itself)
    board: (trip, _stop, round) => round !== 1 || !guard.intoOrigin(trips[trip]),
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
    maxRuns: opts.maxRuns,
    earliestOnly: opts.earliestOnly,
  });
  return journeys.flatMap((j) => toItinerary(j, trips, compact, aliases) ?? []);
}

/** The itinerary of a journey, each leg on one of the lines that run its bus, never the same line twice in a row (null if that cannot be). */
function toItinerary(j: RaptorJourney, trips: readonly Trip[], compact: CompactTrip[], aliases: number[][]): Itinerary | null {
  const pick = (k: number, prevLine: number): number[] | null => {
    for (const a of aliases[j.legs[k].trip]) {
      if (trips[a].line.id === prevLine) continue;
      const rest = k + 1 < j.legs.length ? pick(k + 1, trips[a].line.id) : [];
      if (rest) return [a, ...rest];
    }
    return null;
  };
  const chosen = pick(0, -1);
  if (!chosen) return null;
  const legs = j.legs.map((l, k) => ({ ...leg(trips[chosen[k]], compact[chosen[k]].depRow[l.from], compact[chosen[k]].arrRow[l.to]), walkBefore: l.walkBefore }));
  return { legs, depart: j.depart, arrive: j.arrive, finish: j.finish, walk: legs.slice(1).reduce((s, l) => s + l.walkBefore, 0) };
}

/**
 * Departures this many minutes after the wanted time are searched: the next 3 hours first, then 24 hours while fewer than
 * DIRECT_SHOWN direct connections turn up (as `plan()` showed the next eight whenever they were). After the first connection when none leaves sooner.
 */
const WINDOWS = [180, 1440];
const SHOWN_WINDOW = WINDOWS[0];
const DIRECT_SHOWN = 8;
/** departures searched per call of the planner: the next ones; later ones come with "later connections" */
const MAX_RUNS = 100;

/** The same result shape as `plan()` (direct connections, then connections with transfers), found by RAPTOR. */
export function planRaptor(net: Network, trips: readonly Trip[], from: Set<number>, to: Set<number>, departAt: number, walkIn?: WalkIn, walkOut?: WalkOut): Plan {
  if (!from.size || !to.size) return { direct: [], transfers: [] };
  const search = (maxWait: number, relaxed = false) => {
    const run = (o: JourneyOptions) => raptorJourneys(net, trips, from, to, departAt, walkIn, walkOut, { maxWait, relaxed, ...o });
    let all: Itinerary[] = [];
    for (const window of WINDOWS) {
      all = run({ window, maxRuns: MAX_RUNS });
      if (all.filter((it) => it.legs.length === 1).length >= DIRECT_SHOWN) break;
    }
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
  // still nothing: a ride away from the destination to a hub (Santana -> Funchal -> Porto Moniz) beats no connection, as in `plan()`
  if (!direct.length && !transfers.length && routeGuard(net, from, to).closer) {
    transfers = search(MAX_WAIT, true).transfers;
    if (!transfers.length) transfers = search(MAX_WAIT_FALLBACK, true).transfers;
  }
  return { direct: direct.slice(0, DIRECT_SHOWN), transfers: transfers.slice(0, 6) };
}
