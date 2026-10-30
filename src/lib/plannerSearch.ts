// The planner's search for one departure time, as a pure function of the network, the day's trips and the two picked places
// (the component only holds the form and shows the result).
import { metres } from '../../shared/geo.mjs';
import { CITY_PREFIX, PARISH_PREFIX, hubsNear, nearbyStopNodes, nodeIdsOfKeys, nodesNearPoint, parishCentre, resolveNodes, type Network, type Node, type Trip } from './network';
import { isPoiKey } from './places';
import type { Picked } from './plannerForm';
import { planRaptor } from './raptorAdapter';
import { leg, type Itinerary, type Plan } from './router';
import { walkTo } from './walk';

/** a picked stop also stands for the stops this many minutes away on foot */
const NEAR_STOP_MIN = 3;

/** straight-line reach (about 12 minutes on foot over winding roads) within which a transfer hub counts as a start of the journey */
const HUB_WALK_M = 650;

type Pt = { lat: number; lon: number };
/** the picked stop and the point to walk from / to when the bus boards / alights at another stop near it */
interface PickedStopEnd {
  pt: Pt;
  base: Set<number>;
}

export interface SearchResult {
  /** number of stops (nodes) found for the start and for the destination */
  A: number;
  B: number;
  /** a picked place with no stop within reach (its name) */
  missing: string | null;
  /** a picked place that needed the wider radius (its name) */
  far: string | null;
  ext: { from?: PickedStopEnd; to?: PickedStopEnd };
  plan: Plan;
}

/** A picked place (beach, hotel, viewpoint ...) stands for the stops within walking distance of it; a stop or an area for its own nodes. */
function nodesOf(net: Network, p: Picked) {
  if (isPoiKey(p.key) && p.pt) {
    const r = nodesNearPoint(net, p.pt.lat, p.pt.lon);
    return { ids: nodeIdsOfKeys(net, r.nodes.map((x) => x.node.key)), widened: r.widened, place: true, base: undefined, extra: undefined, at: undefined };
  }
  const ids = resolveNodes(net, p.text, p.key);
  // a picked stop: the stops a few minutes' walk away count too (the other side of the road is often named differently and has the
  // buses of the other direction); `base` = the picked stop itself, `extra` = those stops with the minutes to walk to them
  const base = new Set(ids);
  const extra = new Map<number, number>();
  const isStop = !!p.key && !p.pt && !p.key.startsWith(PARISH_PREFIX) && !p.key.startsWith(CITY_PREFIX) && !isPoiKey(p.key);
  const at = isStop ? [...base].map((id) => net.nodes[id]).find((n) => n.lat !== undefined && n.lon !== undefined) : undefined;
  if (at) {
    for (const [id, min] of nearbyStopNodes(net, base, NEAR_STOP_MIN)) extra.set(id, min);
    for (const id of extra.keys()) ids.add(id);
  }
  return { ids, widened: false, place: false, base, extra, at: at ? { lat: at.lat as number, lon: at.lon as number } : undefined };
}

/** a stop where a line starts counts as a centre stop of the town when a terminal or hub is this near (the Areeiro bus leaves from its own stop at the cable car) */
export const CITY_CENTRE_M = 1500;

/** The stops of a whole town that stand for "the town" as a start: terminals, transfer hubs and the starts of lines near them; null when there are none to prefer. */
function cityCentre(net: Network, trips: Trip[], all: Set<number>): Set<number> | null {
  const starts = new Set(trips.map((tr) => tr.nodes[0]));
  const hubs = [...all].map((id) => net.nodes[id]).filter((n) => (n.terminal || n.transferHub) && n.lat !== undefined && n.lon !== undefined);
  const centre = new Set(hubs.map((n) => n.id));
  for (const id of all) {
    const n = net.nodes[id];
    if (!starts.has(id) || n.lat === undefined || n.lon === undefined) continue;
    if (hubs.some((h) => metres(h as Required<Node>, n as Required<Node>) <= CITY_CENTRE_M)) centre.add(id);
  }
  return centre.size && centre.size < all.size ? centre : null;
}

/**
 * A bus that boards at the preferred start (a terminal, the start of the line) is offered from there, not from a stop further along the same trip
 * that the search found because it leaves later with the same arrival: the traveller waits at the terminal where the bus starts. Only when the bus
 * has not left yet (`at`); itineraries that become the same ride are listed once.
 */
function boardAtStart(plan: Plan, pref: Set<number>, at: number): Plan {
  const earlier = (it: Itinerary): Itinerary => {
    const first = it.legs[0];
    const t = first.trip;
    for (let i = 0; i < first.fromPos; i++) {
      const time = t.times[i];
      if (time === null || time < at || !pref.has(t.nodes[i])) continue;
      const moved = { ...leg(t, i, first.toPos), walkBefore: first.walkBefore };
      return { ...it, depart: moved.depart, legs: [moved, ...it.legs.slice(1)] };
    }
    return it;
  };
  const once = (list: Itinerary[]) => {
    const seen = new Set<string>();
    return list.filter((it) => {
      const key = it.legs.map((l) => `${l.trip.line.id}/${l.trip.dirIndex}/${l.trip.times[0]}/${l.fromPos}/${l.toPos}`).join('>');
      return !seen.has(key) && !!seen.add(key);
    });
  };
  const direct = once(plan.direct.map(earlier)).sort((a, b) => a.depart - b.depart || a.finish - b.finish);
  return { direct, transfers: once(plan.transfers.map(earlier)) };
}

/**
 * The connections from `from` to `to` leaving at `at` (minutes from midnight of the chosen day, may pass 24:00), among `trips`
 * (the day's trips after the type / operator filter). null while a field is empty.
 */
export function runSearch(net: Network, trips: Trip[], from: Picked, to: Picked, at: number, directOnly: boolean): SearchResult | null {
  const na = nodesOf(net, from);
  const nb = nodesOf(net, to);
  const A = na.ids;
  const B = nb.ids;
  if (!from.text.trim() || !to.text.trim()) return null;
  // walking from a picked start point: a bus counts only when it leaves after departAt + the walk to its stop
  let walkIn: Map<number, number> | undefined;
  if (na.extra?.size) walkIn = new Map(na.extra);
  if (from.pt) {
    // a terminal within walking reach is a boarding point too: leaving from there beats a one-stop city hop to it
    for (const hub of hubsNear(net, from.pt.lat, from.pt.lon, HUB_WALK_M)) A.add(hub.id);
    walkIn = new Map();
    for (const id of A) {
      const w = walkTo(from.pt, net.nodes[id]);
      if (w) walkIn.set(id, w.min);
    }
  }
  // walking to a picked destination point: the stop where one arrives first counts, bus arrival + walk
  let walkOut: Map<number, number> | undefined;
  if (nb.extra?.size) walkOut = new Map(nb.extra);
  if (to.pt) {
    walkOut = new Map();
    for (const id of B) {
      const w = walkTo(to.pt, net.nodes[id]);
      if (w) walkOut.set(id, w.min);
    }
  }
  // "Funchal" as a whole town as the start: its centre (terminals, hubs, and the stops where a line starts near them), not the first stop on the
  // edge of the town; a whole parish ("Camacha (all stops)") as the start or the destination: its centre, not the first roadside pole of the border.
  // The other stops are used only when nothing connects the preferred ones. One search in the usual case (each run is expensive on a phone).
  const cityStart = !from.pt && !!from.key?.startsWith(CITY_PREFIX);
  const centreOf = (p: Picked, ids: Set<number>) => {
    if (p.pt || !p.key?.startsWith(PARISH_PREFIX)) return null;
    const c = new Set([...parishCentre(net, p.key)].filter((id) => ids.has(id)));
    return c.size && c.size < ids.size ? c : null;
  };
  const prefA = cityStart ? cityCentre(net, trips, A) : centreOf(from, A);
  const prefB = centreOf(to, B);
  const tries: [Set<number>, Set<number>][] = [[prefA ?? A, prefB ?? B]];
  if (prefA && prefB) tries.push([A, prefB]);
  if (prefA || prefB) tries.push([A, B]);
  let found = planRaptor(net, trips, tries[0][0], tries[0][1], at, walkIn, walkOut);
  let started = tries[0][0];
  for (const [x, y] of tries.slice(1)) {
    if (found.direct.length || found.transfers.length) break;
    found = planRaptor(net, trips, x, y, at, walkIn, walkOut);
    started = x;
  }
  if (prefA && started === prefA) found = boardAtStart(found, prefA, at);
  // "Funchal" as a whole town: a connection that rides within the town to board the next bus at a stop of the town is just that bus
  // (offered as it is, from its own start); the traveller chose any stop of the town as the start
  if (cityStart) {
    found = { ...found, transfers: found.transfers.filter((it) => !A.has(it.legs[1].trip.nodes[it.legs[1].fromPos])) };
  }
  const missing = na.place && A.size === 0 ? from.text : nb.place && B.size === 0 ? to.text : null;
  const far = na.widened ? from.text : nb.widened ? to.text : null;
  return {
    A: A.size,
    B: B.size,
    missing,
    far,
    ext: { from: na.at && na.base ? { pt: na.at, base: na.base } : undefined, to: nb.at && nb.base ? { pt: nb.at, base: nb.base } : undefined },
    plan: directOnly ? { ...found, transfers: [] } : found,
  };
}
