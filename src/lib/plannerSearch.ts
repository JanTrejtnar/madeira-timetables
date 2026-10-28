// The planner's search for one departure time, as a pure function of the network, the day's trips and the two picked places
// (the component only holds the form and shows the result).
import { CITY_PREFIX, PARISH_PREFIX, hubsNear, nearbyStopNodes, nodeIdsOfKeys, nodesNearPoint, resolveNodes, type Network, type Trip } from './network';
import { isPoiKey } from './places';
import type { Picked } from './plannerForm';
import { planRaptor } from './raptorAdapter';
import type { Plan } from './router';
import { walkTo } from './walk';

/** a picked stop also stands for the stops this many minutes away on foot */
export const NEAR_STOP_MIN = 3;

/** straight-line reach (about 12 minutes on foot over winding roads) within which a transfer hub counts as a start of the journey */
export const HUB_WALK_M = 650;

type Pt = { lat: number; lon: number };
/** the picked stop and the point to walk from / to when the bus boards / alights at another stop near it */
export interface PickedStopEnd {
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
  let found = planRaptor(net, trips, A, B, at, walkIn, walkOut);
  // "Funchal" as a whole town: leave from its terminals (Rodoeste, SAM, CAM, the cable car ...); a wayside stop is offered only when nothing leaves from a terminal
  if (!from.pt && from.key?.startsWith(CITY_PREFIX)) {
    // a terminal: marked as one, a transfer hub, or the stop where a line starts (the Areeiro bus leaves from its own stop at the cable car)
    const starts = new Set(trips.map((tr) => tr.nodes[0]));
    const terminals = new Set([...A].filter((id) => net.nodes[id].terminal || net.nodes[id].transferHub || starts.has(id)));
    if (terminals.size && terminals.size < A.size) {
      const fromTerminals = planRaptor(net, trips, terminals, B, at, walkIn, walkOut);
      if (fromTerminals.direct.length || fromTerminals.transfers.length) found = fromTerminals;
    }
  }
  // "Funchal" as a whole town: a connection that rides within the town to board the next bus at a stop of the town is just that bus
  // (offered as it is, from its own start); the traveller chose any stop of the town as the start
  if (!from.pt && from.key?.startsWith(CITY_PREFIX)) {
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
