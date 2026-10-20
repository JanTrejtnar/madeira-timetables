// Journey search: direct connections and connections with one transfer (earliest arrival, IDOS-style).
import type { Network, Trip } from './network';

export const MIN_TRANSFER = 5; // minutes between arrival and the next departure (plus walking time)
/** Longer buffer when at least one of the two buses has estimated (not printed) times: mountain roads are slow. */
export const MIN_TRANSFER_ESTIMATED = 12;
const MAX_WAIT = 120; // do not offer transfers with a longer wait than this
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
function shortHop(net: Network, from: number, to: number, stops: number, minutes: number): boolean {
  if (isMicro(stops, minutes)) return true;
  if (stops > MAX_HOP_STOPS) return false;
  const a = net.nodes[from];
  const b = net.nodes[to];
  if (a.lat === undefined || a.lon === undefined || b.lat === undefined || b.lon === undefined) return false;
  const m = Math.hypot((a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110540);
  return m <= WALK_INSTEAD_M;
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

function firstAfter(trip: Trip, pos: number, to: Set<number>): number {
  for (let j = pos + 1; j < trip.nodes.length; j++) if (trip.times[j] !== null && to.has(trip.nodes[j])) return j;
  return -1;
}

export function direct(trips: Trip[], from: Set<number>, to: Set<number>, departAt: number, walkIn?: WalkIn): Itinerary[] {
  const out: Itinerary[] = [];
  for (const trip of trips) {
    const i = earliestBoard(trip, from, departAt, walkIn);
    if (i < 0) continue;
    const j = firstAfter(trip, i, to);
    if (j < 0) continue;
    const l = leg(trip, i, j);
    if (l.depart > departAt + HORIZON) continue;
    out.push({ legs: [l], depart: l.depart, arrive: l.arrive, walk: 0 });
  }
  return out.sort((a, b) => a.depart - b.depart || a.arrive - b.arrive);
}

export function withTransfer(net: Network, trips: Trip[], from: Set<number>, to: Set<number>, departAt: number, walkIn?: WalkIn): Itinerary[] {
  // second legs: for each node, the trips that call there and later reach `to`
  const second = new Map<number, { trip: Trip; m: number; j: number }[]>();
  for (const trip of trips) {
    for (let m = 0; m < trip.nodes.length - 1; m++) {
      if (trip.times[m] === null) continue;
      const j = firstAfter(trip, m, to);
      if (j < 0) continue;
      const list = second.get(trip.nodes[m]) ?? [];
      list.push({ trip, m, j });
      second.set(trip.nodes[m], list);
    }
  }
  const found: Itinerary[] = [];
  for (const t1 of trips) {
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
      for (const { node, walk } of net.near.get(t1.nodes[k]) ?? []) {
        for (const c of second.get(node) ?? []) {
          if (c.trip === t1 || (c.trip.line.id === t1.line.id && c.trip.dirIndex === t1.dirIndex)) continue;
          const tm = c.trip.times[c.m] as number;
          const buffer = t1.estimated || c.trip.estimated ? MIN_TRANSFER_ESTIMATED : MIN_TRANSFER;
          const ready = arriveK + buffer + walk;
          if (tm < ready || tm - ready > MAX_WAIT) continue;
          const arrive = c.trip.times[c.j] as number;
          const score = arrive + (net.viaOnly.has(node) ? VIA_PENALTY : 0) - (net.nodes[node].transferHub ? HUB_BONUS : 0);
          if (!best || score < bestScore || (score === bestScore && walk < best.walk)) {
            bestScore = score;
            best = { legs: [leg(t1, i, k), leg(c.trip, c.m, c.j)], depart: l1depart, arrive, walk };
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
  return [...byTrip.values()].sort((a, b) => a.arrive - b.arrive || b.depart - a.depart);
}

export interface Plan {
  direct: Itinerary[];
  transfers: Itinerary[];
}

/** `walkIn`: walking time from a picked start point to each boarding node; a bus is offered only when it leaves at departAt + walk or later. */
export function plan(net: Network, trips: Trip[], from: Set<number>, to: Set<number>, departAt: number, walkIn?: WalkIn): Plan {
  if (!from.size || !to.size) return { direct: [], transfers: [] };
  const d = direct(trips, from, to, departAt, walkIn);
  const bestDirectArrive = d.length ? Math.min(...d.slice(0, 5).map((x) => x.arrive)) : Infinity;
  const nearest = d[0];
  // transfers help when there is no direct trip, it leaves much later, or a transfer arrives clearly earlier
  const needTransfers = !nearest || nearest.depart - departAt > 60;
  const t = withTransfer(net, trips, from, to, departAt, walkIn).filter((x) => needTransfers || x.arrive + TRANSFER_PENALTY < bestDirectArrive);
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
