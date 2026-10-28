// RAPTOR against the existing planner on the real timetables (public/data/schedules.json, made by `npm run build:data`):
// every itinerary `plan()` offers (direct, or with one transfer) must be matched or beaten by a RAPTOR journey: not leaving earlier,
// not arriving later, not changing more. And what RAPTOR offers must be a ride that can be made (buffers, walks, stops line up).
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PARISH_PREFIX, buildNetwork, nearbyStopNodes, nodeIdsOfKeys, resolveNodes, servicesFor, type Network } from '../src/lib/network';
import { MAX_WAIT, MAX_WAIT_FALLBACK, MIN_TRANSFER, MIN_TRANSFER_ESTIMATED, plan, type Itinerary } from '../src/lib/router';
import { planRaptor, raptorJourneys } from '../src/lib/raptorAdapter';
import type { Dataset } from '../src/types';

const file = 'public/data/schedules.json';
const WINDOW = 720;
const QUERIES = 160;

/** deterministic pseudo-random numbers */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const dominates = (j: Itinerary, it: Itinerary) => j.depart >= it.depart && j.finish <= it.finish && j.legs.length <= it.legs.length;

/** a journey that can be made: every transfer has its buffer + walk, the walk is to a stop that really is near, no U-turn onto the same line */
function problems(net: Network, it: Itinerary): string[] {
  const out: string[] = [];
  it.legs.forEach((l, i) => {
    if (!(l.arrive > l.depart || (l.arrive === l.depart && l.stops > 0))) out.push(`leg ${i} does not move forward in time`);
    if (l.trip.times[l.toPos] !== l.arrive || l.trip.times[l.fromPos] !== l.depart) out.push(`leg ${i} times differ from the trip`);
    if (i === 0) return;
    const prev = it.legs[i - 1];
    const a = prev.trip.nodes[prev.toPos];
    const b = l.trip.nodes[l.fromPos];
    const walk = a === b ? 0 : net.near.get(a)?.find((x) => x.node === b)?.walk;
    if (walk === undefined) out.push(`leg ${i}: stop ${net.nodes[a].name} -> ${net.nodes[b].name} is no walking link`);
    else if ((l.walkBefore ?? 0) < walk) out.push(`leg ${i}: walkBefore ${l.walkBefore} < link ${walk}`);
    const buffer = prev.trip.estimated || l.trip.estimated ? MIN_TRANSFER_ESTIMATED : MIN_TRANSFER;
    if (l.depart < prev.arrive + (l.walkBefore ?? 0) + buffer) out.push(`leg ${i}: boards at ${l.depart}, arrived ${prev.arrive} + walk ${l.walkBefore} + buffer ${buffer}`);
    if (l.trip.line.id === prev.trip.line.id) out.push(`leg ${i}: same line twice in a row`);
  });
  return out;
}

describe.skipIf(!existsSync(file))('RAPTOR vs plan() (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const net = buildNetwork(data.lines, data.terminalWalks);
  const trips = servicesFor(net, data.lines, { y: 2026, m: 10, d: 28 }, true, ['Funchal']);
  const served = [...new Set(trips.flatMap((t) => t.nodes))].filter((id) => net.nodes[id].lat !== undefined);
  const rand = rng(20261028);
  const pick = () => net.nodes[served[Math.floor(rand() * served.length)]];

  /** a picked stop stands for its namesakes and the stops 3 minutes away on foot (as `runSearch` does) */
  const endOf = (key: string, withNear: boolean) => {
    const ids = nodeIdsOfKeys(net, [key]);
    const extra = withNear ? nearbyStopNodes(net, ids, 3) : new Map<number, number>();
    for (const id of extra.keys()) ids.add(id);
    return { ids, extra: extra.size ? new Map(extra) : undefined };
  };

  it('matches or beats every itinerary of the existing planner, and offers only rides that can be made', () => {
    let compared = 0;
    let better = 0;
    let identical = 0;
    let found = 0;
    const missed: string[] = [];
    const invalid: string[] = [];
    const shared: string[] = [];
    const cappedDiff: string[] = [];
    let checked = 0;
    for (let q = 0; q < QUERIES; q++) {
      const a = pick();
      const b = pick();
      if (a.key === b.key) continue;
      const near = q % 2 === 1;
      const A = endOf(a.key, near);
      const B = endOf(b.key, near);
      const at = 360 + Math.floor(rand() * 840);
      const old = plan(net, trips, A.ids, B.ids, at, A.extra, B.extra);
      const mine = raptorJourneys(net, trips, A.ids, B.ids, at, A.extra, B.extra, { window: WINDOW, maxWait: MAX_WAIT });
      // `plan()` falls back to a longer wait when nothing else is found
      const pool = old.direct.length ? mine : [...mine, ...raptorJourneys(net, trips, A.ids, B.ids, at, A.extra, B.extra, { window: WINDOW, maxWait: MAX_WAIT_FALLBACK })];
      if (mine.length) found++;
      for (const it of [...old.direct, ...old.transfers]) {
        if (it.depart > at + WINDOW) continue;
        compared++;
        let best = pool.find((j) => dominates(j, it));
        // `plan()` offers a ride away from the destination when nothing else is found
        if (!best && !old.direct.length) best = raptorJourneys(net, trips, A.ids, B.ids, at, A.extra, B.extra, { window: WINDOW, maxWait: MAX_WAIT_FALLBACK, relaxed: true }).find((j) => dominates(j, it));
        if (!best) {
          missed.push(`${a.name} -> ${b.name} @${at}${near ? ' (near)' : ''}: ${it.legs.map((l) => `${l.trip.line.number}:${l.depart}-${l.arrive}`).join(' > ')} finish ${it.finish}`);
        } else if (best.depart > it.depart || best.finish < it.finish || best.legs.length < it.legs.length) better++;
        else identical++;
      }
      for (const j of mine) for (const p of problems(net, j)) invalid.push(`${a.name} -> ${b.name} @${at}: ${p}`);
      // the run that shares its labels between departures finds what a search of every departure from scratch finds (without the cap on the
      // wait: with it, arriving earlier can make a transfer impossible, so no label is the best one and the two may differ at the window's edge)
      if (q % 4 === 0) {
        const key = (its: Itinerary[]) => its.map((x) => `${x.depart}>${x.finish}/${x.legs.length - 1}`).sort().join(' ');
        for (const maxWait of [Infinity, MAX_WAIT]) {
          const fast = maxWait === MAX_WAIT ? mine : raptorJourneys(net, trips, A.ids, B.ids, at, A.extra, B.extra, { window: WINDOW, maxWait });
          const slow = raptorJourneys(net, trips, A.ids, B.ids, at, A.extra, B.extra, { window: WINDOW, maxWait, independentRuns: true });
          if (key(slow) !== key(fast)) (maxWait === Infinity ? shared : cappedDiff).push(`${a.name} -> ${b.name} @${at}`);
        }
        checked++;
      }
    }
    console.log(`RAPTOR parity: ${QUERIES} queries, ${found} with a journey, ${compared} itineraries of plan() compared: ${identical} identical, ${better} beaten, ${missed.length} missed, ${invalid.length} invalid; shared labels vs scratch: ${checked - shared.length}/${checked} identical without the wait cap, ${checked - cappedDiff.length}/${checked} with it`);
    expect(invalid.slice(0, 10)).toEqual([]);
    expect(shared.slice(0, 5)).toEqual([]);
    expect(missed.slice(0, 15)).toEqual([]);
    expect(compared).toBeGreaterThan(50);
  }, 600_000);

  it('Santana -> Porto Moniz (parishes, as the UI picks them) is found over Funchal, by plan() and by RAPTOR', () => {
    const from = resolveNodes(net, 'Santana', `${PARISH_PREFIX}Santana`);
    const to = resolveNodes(net, 'Porto Moniz', `${PARISH_PREFIX}Porto Moniz`);
    expect(from.size).toBeGreaterThan(0);
    expect(to.size).toBeGreaterThan(0);
    for (const at of [390, 480]) {
      for (const p of [plan(net, trips, from, to, at), planRaptor(net, trips, from, to, at)]) {
        expect(p.transfers.length).toBeGreaterThan(0);
        // the first bus really leaves from a stop of Santana
        expect(p.transfers.every((it) => from.has(it.legs[0].trip.nodes[it.legs[0].fromPos]))).toBe(true);
      }
    }
  });

  it('planRaptor gives the same shape as plan(): direct departures in time order, a few transfers, never more than two changes', () => {
    const rand2 = rng(7);
    let shown = 0;
    for (let q = 0; q < 40; q++) {
      const a = net.nodes[served[Math.floor(rand2() * served.length)]];
      const b = net.nodes[served[Math.floor(rand2() * served.length)]];
      if (a.key === b.key) continue;
      const A = nodeIdsOfKeys(net, [a.key]);
      const B = nodeIdsOfKeys(net, [b.key]);
      const p = planRaptor(net, trips, A, B, 600 + q * 7);
      expect(p.direct.length).toBeLessThanOrEqual(8);
      expect(p.transfers.length).toBeLessThanOrEqual(6);
      expect(p.direct.every((it, i, all) => it.legs.length === 1 && (i === 0 || all[i - 1].depart <= it.depart))).toBe(true);
      expect(p.transfers.every((it) => it.legs.length >= 2 && it.legs.length <= 3)).toBe(true);
      shown += p.direct.length + p.transfers.length;
    }
    expect(shown).toBeGreaterThan(0);
  }, 300_000);
});
