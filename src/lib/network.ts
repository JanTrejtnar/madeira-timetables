// Stop network and day services for the journey planner.
import { addDays, serviceDay, type Ymd } from './holidays';
import { keysFor, listFor, withMinutes } from './departures';
import { norm, stopKey } from './search';
import { toMinutes } from './time';
import type { Direction, Line, Stop } from '../types';
import { viaAt, viaMinutesChain, viaStop } from './via';
import { expandTerms } from './aliases';
import { M_PER_DEG_LAT, metres } from '../../shared/geo.mjs';
import { walkMinutes } from './walk';
import { withoutPole } from './text';

export interface Node {
  id: number;
  key: string;
  /** Display name (without the trailing "D"/"S" side marker) */
  name: string;
  lat?: number;
  lon?: number;
  /** municipality (concelho) */
  muni?: string;
  /** parish (freguesia) */
  par?: string;
  /** Funchal terminal id of the stops merged into this node */
  terminal?: string;
  /** official transfer terminal: the end of lines of at least HUB_LINES lines (Funchal, Machico ...), never a "Via" place */
  transferHub?: boolean;
  /** only the centre of a settlement / place, not a place where a bus is known to stop (the "orientační poloha v obci" stops) */
  centroid?: boolean;
}

const isCentroid = (s: Stop) => s.locationPrecision === 'settlement_center' || s.locationPrecision === 'place_centroid';

export interface Network {
  nodes: Node[];
  /** `${lineId}:${dirIndex}` -> node id per stop */
  dirNodes: Map<string, number[]>;
  keyToNodes: Map<string, number[]>;
  /**
   * Terminal names printed in timetable headers ("Centro", "Funchal", "Curral das Freiras") -> the first/last stop of
   * the direction they belong to. Lets users search by town/terminal name.
   */
  aliases: Map<string, { name: string; nodes: Set<number> }>;
  /** node of a "Via X" place, key `${lineId}:${note}#${index within the note}` (trips with that note call there) */
  viaNodes: Map<string, number>;
  /** nodes that exist only as "Via X" places (no timetable stop): a transfer there is not guaranteed */
  viaOnly: Set<number>;
  /** nodes within walking distance (including the node itself with 0 minutes) */
  near: Map<number, { node: number; walk: number }[]>;
}

/** a terminal served by this many lines is a transfer hub */
const HUB_LINES = 4;
const CLUSTER_M = 250;
const WALK_M = 200;
/** reach of a walk to or from a transfer hub */
const HUB_WALK_M = 400;


const displayName = (name: string) => withoutPole(name.replace(/,?\s*(D|S)\d*[A-Z]?$/, '')).trim();
export const dirKey = (line: Line, dirIndex: number) => `${line.id}:${dirIndex}`;

export function buildNetwork(lines: Line[], terminalWalks: readonly { a: string; b: string; min: number }[] = []): Network {
  const nodes: Node[] = [];
  const keyToNodes = new Map<string, number[]>();
  const dirNodes = new Map<string, number[]>();
  const aliases = new Map<string, { name: string; nodes: Set<number> }>();
  const addAlias = (label: string | null, node: number) => {
    const k = norm(label ?? '');
    if (k.length < 3) return;
    const e = aliases.get(k) ?? { name: (label as string).trim(), nodes: new Set<number>() };
    e.nodes.add(node);
    aliases.set(k, e);
  };

  const nodeFor = (s: Stop): Node => {
    const key = stopKey(s.name);
    const cands = (keyToNodes.get(key) ?? []).map((i) => nodes[i]).filter((c) => c.terminal === s.terminal);
    let node: Node | undefined;
    if (s.lat !== undefined && s.lon !== undefined) {
      const p = { lat: s.lat, lon: s.lon };
      node = cands.find((c) => c.lat !== undefined && metres(c as Required<Node>, p) <= CLUSTER_M) ?? cands.find((c) => c.lat === undefined);
      if (node && node.lat === undefined) Object.assign(node, p);
    } else node = cands.find((c) => !s.par || !c.par || c.par === s.par); // without a position, a namesake of another parish is another stop
    if (!node) {
      node = { id: nodes.length, key, name: displayName(s.name), ...(s.terminal ? { terminal: s.terminal } : {}), ...(s.lat !== undefined ? { lat: s.lat, lon: s.lon } : {}), ...(s.muni ? { muni: s.muni } : {}), ...(s.par ? { par: s.par } : {}) };
      nodes.push(node);
      keyToNodes.set(key, [...(keyToNodes.get(key) ?? []), node.id]);
    }
    if (!node.muni && s.muni) node.muni = s.muni;
    if (!node.par && s.par) node.par = s.par;
    // a node is a mere centre of a place only when every stop merged into it is
    if (node.centroid === undefined) node.centroid = isCentroid(s);
    else if (!isCentroid(s)) node.centroid = false;
    return node;
  };
  for (const line of lines) {
    line.directions.forEach((dir, di) => {
      if (!dir.stops.length) return;
      const ids = dir.stops.map((s) => nodeFor(s).id);
      dirNodes.set(dirKey(line, di), ids);
      addAlias(dir.from, ids[0]);
      addAlias(dir.to, ids[ids.length - 1]);
    });
  }
  // places of "Via X" notes: the same node as a stop of that name nearby, else a node of their own
  const viaNodes = new Map<string, number>();
  for (const line of lines) for (const [code, list] of Object.entries(line.via ?? {})) list.forEach((v, k) => viaNodes.set(`${line.id}:${code}#${k}`, nodeFor(viaStop(v)).id));

  const viaOnly = new Set<number>();
  const onTimetable = new Set<number>([...dirNodes.values()].flat());
  for (const id of viaNodes.values()) if (!onTimetable.has(id)) viaOnly.add(id);
  // terminals (first / last stop of a direction) that many lines share are the places to change buses
  const ends = new Map<number, Set<number>>();
  for (const line of lines) {
    line.directions.forEach((_, di) => {
      const ids = dirNodes.get(dirKey(line, di));
      if (!ids) return;
      for (const id of [ids[0], ids[ids.length - 1]]) (ends.get(id) ?? ends.set(id, new Set()).get(id)!).add(line.id);
    });
  }
  for (const [id, ls] of ends) if (ls.size >= HUB_LINES) nodes[id].transferHub = true;

  // walking links between nearby nodes with different names (e.g. two stops around one square)
  const near = new Map<number, { node: number; walk: number }[]>();
  const located = nodes.filter((n) => n.lat !== undefined).sort((a, b) => (a.lat as number) - (b.lat as number));
  for (const n of nodes) near.set(n.id, [{ node: n.id, walk: 0 }]);
  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      if (((located[j].lat as number) - (located[i].lat as number)) * M_PER_DEG_LAT > WALK_M) break;
      const d = metres(located[i] as Required<Node>, located[j] as Required<Node>);
      if (d <= WALK_M) {
        const walk = walkMinutes(d);
        near.get(located[i].id)!.push({ node: located[j].id, walk });
        near.get(located[j].id)!.push({ node: located[i].id, walk });
      }
    }
  }
  // a transfer hub (Funchal terminal ...) is reachable on foot from the stops around it a bit further away than an ordinary pair of stops:
  // a city bus to the centre, then a short walk to the terminal where the intercity bus starts
  for (const h of located.filter((n) => n.transferHub)) {
    for (const n of located) {
      if (n.id === h.id) continue;
      const d = metres(h as Required<Node>, n as Required<Node>);
      if (d <= WALK_M || d > HUB_WALK_M) continue;
      const walk = walkMinutes(d);
      near.get(h.id)!.push({ node: n.id, walk });
      near.get(n.id)!.push({ node: h.id, walk });
    }
  }
  // guaranteed links between the Funchal terminals: at least the stated walking time, and never less than the nodes' own distance
  const link = (x: number, y: number, walk: number) => {
    const list = near.get(x)!;
    const e = list.find((l) => l.node === y);
    if (e) e.walk = Math.max(e.walk, walk);
    else list.push({ node: y, walk });
  };
  for (const w of terminalWalks) {
    for (const x of nodes.filter((n) => n.terminal === w.a)) for (const y of nodes.filter((n) => n.terminal === w.b)) {
      link(x.id, y.id, w.min);
      link(y.id, x.id, w.min);
    }
  }
  return { nodes, dirNodes, keyToNodes, aliases, near, viaNodes, viaOnly };
}

/** A bus run with an (absolute, minutes since 00:00 of the searched date) time at each stop it calls at. */
export interface Trip {
  line: Line;
  dirIndex: number;
  dir: Direction;
  nodes: number[];
  /** stops aligned with `nodes` and `times`; absent = `dir.stops` (set when the trip calls at a "Via" place) */
  stops?: Stop[];
  times: (number | null)[];
  /** times after the first stop are estimates */
  estimated: boolean;
  notes?: string[];
}

function tripsOfDirection(
  net: Network,
  line: Line,
  dirIndex: number,
  type: ReturnType<typeof serviceDay>['type'],
  school: boolean,
  shift: number,
  out: Trip[],
) {
  if (!type) return;
  const dir = line.directions[dirIndex];
  const nodes = net.dirNodes.get(dirKey(line, dirIndex));
  if (!nodes) return;
  const push = (times: (number | null)[], estimated: boolean, notes?: string[]) => {
    const shifted = times.map((t) => (t === null || t + shift < 0 ? null : t + shift));
    if (shifted.filter((t) => t !== null).length < 2) return;
    // "Via Aeroporto"-style notes: the trip also calls at that place, between two stops of the list
    const calls = viaAt(line, dirIndex, dir, notes);
    if (calls.size) {
      const ns: number[] = [];
      const st: Stop[] = [];
      const ts: (number | null)[] = [];
      dir.stops.forEach((s, i) => {
        ns.push(nodes[i]);
        st.push(s);
        ts.push(shifted[i]);
        const here = calls.get(i) ?? [];
        const ms = viaMinutesChain(dir, i, here.map((c) => c.place), shifted);
        here.forEach(({ code, k, place }, j) => {
          const id = net.viaNodes.get(`${line.id}:${code}#${k}`);
          if (ms[j] === null || id === undefined) return; // the trip does not run through that stretch
          ns.push(id);
          st.push(viaStop(place));
          ts.push(ms[j]);
        });
      });
      out.push({ line, dirIndex, dir, nodes: ns, stops: st, times: ts, estimated, ...(notes ? { notes } : {}) });
      return;
    }
    out.push({ line, dirIndex, dir, nodes, times: shifted, estimated, ...(notes ? { notes } : {}) });
  };
  if (dir.trips?.length) {
    const keys = keysFor(type, school);
    for (const tr of dir.trips) {
      if (!tr.days.some((d) => keys.includes(d))) continue;
      const first = tr.times.find(Boolean) as string;
      push(tr.times.map((t) => (t ? toMinutes(t) + (toMinutes(t) < toMinutes(first) ? 1440 : 0) : null)), false, tr.notes);
    }
  } else if (dir.stopOffsets && dir.stopOffsets.length === nodes.length) {
    for (const dep of withMinutes(listFor(dir, type, school))) {
      push(dir.stopOffsets.map((o) => dep.minutes + o), true, dep.notes);
    }
  }
}

/** Stops of a trip, aligned with `trip.nodes` / `trip.times` (the direction's stops plus the "Via" places the trip calls at). */
export const tripStops = (trip: Trip): Stop[] => trip.stops ?? trip.dir.stops;

/**
 * Two rows of a timetable that are one stop (arrival and departure of a bus that waits there): the same name and the same pole (code / position).
 * Stops of one street that merely share a name (ESTR Joao Goncalves Zarco, every pole with its own code) are consecutive calls, not a wait.
 */
export const sameCall = (a: Stop, b: Stop): boolean =>
  a.name === b.name && (a.code ?? null) === (b.code ?? null) && Math.abs((a.lat ?? 0) - (b.lat ?? 0)) < 0.0002 && Math.abs((a.lon ?? 0) - (b.lon ?? 0)) < 0.0002;

/** Row `i + 1` of the trip is the departure row of the stop in row `i` (a real wait), not the next pole of the same street. */
export const dwellsAt = (trip: Trip, i: number): boolean => {
  const st = tripStops(trip);
  return i + 1 < trip.nodes.length && trip.nodes[i + 1] === trip.nodes[i] && !!st[i] && !!st[i + 1] && sameCall(st[i], st[i + 1]);
};

/** All trips relevant for a search on `date`: late trips of the day before, the day itself and the next morning. */
export function servicesFor(net: Network, lines: Line[], date: Ymd, school: boolean, municipalities: readonly string[]): Trip[] {
  const out: Trip[] = [];
  for (const [offset, shift] of [[-1, -1440], [0, 0], [1, 1440]] as const) {
    const type = serviceDay(addDays(date, offset), municipalities).type;
    for (const line of lines) {
      if (!line.hasParsedSchedule) continue;
      line.directions.forEach((_, di) => tripsOfDirection(net, line, di, type, school, shift, out));
    }
  }
  return out;
}

/** Stop suggestions for the autocomplete: unique stop names (both sides of the road merged). */
export interface Suggestion {
  key: string;
  name: string;
  lines: number;
  /** "all stops of <parish>" (key `@par:<label>`) or of a city (key `@muni:<name>`); the UI adds the "(all stops)" wording */
  group?: boolean;
}

/** "all stops of <parish>" (freguesia, e.g. Santana, Faial, Caniçal): the keys of the group suggestions. Municipalities are not groups: they span valleys far apart. */
export const PARISH_PREFIX = '@par:';
/**
 * The one exception: Funchal is a group of its own. Its parishes (Sé, São Martinho, Santa Luzia ...) are unknown to people looking for
 * "the town", and its municipality is one built-up area, not valleys far apart.
 */
export const CITY_PREFIX = '@muni:';
const CITY_GROUPS = ['Funchal'];

const areaCache = new WeakMap<Network, { byParish: Map<string, Set<number>>; byCity: Map<string, Set<number>> }>();
/** Node ids per parish and per city group (cached per network). */
function areaNodes(net: Network) {
  let c = areaCache.get(net);
  if (!c) {
    c = { byParish: new Map(), byCity: new Map() };
    for (const n of net.nodes) {
      if (n.par) (c.byParish.get(n.par) ?? c.byParish.set(n.par, new Set()).get(n.par)!).add(n.id);
      if (n.muni && CITY_GROUPS.includes(n.muni)) (c.byCity.get(n.muni) ?? c.byCity.set(n.muni, new Set()).get(n.muni)!).add(n.id);
    }
    areaCache.set(net, c);
  }
  return c;
}

/** Parish labels carry ", <municipality>" where the name exists twice; the part a user types is the name. */
const parishName = (label: string) => label.split(',')[0];

/** A typed word matches the start of a word of a (normalised) name: "ilha" is not in "Pavilhao" or "Maravilhas". */
const atWord = (key: string, t: string) => key.startsWith(t) || key.includes(` ${t}`) || key.includes(`(${t}`) || key.includes(`,${t}`);

export function suggest(net: Network, lines: Line[], query: string, limit = 10): Suggestion[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const terms = expandTerms(query).map((x) => x.split(' '));
  const hit = (key: string) => terms.some((tokens) => tokens.every((t) => atWord(key, t)));
  const count = new Map<string, Set<number>>();
  for (const line of lines) {
    line.directions.forEach((_, di) => {
      for (const id of net.dirNodes.get(dirKey(line, di)) ?? []) {
        const k = net.nodes[id].key;
        (count.get(k) ?? count.set(k, new Set()).get(k)!).add(line.id);
      }
    });
  }
  const seen = new Map<string, Suggestion>();
  const groups: Suggestion[] = [];
  const linesOf = (ids: Set<number>) => {
    const ls = new Set<number>();
    for (const line of lines) line.directions.forEach((_, di) => { if ((net.dirNodes.get(dirKey(line, di)) ?? []).some((id) => ids.has(id))) ls.add(line.id); });
    return ls.size;
  };
  const wanted = (name: string) => {
    const k = norm(name);
    return k.startsWith(q) || (q.length >= 4 && atWord(k, q));
  };
  const rank = (a: Suggestion, b: Suggestion) => Number(norm(b.name) === q) - Number(norm(a.name) === q) || Number(norm(b.name).startsWith(q)) - Number(norm(a.name).startsWith(q)) || b.lines - a.lines;
  const { byParish, byCity } = areaNodes(net);
  // every parish with a stop is a group; the cadastre of the parish, never the whole municipality
  for (const [p, ids] of byParish) {
    if (ids.size < 1 || !wanted(parishName(p))) continue;
    groups.push({ key: PARISH_PREFIX + p, name: p, lines: linesOf(ids), group: true });
  }
  for (const [city, ids] of byCity) {
    if (wanted(city)) groups.push({ key: CITY_PREFIX + city, name: city, lines: linesOf(ids), group: true });
  }
  groups.sort(rank);
  groups.splice(8);
  // a stop named like a group whose stops all belong to the group adds nothing: "Porto Moniz (all stops)" covers it
  const groupNodes = new Map<string, Set<number>>();
  for (const g of groups) groupNodes.set(norm(parishName(g.name)), g.key.startsWith(CITY_PREFIX) ? byCity.get(g.name)! : byParish.get(g.name)!);
  const covered = (key: string) => {
    const set = groupNodes.get(key);
    const ids = net.keyToNodes.get(key);
    return !!set && !!ids?.length && ids.every((id) => set.has(id));
  };
  const groupKeys = new Set(groups.map((g) => norm(parishName(g.name))));
  for (const n of net.nodes) {
    if (!hit(n.key) || covered(n.key)) continue;
    if (!seen.has(n.key)) seen.set(n.key, { key: n.key, name: n.name, lines: count.get(n.key)?.size ?? 0 });
  }
  for (const [k, a] of net.aliases) {
    if (!hit(k) || seen.has(k) || groupKeys.has(k)) continue;
    const ls = new Set<number>();
    for (const line of lines) line.directions.forEach((_, di) => { if ((net.dirNodes.get(dirKey(line, di)) ?? []).some((id) => a.nodes.has(id))) ls.add(line.id); });
    seen.set(k, { key: k, name: a.name, lines: ls.size });
  }
  const stops = [...seen.values()]
    .sort((a, b) => Number(b.key.startsWith(q)) - Number(a.key.startsWith(q)) || b.lines - a.lines || a.key.length - b.key.length)
    .slice(0, limit);
  return [...groups, ...stops];
}

/** Nodes for a user input: an exact suggestion key, or every node whose name contains the typed words. */
export function resolveNodes(net: Network, input: string, pickedKey?: string | null): Set<number> {
  const out = new Set<number>();
  if (pickedKey?.startsWith(PARISH_PREFIX)) {
    for (const id of areaNodes(net).byParish.get(pickedKey.slice(PARISH_PREFIX.length)) ?? []) out.add(id);
    if (out.size) return out;
  }
  if (pickedKey?.startsWith(CITY_PREFIX)) {
    for (const id of areaNodes(net).byCity.get(pickedKey.slice(CITY_PREFIX.length)) ?? []) out.add(id);
    if (out.size) return out;
  }
  if (pickedKey) {
    for (const id of net.keyToNodes.get(pickedKey) ?? []) out.add(id);
    for (const id of net.aliases.get(pickedKey)?.nodes ?? []) out.add(id);
  }
  if (out.size) return out;
  const terms = expandTerms(input).map((x) => x.split(' ').filter(Boolean));
  if (!terms.length) return out;
  const hit = (key: string) => terms.some((tokens) => tokens.every((t) => atWord(key, t)));
  for (const n of net.nodes) if (hit(n.key)) out.add(n.id);
  for (const [k, a] of net.aliases) if (hit(k)) for (const id of a.nodes) out.add(id);
  return out;
}

/** Nearest stop (node with coordinates) within `maxM` metres of a point, or null. */
export function nearestNode(net: Network, lat: number, lon: number, maxM: number): { node: Node; metres: number } | null {
  let best: { node: Node; metres: number } | null = null;
  const p = { lat, lon };
  for (const n of net.nodes) {
    if (n.lat === undefined || n.lon === undefined) continue;
    if (Math.abs(n.lat - lat) * M_PER_DEG_LAT > maxM) continue;
    const d = metres(n as Required<Node>, p);
    if (d <= maxM && (!best || d < best.metres)) best = { node: n, metres: d };
  }
  return best;
}

/** Transfer hubs within `maxM` metres of a point (the walking alternative to a short city hop to the terminal). */
export function hubsNear(net: Network, lat: number, lon: number, maxM: number): Node[] {
  const p = { lat, lon };
  return net.nodes.filter((n) => n.transferHub && n.lat !== undefined && n.lon !== undefined && metres(n as Required<Node>, p) <= maxM);
}

/** Reach of a picked place or map point: stops within this distance count as "at" the place; if there are none, the wider radius is tried. */
export const NEAR_PLACE_M = 900;
export const FAR_PLACE_M = 2200;
/** A point picked on the map snaps to a stop within this many metres. */
export const PICK_RADIUS_M = 1000;

/**
 * The stops to walk to from a place (a beach, a hotel, a point on the map): up to `limit` nearest stops (one per name, both sides of the road
 * together) within NEAR_PLACE_M, else the nearest few within FAR_PLACE_M. `widened` tells the wider radius was needed.
 */
export function nodesNearPoint(net: Network, lat: number, lon: number, limit = 8): { nodes: { node: Node; metres: number }[]; widened: boolean } {
  const p = { lat, lon };
  const all: { node: Node; metres: number }[] = [];
  for (const n of net.nodes) {
    if (n.lat === undefined || n.lon === undefined || Math.abs(n.lat - lat) * M_PER_DEG_LAT > FAR_PLACE_M) continue;
    const d = metres(n as Required<Node>, p);
    if (d <= FAR_PLACE_M) all.push({ node: n, metres: d });
  }
  all.sort((a, b) => a.metres - b.metres);
  const seen = new Set<string>();
  const unique = all.filter(({ node }) => (seen.has(node.key) ? false : (seen.add(node.key), true)));
  const near = unique.filter((x) => x.metres <= NEAR_PLACE_M);
  if (near.length) return { nodes: near.slice(0, limit), widened: false };
  return { nodes: unique.slice(0, Math.min(limit, 4)), widened: unique.length > 0 };
}

/** Every node of the stops named like the given ones (both sides of the road): a picked stop stands for all of them. */
export function nodeIdsOfKeys(net: Network, keys: Iterable<string>): Set<number> {
  const out = new Set<number>();
  for (const k of keys) for (const id of net.keyToNodes.get(k) ?? []) out.add(id);
  return out;
}

/** Stops (nodes) within `maxMin` minutes' walk of the given ones, with the minutes: the other side of the road is often named differently. */
export function nearbyStopNodes(net: Network, base: ReadonlySet<number>, maxMin: number): Map<number, number> {
  const extra = new Map<number, number>();
  for (const id of base) for (const x of net.near.get(id) ?? []) if (x.walk <= maxMin && !base.has(x.node)) extra.set(x.node, Math.min(extra.get(x.node) ?? Infinity, x.walk));
  return extra;
}

/**
 * Stops that stand for the centre of a parish when the traveller picks the whole parish as a place to go to ("Camacha (all stops)"): the buses end their
 * ride there, not at the first roadside pole on the parish border (Levada dos Tornos, 5 km before the village). Listed by hand where the busiest stops
 * are not the village square; elsewhere the stops served by the most directions (at least 80 % of the busiest) are the centre.
 */
const PARISH_CENTRES: Record<string, string[]> = {
  camacha: ['Largo da Achada', 'Igreja da Camacha'],
  // the stops of Ilha are only "Via" places of line 138 (no timetable stop to count); Achada do Marques lies 1.5 km up the road
  ilha: ['Ilha'],
};

const centreCache = new WeakMap<Network, Map<string, Set<number>>>();
/** The centre stops (node ids) of a parish group key (`@par:<label>`); an empty set when the parish has none to prefer. */
export function parishCentre(net: Network, groupKey: string): Set<number> {
  let byKey = centreCache.get(net);
  if (!byKey) centreCache.set(net, (byKey = new Map()));
  const hit = byKey.get(groupKey);
  if (hit) return hit;
  const label = groupKey.slice(PARISH_PREFIX.length);
  const members = [...(areaNodes(net).byParish.get(label) ?? [])];
  const out = new Set<number>();
  const named = PARISH_CENTRES[norm(parishName(label))];
  if (named) for (const id of members) if (named.some((n) => norm(n) === net.nodes[id].key)) out.add(id);
  if (!out.size && members.length) {
    const served = new Map<number, number>();
    for (const ids of net.dirNodes.values()) for (const id of new Set(ids)) served.set(id, (served.get(id) ?? 0) + 1);
    const top = Math.max(0, ...members.map((id) => served.get(id) ?? 0));
    if (top > 1) for (const id of members) if ((served.get(id) ?? 0) >= top * 0.8) out.add(id);
  }
  byKey.set(groupKey, out);
  return out;
}
