// Stop network and day services for the journey planner.
import { addDays, serviceDay, type Ymd } from './holidays';
import { keysFor, listFor, withMinutes } from './departures';
import { norm, stopKey } from './search';
import { toMinutes } from './time';
import type { Direction, Line } from '../types';
import { expandTerms } from './aliases';

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
}

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
  /** nodes within walking distance (including the node itself with 0 minutes) */
  near: Map<number, { node: number; walk: number }[]>;
}

const CLUSTER_M = 250;
const WALK_M = 200;
const WALK_M_PER_MIN = 70;

const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const kx = 111320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * 110540);
};

const displayName = (name: string) => name.replace(/,?\s*(D|S)\d*[A-Z]?$/, '').trim();
export const dirKey = (line: Line, dirIndex: number) => `${line.id}:${dirIndex}`;

export function buildNetwork(lines: Line[]): Network {
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

  for (const line of lines) {
    line.directions.forEach((dir, di) => {
      if (!dir.stops.length) return;
      const ids = dir.stops.map((s) => {
        const key = stopKey(s.name);
        const cands = (keyToNodes.get(key) ?? []).map((i) => nodes[i]);
        let node: Node | undefined;
        if (s.lat !== undefined && s.lon !== undefined) {
          const p = { lat: s.lat, lon: s.lon };
          node = cands.find((c) => c.lat !== undefined && metres(c as Required<Node>, p) <= CLUSTER_M) ?? cands.find((c) => c.lat === undefined);
          if (node && node.lat === undefined) Object.assign(node, p);
        } else node = cands[0];
        if (!node) {
          node = { id: nodes.length, key, name: displayName(s.name), ...(s.lat !== undefined ? { lat: s.lat, lon: s.lon } : {}), ...(s.muni ? { muni: s.muni } : {}), ...(s.par ? { par: s.par } : {}) };
          nodes.push(node);
          keyToNodes.set(key, [...(keyToNodes.get(key) ?? []), node.id]);
        }
        if (!node.muni && s.muni) node.muni = s.muni;
        if (!node.par && s.par) node.par = s.par;
        return node.id;
      });
      dirNodes.set(dirKey(line, di), ids);
      addAlias(dir.from, ids[0]);
      addAlias(dir.to, ids[ids.length - 1]);
    });
  }

  // walking links between nearby nodes with different names (e.g. two stops around one square)
  const near = new Map<number, { node: number; walk: number }[]>();
  const located = nodes.filter((n) => n.lat !== undefined).sort((a, b) => (a.lat as number) - (b.lat as number));
  for (const n of nodes) near.set(n.id, [{ node: n.id, walk: 0 }]);
  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      if (((located[j].lat as number) - (located[i].lat as number)) * 110540 > WALK_M) break;
      const d = metres(located[i] as Required<Node>, located[j] as Required<Node>);
      if (d <= WALK_M) {
        const walk = Math.max(1, Math.ceil(d / WALK_M_PER_MIN));
        near.get(located[i].id)!.push({ node: located[j].id, walk });
        near.get(located[j].id)!.push({ node: located[i].id, walk });
      }
    }
  }
  return { nodes, dirNodes, keyToNodes, aliases, near };
}

/** A bus run with an (absolute, minutes since 00:00 of the searched date) time at each stop it calls at. */
export interface Trip {
  line: Line;
  dirIndex: number;
  dir: Direction;
  nodes: number[];
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
  /** "all stops of <municipality>": key is `@muni:<name>`, the UI adds the "(all stops)" wording */
  group?: boolean;
}

/** Municipalities of Madeira that can be picked as a whole ("all stops of Santana"). */
export const MUNICIPALITIES = ['Funchal', 'Câmara de Lobos', 'Ribeira Brava', 'Ponta do Sol', 'Calheta', 'Porto Moniz', 'São Vicente', 'Santana', 'Machico', 'Santa Cruz', 'Porto Santo'] as const;
export const GROUP_PREFIX = '@muni:';
/** "all stops of <parish>" (Curral das Freiras, Caniçal, Camacha, …) */
export const PARISH_PREFIX = '@par:';
const muniKeys = MUNICIPALITIES.map((m) => [m, norm(m)] as const);

const areaCache = new WeakMap<Network, { byMuni: Map<string, Set<number>>; byParish: Map<string, Set<number>> }>();
/** Node ids per municipality and per parish (cached per network). */
function areaNodes(net: Network) {
  let c = areaCache.get(net);
  if (!c) {
    c = { byMuni: new Map(), byParish: new Map() };
    for (const n of net.nodes) {
      if (n.muni) (c.byMuni.get(n.muni) ?? c.byMuni.set(n.muni, new Set()).get(n.muni)!).add(n.id);
      if (n.par) (c.byParish.get(n.par) ?? c.byParish.set(n.par, new Set()).get(n.par)!).add(n.id);
    }
    areaCache.set(net, c);
  }
  return c;
}

export function suggest(net: Network, lines: Line[], query: string, limit = 10): Suggestion[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const terms = expandTerms(query).map((x) => x.split(' '));
  const hit = (key: string) => terms.some((tokens) => tokens.every((t) => key.includes(t)));
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
    return k.startsWith(q) || (q.length >= 4 && k.includes(q));
  };
  const rank = (a: Suggestion, b: Suggestion) => Number(norm(b.name) === q) - Number(norm(a.name) === q) || Number(norm(b.name).startsWith(q)) - Number(norm(a.name).startsWith(q)) || b.lines - a.lines;
  const { byMuni, byParish } = areaNodes(net);
  const muniGroups: Suggestion[] = [];
  for (const m of MUNICIPALITIES) {
    const ids = byMuni.get(m);
    if (ids?.size && wanted(m)) muniGroups.push({ key: GROUP_PREFIX + m, name: m, lines: linesOf(ids), group: true });
  }
  // parishes with at least 2 stops; one named like its municipality is the municipality group already
  const parishGroups: Suggestion[] = [];
  for (const [p, ids] of byParish) {
    if (ids.size < 2 || muniKeys.some(([, k]) => k === norm(p)) || !wanted(p)) continue;
    parishGroups.push({ key: PARISH_PREFIX + p, name: p, lines: linesOf(ids), group: true });
  }
  muniGroups.sort(rank);
  parishGroups.sort(rank);
  groups.push(...muniGroups, ...parishGroups.slice(0, 4));
  // a stop named like a group whose stops all belong to the group adds nothing: "Porto Moniz (all stops)" covers it
  const groupNodes = new Map<string, Set<number>>();
  for (const g of groups) groupNodes.set(norm(g.name), g.key.startsWith(GROUP_PREFIX) ? byMuni.get(g.name)! : byParish.get(g.name)!);
  const covered = (key: string) => {
    const set = groupNodes.get(key);
    const ids = net.keyToNodes.get(key);
    return !!set && !!ids?.length && ids.every((id) => set.has(id));
  };
  const groupKeys = new Set(groups.map((g) => norm(g.name)));
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
  // "all stops of <municipality>": picked from the suggestions, or the bare municipality name typed
  const typed = muniKeys.find(([, k]) => k === norm(input));
  const muni = pickedKey?.startsWith(GROUP_PREFIX) ? pickedKey.slice(GROUP_PREFIX.length) : !pickedKey ? typed?.[0] : undefined;
  if (muni) {
    for (const x of net.nodes) if (x.muni === muni) out.add(x.id);
    if (out.size) return out;
  }
  if (pickedKey?.startsWith(PARISH_PREFIX)) {
    for (const id of areaNodes(net).byParish.get(pickedKey.slice(PARISH_PREFIX.length)) ?? []) out.add(id);
    if (out.size) return out;
  }
  if (pickedKey) {
    for (const id of net.keyToNodes.get(pickedKey) ?? []) out.add(id);
    for (const id of net.aliases.get(pickedKey)?.nodes ?? []) out.add(id);
  }
  if (out.size) return out;
  const terms = expandTerms(input).map((x) => x.split(' ').filter(Boolean));
  if (!terms.length) return out;
  const hit = (key: string) => terms.some((tokens) => tokens.every((t) => key.includes(t)));
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
    if (Math.abs(n.lat - lat) * 110540 > maxM) continue;
    const d = metres(n as Required<Node>, p);
    if (d <= maxM && (!best || d < best.metres)) best = { node: n, metres: d };
  }
  return best;
}
