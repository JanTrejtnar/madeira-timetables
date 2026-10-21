// Journey search: direct connections and connections with one transfer (earliest arrival, IDOS-style).
import type { Network, Node, Trip } from './network';

export const MIN_TRANSFER = 5; // minutes between arrival and the next departure (plus walking time)
/** Longer buffer when at least one of the two buses has estimated (not printed) times: mountain roads are slow. */
export const MIN_TRANSFER_ESTIMATED = 12;
/** Longest wait offered at a transfer; only when nothing else is found does the search allow up to MAX_WAIT_FALLBACK (sparse country lines). */
export const MAX_WAIT = 30;
export const MAX_WAIT_FALLBACK = 120;
/** A transfer must arrive this much earlier than the best direct bus to be offered. */
export const TRANSFER_PENALTY = 10;
/** Score adjustments (minutes) of the transfer point: official terminals win over a "Via" place that is no guaranteed stop. */
const HUB_BONUS = 3;
const VIA_PENALTY = 10;
/** A first leg of one stop and a couple of minutes is a city hop to the terminal: walking there is the same. */
const isMicro = (stops: number, minutes: number) => stops <= 1 && minutes <= 3;
/** A first leg of one or two stops that ends within this distance of where it starts is never offered: the traveller walks. */
const WALK_INSTEAD_M = 1000;
const MAX_HOP_STOPS = 2;
const nodeMetres = (net: Network, from: number, to: number): number => {
  const a = net.nodes[from];
  const b = net.nodes[to];
  if (a.lat === undefined || a.lon === undefined || b.lat === undefined || b.lon === undefined) return Infinity;
  return Math.hypot((a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110540);
};
function shortHop(net: Network, from: number, to: number, stops: number, minutes: number): boolean {
  if (isMicro(stops, minutes)) return true;
  return stops <= MAX_HOP_STOPS && nodeMetres(net, from, to) <= WALK_INSTEAD_M;
}
/** A last leg of one stop (two minutes at most) that ends within this distance of where it starts is never offered: the traveller walks. */
const LAST_HOP_WALK_M = 800;
const lastHop = (net: Network, from: number, to: number, stops: number, minutes: number): boolean => stops <= 1 && minutes <= 2 && nodeMetres(net, from, to) < LAST_HOP_WALK_M;
/** A destination whose stops lie within this radius of their centre is a place we can head for; a wide area (Funchal) has no single direction. */
const REF_SPREAD_M = 6000;
/** The first bus of a transfer may carry the traveller this much further from the destination (to a hub) before the second one heads back. */
export const HUB_DETOUR_M = 2500;
/** `true` when riding from node `from` to node `to` does not take the traveller away from the destination. */
export type Closer = (from: number, to: number, slackM?: number) => boolean;

/**
 * Anti-reversal check: a bus that ends where the traveller starts (Funchal -> Cabo Girão on a "Ponta do Sol -> Funchal" run) leaves the
 * destination behind. Builds the "does this ride get closer" test for a destination (the stops `to`); undefined when the destination is
 * a wide area or has no positions, so nothing is judged.
 */
function progressToward(net: Network, to: ReadonlySet<number>): Closer | undefined {
  const pts = [...to].map((id) => net.nodes[id]).filter((n) => n.lat !== undefined && n.lon !== undefined) as Required<Pick<Node, 'lat' | 'lon'>>[];
  if (!pts.length) return undefined;
  const ref = { lat: pts.reduce((a, n) => a + n.lat, 0) / pts.length, lon: pts.reduce((a, n) => a + n.lon, 0) / pts.length };
  const m = (n: { lat: number; lon: number }) => Math.hypot((n.lon - ref.lon) * 111320 * Math.cos((ref.lat * Math.PI) / 180), (n.lat - ref.lat) * 110540);
  if (Math.max(...pts.map(m)) > REF_SPREAD_M) return undefined;
  return (from, to2, slackM = 0) => {
    const a = net.nodes[from];
    const b = net.nodes[to2];
    if (a.lat === undefined || a.lon === undefined || b.lat === undefined || b.lon === undefined) return true;
    return m({ lat: b.lat, lon: b.lon }) <= m({ lat: a.lat, lon: a.lon }) + slackM;
  };
}

/** The checks that keep a search from offering a bus that runs the wrong way. */
export interface Guard {
  closer?: Closer;
  /** a bus that ends in the starting area (Ponta do Sol -> Funchal for a traveller leaving Funchal) heads home, not away */
  intoOrigin: (trip: Trip) => boolean;
}
export function routeGuard(net: Network, from: ReadonlySet<number>, to: ReadonlySet<number>): Guard {
  const apart = ![...to].some((id) => from.has(id));
  return { closer: progressToward(net, to), intoOrigin: (trip) => apart && from.has(trip.nodes[trip.nodes.length - 1]) };
}

const HORIZON = 48 * 60; // services cover yesterday, the day itself and tomorrow

export interface Leg {
  trip: Trip;
  fromPos: number;
  toPos: number;
  depart: number;
  arrive: number;
  /** time shown with "~": not printed in the timetable */
  departEstimated: boolean;
  arriveEstimated: boolean;
  stops: number; // stops travelled
}

export interface Itinerary {
  legs: Leg[];
  depart: number;
  arrive: number;
  /** arrival at the destination itself: the bus arrival plus the walk from the last stop (equal to `arrive` for a stop or an area) */
  finish: number;
  /** minutes walking between the two stops of a transfer (0 = same stop) */
  walk: number;
}

const leg = (trip: Trip, i: number, j: number): Leg => ({
  trip,
  fromPos: i,
  toPos: j,
  depart: trip.times[i] as number,
  arrive: trip.times[j] as number,
  departEstimated: trip.estimated && i > 0,
  arriveEstimated: trip.estimated && j > 0,
  stops: j - i,
});

/** Minutes of walking from the starting point to a boarding node (a picked map point); nodes not listed are 0 minutes away. */
export type WalkIn = ReadonlyMap<number, number>;

function earliestBoard(trip: Trip, from: Set<number>, notBefore: number, walkIn?: WalkIn): number {
  for (let i = 0; i < trip.nodes.length - 1; i++) {
    const t = trip.times[i];
    if (t !== null && from.has(trip.nodes[i]) && t >= notBefore + (walkIn?.get(trip.nodes[i]) ?? 0)) return i;
  }
  return -1;
}

/** Minutes of walking from an alighting node to the picked destination point; nodes not listed are 0 minutes away. */
export type WalkOut = ReadonlyMap<number, number>;

/** The stop where the traveller reaches the destination first: smallest bus arrival + walk, so a far stop reached 5 minutes sooner does not beat a near one. */
function firstAfter(trip: Trip, pos: number, to: Set<number>, walkOut?: WalkOut): number {
  let best = -1;
  let bestT = Infinity;
  for (let j = pos + 1; j < trip.nodes.length; j++) {
    const t = trip.times[j];
    if (t === null || !to.has(trip.nodes[j])) continue;
    const total = t + (walkOut?.get(trip.nodes[j]) ?? 0);
    if (total < bestT) {
      best = j;
      bestT = total;
    }
    if (!walkOut) break;
  }
  return best;
}

export function direct(trips: Trip[], from: Set<number>, to: Set<number>, departAt: number, walkIn?: WalkIn, walkOut?: WalkOut, guard?: Guard): Itinerary[] {
  const { closer } = guard ?? {};
  const out: Itinerary[] = [];
  for (const trip of trips) {
    if (guard?.intoOrigin(trip)) continue;
    const i = earliestBoard(trip, from, departAt, walkIn);
    if (i < 0) continue;
    const j = firstAfter(trip, i, to, walkOut);
    if (j < 0 || (closer && !closer(trip.nodes[i], trip.nodes[j]))) continue;
    const l = leg(trip, i, j);
    if (l.depart > departAt + HORIZON) continue;
    out.push({ legs: [l], depart: l.depart, arrive: l.arrive, finish: l.arrive + (walkOut?.get(trip.nodes[j]) ?? 0), walk: 0 });
  }
  return out.sort((a, b) => a.depart - b.depart || a.finish - b.finish);
}

export function withTransfer(net: Network, trips: Trip[], from: Set<number>, to: Set<number>, departAt: number, walkIn?: WalkIn, maxWait = MAX_WAIT, walkOut?: WalkOut, guard?: Guard): Itinerary[] {
  const { closer } = guard ?? {};
  // second legs: for each node, the trips that call there and later reach `to`
  const second = new Map<number, { trip: Trip; m: number; j: number }[]>();
  for (const trip of trips) {
    for (let m = 0; m < trip.nodes.length - 1; m++) {
      if (trip.times[m] === null) continue;
      const j = firstAfter(trip, m, to, walkOut);
      if (j < 0 || (closer && !closer(trip.nodes[m], trip.nodes[j]))) continue;
      const list = second.get(trip.nodes[m]) ?? [];
      list.push({ trip, m, j });
      second.set(trip.nodes[m], list);
    }
  }
  const found: Itinerary[] = [];
  for (const t1 of trips) {
    if (guard?.intoOrigin(t1)) continue;
    const i = earliestBoard(t1, from, departAt, walkIn);
    if (i < 0) continue;
    const reachesDirect = firstAfter(t1, i, to) >= 0;
    if (reachesDirect) continue;
    const l1depart = t1.times[i] as number;
    if (l1depart > departAt + HORIZON) continue;
    let best: Itinerary | null = null;
    let bestScore = Infinity;
    for (let k = i + 1; k < t1.nodes.length; k++) {
      const arriveK = t1.times[k];
      if (arriveK === null) continue;
      if (shortHop(net, t1.nodes[i], t1.nodes[k], k - i, arriveK - l1depart)) continue;
      if (closer && !closer(t1.nodes[i], t1.nodes[k], HUB_DETOUR_M)) continue;
      for (const { node, walk } of net.near.get(t1.nodes[k]) ?? []) {
        for (const c of second.get(node) ?? []) {
          // never back onto the same line (either direction): that is a U-turn, the traveller stays on the bus or walks
          if (c.trip === t1 || c.trip.line.id === t1.line.id) continue;
          if (lastHop(net, node, c.trip.nodes[c.j], c.j - c.m, (c.trip.times[c.j] as number) - (c.trip.times[c.m] as number))) continue;
          const tm = c.trip.times[c.m] as number;
          const buffer = t1.estimated || c.trip.estimated ? MIN_TRANSFER_ESTIMATED : MIN_TRANSFER;
          const ready = arriveK + buffer + walk;
          if (tm < ready || tm - ready > maxWait) continue;
          const arrive = c.trip.times[c.j] as number;
          const finish = arrive + (walkOut?.get(c.trip.nodes[c.j]) ?? 0);
          const score = finish + (net.viaOnly.has(node) ? VIA_PENALTY : 0) - (net.nodes[node].transferHub ? HUB_BONUS : 0);
          if (!best || score < bestScore || (score === bestScore && walk < best.walk)) {
            bestScore = score;
            best = { legs: [leg(t1, i, k), leg(c.trip, c.m, c.j)], depart: l1depart, arrive, finish, walk };
          }
        }
      }
    }
    if (best) found.push(best);
  }
  // one itinerary per second-leg trip: keep the latest departure that still makes it
  const byTrip = new Map<Trip, Itinerary>();
  for (const it of found) {
    const key = it.legs[1].trip;
    const prev = byTrip.get(key);
    if (!prev || it.depart > prev.depart) byTrip.set(key, it);
  }
  return [...byTrip.values()].sort((a, b) => a.finish - b.finish || b.depart - a.depart);
}

export interface Plan {
  direct: Itinerary[];
  transfers: Itinerary[];
}

/** `walkIn`: walking time from a picked start point to each boarding node; a bus is offered only when it leaves at departAt + walk or later. `walkOut`: walking time from each alighting node to a picked destination, which decides the stop and the order (by `finish`). */
export function plan(net: Network, trips: Trip[], from: Set<number>, to: Set<number>, departAt: number, walkIn?: WalkIn, walkOut?: WalkOut): Plan {
  if (!from.size || !to.size) return { direct: [], transfers: [] };
  const guard = routeGuard(net, from, to);
  const d = direct(trips, from, to, departAt, walkIn, walkOut, guard);
  const bestDirectArrive = d.length ? Math.min(...d.slice(0, 5).map((x) => x.finish)) : Infinity;
  const nearest = d[0];
  // transfers help when there is no direct trip, it leaves much later, or a transfer arrives clearly earlier
  const needTransfers = !nearest || nearest.depart - departAt > 60;
  const search = (maxWait: number) => withTransfer(net, trips, from, to, departAt, walkIn, maxWait, walkOut, guard).filter((x) => needTransfers || x.finish + TRANSFER_PENALTY < bestDirectArrive);
  let t = search(MAX_WAIT);
  // nothing else: a long wait beats no connection at all
  if (!d.length && !t.length) t = search(MAX_WAIT_FALLBACK);
  return { direct: d.slice(0, 8), transfers: t.slice(0, 6) };
}

const signature = (it: Itinerary) => it.legs.map((l) => `${l.trip.line.id}:${l.trip.dirIndex}:${l.depart}`).join('>');

/**
 * "Prefer" mode: itineraries found within the preferred set of trips come first, then any others from the full
 * search (each group chronological), without duplicates.
 */
export function mergePlans(preferred: Plan, all: Plan, limits = { direct: 8, transfers: 6 }): Plan {
  const merge = (a: Itinerary[], b: Itinerary[], limit: number) => {
    const seen = new Set(a.map(signature));
    const extra = b.filter((it) => !seen.has(signature(it)));
    return [...a, ...extra].slice(0, limit);
  };
  return { direct: merge(preferred.direct, all.direct, limits.direct), transfers: merge(preferred.transfers, all.transfers, limits.transfers) };
}
