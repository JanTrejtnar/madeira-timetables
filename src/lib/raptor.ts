// RAPTOR (Round-bAsed Public Transit Optimized Router) over flat typed arrays, with range queries (rRAPTOR: one run per departure time).
// A pure module: it knows stops as integers, patterns and minutes, nothing about lines, the network or React, so it can be tested on
// its own and wrapped in a Web Worker later (the index is plain typed arrays; the result is plain numbers).
//
// Two labels per stop and round, because the transfer buffer depends on the pair of buses (printed times: 5 minutes, any estimated
// time on either side: 12), not on the stop: class 0 = best arrival of any leg, class 1 = best arrival of a leg with printed times.
// Boarding an estimated trip needs class 0 + the long buffer; boarding a printed one takes the better of class 1 + short and class 0 + long.
//
// Every class keeps two labels: the best arrival and the best arrival by a bus of another group (a line). Two lines that reach a stop at the same
// minute must both stay usable: the traveller may not go on by the line they came by, and which of the two that is must not depend on which
// was met first.

const INF = 0x3fffffff;
/** label channels: class (any leg / printed leg) x slot (best / best of another group) */
const NCH = 4;
/** the group of a trip that is not of any: the start of a journey (never equal to the group of a trip) */
const NO_GROUP = -1;

/** One run of a bus: stops with arrival and departure minute at each (a wait at a stop = arr < dep); calls without a time are left out. */
export interface RaptorTrip {
  nodes: ArrayLike<number>;
  arr: ArrayLike<number>;
  dep: ArrayLike<number>;
  /** times are estimates, not printed in the timetable */
  estimated: boolean;
  /**
   * A traveller who got off a bus of a group is not offered another bus of that group right there (a U-turn onto the same line). Default:
   * a group of its own, so nothing is refused. Must not be -1.
   */
  group?: number;
}

export interface RaptorInput {
  stopCount: number;
  trips: readonly RaptorTrip[];
  /** directed walking links between stops, minutes */
  footpaths: Iterable<readonly [from: number, to: number, minutes: number]>;
}

export interface RaptorIndex {
  stopCount: number;
  patternCount: number;
  /** positions of pattern p: seq[patStop[p] .. patStop[p + 1]) */
  patStop: Int32Array;
  seq: Int32Array;
  /** trips of pattern p (global trip ids g, sorted by departure, never overtaking): patTrip[p] .. patTrip[p + 1] */
  patTrip: Int32Array;
  patEst: Uint8Array;
  /** time of trip g at position i: arr[tripBase[g] + i] */
  tripBase: Int32Array;
  tripRef: Int32Array;
  tripPat: Int32Array;
  tripGroup: Int32Array;
  arr: Int32Array;
  dep: Int32Array;
  /** patterns boarding at a stop (not at their last position): paPat / paPos from paStart[stop] */
  paStart: Int32Array;
  paPat: Int32Array;
  paPos: Int32Array;
  fpStart: Int32Array;
  fpTo: Int32Array;
  fpMin: Int32Array;
}

/** `u` runs ahead of `t` everywhere: a trip behind `u` in the same pattern may not overtake it. */
const follows = (u: RaptorTrip, t: RaptorTrip): boolean => {
  for (let i = 0; i < u.nodes.length; i++) if (u.dep[i] > t.dep[i] || u.arr[i] > t.arr[i]) return false;
  return true;
};

export function buildRaptorIndex(input: RaptorInput): RaptorIndex {
  const { stopCount, trips } = input;
  // trips of one stop sequence (and one kind of times) form a pattern, unless two of them overtake each other
  const groups = new Map<string, number[]>();
  trips.forEach((t, i) => {
    if (t.nodes.length < 2) return;
    const key = (t.estimated ? 'e' : 'p') + Array.prototype.join.call(t.nodes, ',');
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  });
  const patterns: number[][] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => trips[a].dep[0] - trips[b].dep[0] || trips[a].arr[trips[a].arr.length - 1] - trips[b].arr[trips[b].arr.length - 1] || a - b);
    const chains: number[][] = [];
    for (const ti of list) {
      const chain = chains.find((c) => follows(trips[c[c.length - 1]], trips[ti]));
      if (chain) chain.push(ti);
      else chains.push([ti]);
    }
    patterns.push(...chains);
  }

  const patternCount = patterns.length;
  const tripCount = patterns.reduce((s, p) => s + p.length, 0);
  const seqLen = patterns.reduce((s, p) => s + trips[p[0]].nodes.length, 0);
  const timeLen = patterns.reduce((s, p) => s + trips[p[0]].nodes.length * p.length, 0);
  const patStop = new Int32Array(patternCount + 1);
  const patTrip = new Int32Array(patternCount + 1);
  const patEst = new Uint8Array(patternCount);
  const seq = new Int32Array(seqLen);
  const tripBase = new Int32Array(tripCount);
  const tripRef = new Int32Array(tripCount);
  const tripPat = new Int32Array(tripCount);
  const tripGroup = new Int32Array(tripCount);
  const arr = new Int32Array(timeLen);
  const dep = new Int32Array(timeLen);
  let sp = 0;
  let g = 0;
  let tp = 0;
  const boarding: number[][] = Array.from({ length: stopCount }, () => []);
  patterns.forEach((list, p) => {
    const first = trips[list[0]];
    const len = first.nodes.length;
    patStop[p] = sp;
    patTrip[p] = g;
    patEst[p] = first.estimated ? 1 : 0;
    for (let i = 0; i < len; i++) {
      seq[sp + i] = first.nodes[i];
      if (i < len - 1) boarding[first.nodes[i]].push(p, i);
    }
    for (const ti of list) {
      tripBase[g] = tp;
      tripRef[g] = ti;
      tripPat[g] = p;
      tripGroup[g] = trips[ti].group ?? -(ti + 2);
      for (let i = 0; i < len; i++) {
        arr[tp + i] = trips[ti].arr[i];
        dep[tp + i] = trips[ti].dep[i];
      }
      tp += len;
      g++;
    }
    sp += len;
  });
  patStop[patternCount] = sp;
  patTrip[patternCount] = g;

  const paStart = new Int32Array(stopCount + 1);
  for (let s = 0; s < stopCount; s++) paStart[s + 1] = paStart[s] + boarding[s].length / 2;
  const paPat = new Int32Array(paStart[stopCount]);
  const paPos = new Int32Array(paStart[stopCount]);
  for (let s = 0; s < stopCount; s++) {
    for (let k = 0; k < boarding[s].length; k += 2) {
      paPat[paStart[s] + k / 2] = boarding[s][k];
      paPos[paStart[s] + k / 2] = boarding[s][k + 1];
    }
  }

  const links: [number, number, number][][] = Array.from({ length: stopCount }, () => []);
  for (const [a, b, m] of input.footpaths) if (a !== b && a >= 0 && a < stopCount && b >= 0 && b < stopCount) links[a].push([a, b, m]);
  const fpStart = new Int32Array(stopCount + 1);
  for (let s = 0; s < stopCount; s++) fpStart[s + 1] = fpStart[s] + links[s].length;
  const fpTo = new Int32Array(fpStart[stopCount]);
  const fpMin = new Int32Array(fpStart[stopCount]);
  for (let s = 0; s < stopCount; s++) links[s].forEach(([, b, m], k) => { fpTo[fpStart[s] + k] = b; fpMin[fpStart[s] + k] = m; });

  return { stopCount, patternCount, patStop, seq, patTrip, patEst, tripBase, tripRef, tripPat, tripGroup, arr, dep, paStart, paPat, paPos, fpStart, fpTo, fpMin };
}

export interface RaptorHooks {
  /** May `trip` (index in the input) be boarded at `stop` in `round` (1 = first bus)? `prevTrip` = the bus the traveller arrives by (-1 in round 1). */
  board?: (trip: number, stop: number, round: number, prevTrip: number) => boolean;
  /** May `trip` carry the traveller from its call `from` to its call `to` (positions in the trip, as given to the index)? `final` = `to` is a destination stop. */
  leg?: (trip: number, from: number, to: number, round: number, final: boolean) => boolean;
}


export interface RaptorQuery {
  /** boarding stops with the minutes of walking to each; the traveller is ready there at departAt + walk */
  from: ReadonlyMap<number, number>;
  /** destination stops with the minutes of walking from each to the destination */
  to: ReadonlyMap<number, number>;
  departAt: number;
  /** default 2 (three buses at most) */
  maxTransfers?: number;
  /** journeys leaving up to this many minutes after departAt (default 180) */
  window?: number;
  /** minutes between an arrival and the next departure at the same stop (printed times / any estimated time) */
  buffer?: { printed: number; estimated: number };
  /** longest wait at a transfer, counted from the moment the arriving bus leaves (default unlimited) */
  maxWait?: number;
  hooks?: RaptorHooks;
  /** every departure searched from scratch instead of reusing the labels of the later ones (slow; the reference the shared run is tested against) */
  independentRuns?: boolean;
  /** search at most this many departures, the earliest ones (a wide window on a busy network would otherwise run for hundreds of departures) */
  maxRuns?: number;
  /** one run for a traveller leaving at departAt, whenever the first bus goes (the window is ignored): a cheap way to learn when a connection exists at all */
  earliestOnly?: boolean;
}

interface RaptorLeg {
  trip: number;
  from: number;
  to: number;
  /** minutes walking before boarding (from the start point for the first leg, from the previous stop for a transfer) */
  walkBefore: number;
}

export interface RaptorJourney {
  legs: RaptorLeg[];
  depart: number;
  arrive: number;
  /** arrival at the destination itself: the bus arrival + the walk from the last stop */
  finish: number;
  transfers: number;
}

/** First trip g in [g0, g1) departing position `pos` at `ready` or later (g1 if none). */
function lowerBound(ix: RaptorIndex, g0: number, g1: number, pos: number, ready: number): number {
  let lo = g0;
  let hi = g1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ix.dep[ix.tripBase[mid] + pos] < ready) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** "No way": more rides than any search allows. */
const FAR = 99;

/**
 * Backward from the destination, ignoring time: how many more rides a traveller needs.
 * `board[s]` = rides needed from boarding at `s` (a bus there reaches a stop with `after` <= board - 1); `after[s]` = rides still needed once
 * the traveller has got off at `s` (0 at a destination stop; else boarding there or after a walk to a stop that can). A label that has used up
 * so many rides that `after` exceeds the rides left can never lead to the destination and is not made. Optimistic (hooks, buffers, the
 * cap on the wait ignored), so the pruning removes nothing a journey could use.
 */
function ridesToDestination(ix: RaptorIndex, walkOut: Int32Array, maxRides: number): { board: Int8Array; after: Int8Array } {
  const n = ix.stopCount;
  const board = new Int8Array(n).fill(FAR);
  const after = new Int8Array(n).fill(FAR);
  for (let s = 0; s < n; s++) if (walkOut[s] >= 0) after[s] = 0;
  for (let j = 1; j <= maxRides; j++) {
    for (let p = 0; p < ix.patternCount; p++) {
      const off = ix.patStop[p];
      let ok = false;
      for (let i = ix.patStop[p + 1] - off - 1; i >= 0; i--) {
        const s = ix.seq[off + i];
        if (ok && board[s] > j) board[s] = j;
        if (after[s] <= j - 1) ok = true;
      }
    }
    for (let s = 0; s < n; s++) {
      let v = board[s];
      for (let a = ix.fpStart[s]; a < ix.fpStart[s + 1]; a++) if (board[ix.fpTo[a]] < v) v = board[ix.fpTo[a]];
      if (v < after[s]) after[s] = v;
    }
  }
  return { board, after };
}

/**
 * The journeys (Pareto set of departure, arrival and number of transfers) leaving within the window.
 *
 * rRAPTOR: one run per departure time of a bus from a boarding stop, latest first. The labels (`A*`: where the traveller can board from,
 * `B*`: the bus that brought them there, per round, class and stop) are kept from run to run: a label of a later departure is a valid
 * upper bound for an earlier one, so a run only works where leaving earlier improves something.
 */
export function raptor(ix: RaptorIndex, q: RaptorQuery): RaptorJourney[] {
  const n = ix.stopCount;
  const K = (q.maxTransfers ?? 2) + 1;
  const R = K + 1;
  const window = q.window ?? 180;
  const bufP = q.buffer?.printed ?? 5;
  const bufE = q.buffer?.estimated ?? 12;
  const maxWait = q.maxWait ?? Infinity;
  const hooks = q.hooks ?? {};
  const walkIn = new Int32Array(n).fill(-1);
  const walkOut = new Int32Array(n).fill(-1);
  const origin: number[] = [];
  for (const [s, w] of q.from) if (s >= 0 && s < n) { walkIn[s] = w; origin.push(s); }
  for (const [s, w] of q.to) if (s >= 0 && s < n) walkOut[s] = w;
  if (!origin.length) return [];
  const { board: ridesFrom, after: ridesAfter } = ridesToDestination(ix, walkOut, K);
  if (!origin.some((s) => ridesFrom[s] <= K)) return [];

  // departure times worth a run: the departures of a bus from a boarding stop
  const cands = new Set<number>();
  for (const s of q.earliestOnly ? [] : origin) {
    const lo = q.departAt + walkIn[s];
    const hi = lo + window;
    for (let a = ix.paStart[s]; a < ix.paStart[s + 1]; a++) {
      const p = ix.paPat[a];
      const pos = ix.paPos[a];
      for (let g = lowerBound(ix, ix.patTrip[p], ix.patTrip[p + 1], pos, lo); g < ix.patTrip[p + 1]; g++) {
        const t = ix.dep[ix.tripBase[g] + pos];
        if (t > hi) break;
        if (hooks.board && !hooks.board(ix.tripRef[g], s, 1, -1)) continue;
        cands.add(t);
      }
    }
  }
  const departures = q.earliestOnly ? [q.departAt] : [...cands].sort((a, b) => a - b).slice(0, q.maxRuns ?? Infinity).reverse();

  // Labels per CHANNEL, round and stop at [round * n + stop]. channel = class * 2 + slot: class 0 = any leg, class 1 = printed leg;
  // slot 0 = the best arrival, slot 1 = the best arrival by a bus of ANOTHER group than slot 0 (two lines that reach a stop at the same
  // minute: the traveller may not go on by the group they came by, and which one that is must not depend on which was met first).
  // `A*` = where the traveller can board from (after a bus or after a walk), `B*` = the bus that brought them there.
  const mk = (): Int32Array[] => Array.from({ length: NCH }, () => new Int32Array(R * n));
  const Aarr = mk(), Aleave = mk(), Afoot = mk(), Afch = mk(), Awalk = mk(), Agrp = mk();
  const Barr = mk(), Bg = mk(), Bfrom = mk(), Bto = mk(), Bpc = mk(), Bleave = mk();
  const FIELDS = [Aarr, Aleave, Afoot, Afch, Awalk, Agrp, Barr, Bg, Bfrom, Bto, Bpc, Bleave];
  const resetLabels = () => {
    for (let ch = 0; ch < NCH; ch++) { Aarr[ch].fill(INF); Barr[ch].fill(INF); }
  };
  resetLabels();
  const upd = Array.from({ length: NCH }, () => new Int32Array(n));
  const qPos = new Int32Array(ix.patternCount).fill(INF);
  const inNext = new Uint8Array(n);
  const inBus = new Uint8Array(n);
  const copyLabel = (from: number, to: number, idx: number) => { for (const f of FIELDS) f[to][idx] = f[from][idx]; };
  /** best arrival of class c at a stop in rounds 1..k-1 (round 0 is the start itself: arriving back at a boarding stop is still a way to go on) */
  const prevBound = (c: number, s: number, k: number) => {
    let m = INF;
    for (let j = 1; j < k; j++) if (Aarr[c * 2][j * n + s] < m) m = Aarr[c * 2][j * n + s];
    return m;
  };
  /** The channel an arrival (class c, minute t, group grp) at stop s in round k would take, or -1 when it improves nothing. */
  const slotFor = (c: number, k: number, s: number, t: number, grp: number): number => {
    if (t >= prevBound(c, s, k)) return -1;
    const idx = k * n + s;
    const best = c * 2;
    if (t < Aarr[best][idx]) return best;
    return Agrp[best][idx] !== grp && t < Aarr[best + 1][idx] ? best + 1 : -1;
  };
  /** Before a new best takes slot 0, the old best moves to slot 1 unless it is of the same group (then slot 1 stays as it is). */
  const makeRoom = (ch: number, idx: number, grp: number) => {
    if (ch % 2 === 0 && Aarr[ch][idx] < INF && Agrp[ch][idx] !== grp) copyLabel(ch, ch + 1, idx);
  };

  const found: RaptorJourney[] = [];
  const estimatedTrip = (g: number) => ix.patEst[ix.tripPat[g]] === 1;
  const tripStop = (g: number, pos: number) => ix.seq[ix.patStop[ix.tripPat[g]] + pos];

  function reconstruct(k: number, dest: number): RaptorJourney | null {
    const legs: (RaptorLeg & { g: number })[] = [];
    let r = k;
    let stop = dest;
    let ch = 0;
    while (r >= 1) {
      const idx = r * n + stop;
      const g = Bg[ch][idx];
      const from = Bfrom[ch][idx];
      const pc = Bpc[ch][idx];
      const boardStop = tripStop(g, from);
      const pidx = (r - 1) * n + boardStop;
      const foot = Afoot[pc][pidx];
      legs.push({ trip: ix.tripRef[g], g, from, to: Bto[ch][idx], walkBefore: foot >= 0 ? Awalk[pc][pidx] : 0 });
      if (foot >= 0) { stop = foot; ch = Afch[pc][pidx]; }
      else { stop = boardStop; ch = pc; }
      r--;
    }
    legs.reverse();
    const first = legs[0];
    first.walkBefore = walkIn[tripStop(first.g, first.from)];
    // labels kept from other runs may have been improved since, and a part stitched together this way is feasible only if the buffer, the
    // cap on the wait and the rule on groups still hold; a chain that breaks them is dropped (the run that made it has already reported it)
    for (let i = 1; i < legs.length; i++) {
      const a = legs[i - 1];
      const b = legs[i];
      const buf = estimatedTrip(a.g) || estimatedTrip(b.g) ? bufE : bufP;
      const board = ix.dep[ix.tripBase[b.g] + b.from];
      if (board < ix.arr[ix.tripBase[a.g] + a.to] + b.walkBefore + buf) return null;
      if (board - (ix.dep[ix.tripBase[a.g] + a.to] + b.walkBefore + buf) > maxWait) return null;
      if (ix.tripGroup[a.g] === ix.tripGroup[b.g]) return null;
    }
    const last = legs[legs.length - 1];
    const arrive = ix.arr[ix.tripBase[last.g] + last.to];
    return {
      legs: legs.map(({ trip, from, to, walkBefore }) => ({ trip, from, to, walkBefore })),
      depart: ix.dep[ix.tripBase[first.g] + first.from],
      arrive,
      finish: arrive + walkOut[tripStop(last.g, last.to)],
      transfers: legs.length - 1,
    };
  }

  for (const d of departures) {
    if (q.independentRuns) resetLabels();
    for (let ch = 0; ch < NCH; ch++) upd[ch].fill(-1);
    let marked: number[] = [];
    for (const s of origin) {
      // a candidate departure d: the traveller is at each stop at d (those too far to reach by then are not boarded from this run);
      // earliest only: at each stop as soon as they can walk there
      if (!q.earliestOnly && d - walkIn[s] < q.departAt) continue;
      const start = q.earliestOnly ? q.departAt + walkIn[s] : d;
      // no `prevBound` on the start: a bus may bring the traveller back to a boarding stop (a hop between two stops of the start area,
      // then a walk to a stop outside it) – the router has always offered that, and pruning it loses a connection plan() finds
      for (const ch of [0, 2]) {
        Aarr[ch][s] = start;
        Aleave[ch][s] = start;
        Afoot[ch][s] = -1;
        Agrp[ch][s] = NO_GROUP;
      }
      marked.push(s);
    }
    let bestFin = INF;
    for (let k = 1; k <= K && marked.length; k++) {
      const kn = k * n;
      const pn = kn - n;
      // patterns through the stops improved in the previous round, each from its first such position
      const queue: number[] = [];
      for (const s of marked) {
        for (let a = ix.paStart[s]; a < ix.paStart[s + 1]; a++) {
          const p = ix.paPat[a];
          if (qPos[p] === INF) queue.push(p);
          if (ix.paPos[a] < qPos[p]) qPos[p] = ix.paPos[a];
        }
      }
      const newBus: number[] = [];
      for (const p of queue) {
        const pos0 = qPos[p];
        qPos[p] = INF;
        const off = ix.patStop[p];
        const len = ix.patStop[p + 1] - off;
        const est = ix.patEst[p] === 1;
        const g0 = ix.patTrip[p];
        const g1 = ix.patTrip[p + 1];
        let cur = -1;
        let curBoard = -1;
        let curCh = 0;
        for (let i = pos0; i < len; i++) {
          const s = ix.seq[off + i];
          if (cur >= 0) {
            const t = ix.arr[ix.tripBase[cur] + i];
            const w = walkOut[s];
            if (t < bestFin && (w < 0 || t + w < bestFin) && ridesAfter[s] <= K - k) {
              const grp = ix.tripGroup[cur];
              const chE = slotFor(0, k, s, t, grp);
              const chN = est ? -1 : slotFor(1, k, s, t, grp);
              if ((chE >= 0 || chN >= 0) && (!hooks.leg || hooks.leg(ix.tripRef[cur], curBoard, i, k, w >= 0))) {
                const lv = ix.dep[ix.tripBase[cur] + i];
                const idx = kn + s;
                for (const ch of [chE, chN]) {
                  if (ch < 0) continue;
                  makeRoom(ch, idx, grp);
                  Barr[ch][idx] = t;
                  Bg[ch][idx] = cur;
                  Bfrom[ch][idx] = curBoard;
                  Bto[ch][idx] = i;
                  Bpc[ch][idx] = curCh;
                  Bleave[ch][idx] = lv;
                  Aarr[ch][idx] = t;
                  Aleave[ch][idx] = lv;
                  Afoot[ch][idx] = -1;
                  Agrp[ch][idx] = grp;
                  upd[ch][s] = k;
                }
                if (!inBus[s]) { inBus[s] = 1; newBus.push(s); }
              }
            }
          }
          if (i === len - 1) break;
          // boarding: from the labels of the previous round, with the buffer of this pair of buses; the earliest trip that is not of the
          // group the traveller arrives by wins, whichever label it comes from
          let bestG = cur >= 0 ? cur : g1;
          let bestCh = -1;
          for (let ch = 0; ch < (k === 1 ? 1 : NCH); ch++) {
            const a = Aarr[ch][pn + s];
            if (a >= INF) continue;
            let ready = a;
            let base = a;
            if (k > 1) {
              const buf = ch >> 1 === 1 && !est ? bufP : bufE;
              ready = a + buf;
              base = Aleave[ch][pn + s] + buf;
            }
            let g = lowerBound(ix, g0, bestG, i, ready);
            if (g >= bestG) continue;
            const grp = Agrp[ch][pn + s];
            let prevTrip = -1;
            if (hooks.board && k > 1) {
              const foot = Afoot[ch][pn + s];
              prevTrip = foot >= 0 ? ix.tripRef[Bg[Afch[ch][pn + s]][pn + foot]] : ix.tripRef[Bg[ch][pn + s]];
            }
            for (; g < bestG; g++) {
              if (k > 1 && ix.dep[ix.tripBase[g] + i] - base > maxWait) { g = bestG; break; }
              if (grp !== NO_GROUP && ix.tripGroup[g] === grp) continue; // back onto the group the traveller came by
              if (!hooks.board || hooks.board(ix.tripRef[g], s, k, prevTrip)) break;
            }
            if (g < bestG) { bestG = g; bestCh = ch; }
          }
          if (bestCh >= 0) { cur = bestG; curBoard = i; curCh = bestCh; }
        }
      }
      // the best arrival at the destination in this round (only a bus arrival counts, not a walk)
      let bestS = -1;
      let bestHere = INF;
      for (const s of newBus) {
        inBus[s] = 0;
        if (walkOut[s] >= 0 && upd[0][s] === k) {
          const fin = Barr[0][kn + s] + walkOut[s];
          if (fin < bestHere) { bestHere = fin; bestS = s; }
        }
      }
      if (bestS >= 0 && bestHere < bestFin) {
        bestFin = bestHere;
        const j = reconstruct(k, bestS);
        if (j) found.push(j);
      }
      // footpaths from the stops reached by bus in this round (never into a destination stop: a walk there is no arrival)
      const next: number[] = [];
      for (const p of newBus) {
        if (!inNext[p]) { inNext[p] = 1; next.push(p); }
        for (let a = ix.fpStart[p]; a < ix.fpStart[p + 1]; a++) {
          const s = ix.fpTo[a];
          if (walkOut[s] >= 0 || ridesFrom[s] > K - k) continue;
          for (let ch = 0; ch < NCH; ch++) {
            if (upd[ch][p] !== k) continue;
            const val = Barr[ch][kn + p] + ix.fpMin[a];
            const grp = Agrp[ch][kn + p];
            const to = slotFor(ch >> 1, k, s, val, grp);
            if (to < 0) continue;
            const idx = kn + s;
            makeRoom(to, idx, grp);
            Aarr[to][idx] = val;
            Aleave[to][idx] = Bleave[ch][kn + p] + ix.fpMin[a];
            Afoot[to][idx] = p;
            Afch[to][idx] = ch;
            Awalk[to][idx] = ix.fpMin[a];
            Agrp[to][idx] = grp;
            if (!inNext[s]) { inNext[s] = 1; next.push(s); }
          }
        }
      }
      for (const s of next) inNext[s] = 0;
      marked = next;
    }
  }
  return pareto(found);
}

/** Journeys no other journey beats on departure (later), arrival (earlier) and transfers (fewer); duplicates collapse to one. */
function pareto(js: RaptorJourney[]): RaptorJourney[] {
  const sorted = [...js].sort((a, b) => b.depart - a.depart || a.finish - b.finish || a.transfers - b.transfers);
  const kept: RaptorJourney[] = [];
  for (const j of sorted) if (!kept.some((k) => k.depart >= j.depart && k.finish <= j.finish && k.transfers <= j.transfers)) kept.push(j);
  return kept;
}
