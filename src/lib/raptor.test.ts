import { describe, expect, it } from 'vitest';
import { buildRaptorIndex, raptor, type RaptorHooks, type RaptorQuery, type RaptorTrip } from './raptor';

type Call = number | [arr: number, dep: number];
/** a trip: stop ids and the time at each (a pair = arrives, leaves later) */
const trip = (nodes: number[], times: Call[], estimated = false): RaptorTrip => ({
  nodes,
  arr: times.map((t) => (Array.isArray(t) ? t[0] : t)),
  dep: times.map((t) => (Array.isArray(t) ? t[1] : t)),
  estimated,
});
const run = (trips: RaptorTrip[], q: Partial<RaptorQuery> & { departAt: number }, foot: [number, number, number][] = []) =>
  raptor(buildRaptorIndex({ stopCount: 12, trips, footpaths: foot }), { from: new Map([[0, 0]]), to: new Map([[3, 0]]), ...q });
const route = (j: { legs: { trip: number }[] }) => j.legs.map((l) => l.trip);

describe('raptor: direct rides', () => {
  const trips = [trip([0, 3], [100, 110]), trip([0, 3], [160, 170]), trip([0, 3], [220, 230])];
  it('offers each departure inside the window, none before departAt', () => {
    const r = run(trips, { departAt: 120, window: 120 });
    expect(r.map((j) => j.depart)).toEqual([220, 160]);
    expect(r[0]).toMatchObject({ arrive: 230, finish: 230, transfers: 0 });
  });
  it('adds the walk from the last stop to the destination to the finish', () => {
    const r = run(trips, { departAt: 90, to: new Map([[3, 4]]) });
    expect(r[0]).toMatchObject({ arrive: 230, finish: 234 });
  });
  it('a start point away from the stop delays the first bus by the walk', () => {
    const r = run(trips, { departAt: 95, from: new Map([[0, 10]]), window: 100 });
    expect(r.map((j) => j.depart)).toEqual([160]); // the bus at 100 leaves before the traveller reaches the stop (95 + 10), the one at 220 is outside the window
    expect(r[0].legs[0].walkBefore).toBe(10);
  });
  it('does not ride backwards or to a stop the trip does not call at', () => {
    expect(run([trip([3, 0], [100, 110])], { departAt: 0 })).toEqual([]);
    expect(run([trip([0, 1], [100, 110])], { departAt: 0 })).toEqual([]);
  });
});

describe('raptor: transfers', () => {
  it('needs 5 minutes between two buses with printed times, 12 when either is an estimate', () => {
    const second = (t: number, est: boolean) => trip([1, 3], [t, t + 10], est);
    expect(run([trip([0, 1], [100, 110]), second(115, false)], { departAt: 90 })).toHaveLength(1);
    expect(run([trip([0, 1], [100, 110]), second(114, false)], { departAt: 90 })).toHaveLength(0);
    expect(run([trip([0, 1], [100, 110]), second(121, true)], { departAt: 90 })).toHaveLength(0);
    expect(run([trip([0, 1], [100, 110]), second(122, true)], { departAt: 90 })).toHaveLength(1);
    expect(run([trip([0, 1], [100, 110], true), second(121, false)], { departAt: 90 })).toHaveLength(0);
    expect(run([trip([0, 1], [100, 110], true), second(122, false)], { departAt: 90 })).toHaveLength(1);
  });
  it('keeps an early estimated arrival apart from a later printed one (the buffer depends on the pair of buses)', () => {
    // X (estimated) is at stop 1 at 95, Y (printed) at 100; the printed bus at 105 can be taken from Y only
    const trips = [trip([0, 1], [80, 95], true), trip([0, 1], [80, 100]), trip([1, 3], [105, 120])];
    const r = run(trips, { departAt: 80 });
    expect(r).toHaveLength(1);
    expect(route(r[0])).toEqual([1, 2]);
  });
  it('walks between stops: the walk and the buffer both count, and the walk is reported before the boarding', () => {
    const feeder = trip([0, 1], [100, 100]);
    const foot: [number, number, number][] = [[1, 2, 3]];
    expect(run([feeder, trip([2, 3], [108, 120])], { departAt: 90 }, foot)).toHaveLength(1);
    expect(run([feeder, trip([2, 3], [107, 120])], { departAt: 90 }, foot)).toHaveLength(0);
    const r = run([feeder, trip([2, 3], [108, 120])], { departAt: 90 }, foot);
    expect(r[0].legs.map((l) => l.walkBefore)).toEqual([0, 3]);
  });
  it('walking into the destination is no arrival; only a bus gets there', () => {
    expect(run([trip([0, 1], [100, 110])], { departAt: 90, to: new Map([[2, 0]]) }, [[1, 2, 2]])).toEqual([]);
  });
  it('a bus that stands at the stop (arrives 100, leaves 110) can be left at 100: the transfer counts from the arrival', () => {
    const first = trip([0, 1], [90, [100, 110]]);
    expect(run([first, trip([1, 3], [106, 116])], { departAt: 80 })).toHaveLength(1); // 105 is enough, 110 is not required
  });
  it('the cap on the wait counts from the moment that bus leaves: over it the transfer is dropped, at it kept', () => {
    const first = trip([0, 1], [90, [100, 110]]);
    expect(run([first, trip([1, 3], [146, 156])], { departAt: 80, maxWait: 30 })).toHaveLength(0); // 146 - 115 = 31
    expect(run([first, trip([1, 3], [145, 155])], { departAt: 80, maxWait: 30 })).toHaveLength(1); // 145 - 115 = 30
  });
  it('stops at two transfers by default and goes further when allowed', () => {
    const chain = [trip([0, 1], [100, 105]), trip([1, 2], [112, 117]), trip([2, 4], [124, 129]), trip([4, 3], [136, 141])];
    expect(run(chain, { departAt: 90 })).toEqual([]);
    expect(run(chain, { departAt: 90, maxTransfers: 3 })[0].transfers).toBe(3);
    expect(run(chain.slice(0, 3).map((t, i) => (i === 2 ? trip([2, 3], [124, 129]) : t)), { departAt: 90 })[0].transfers).toBe(2);
  });
  it('keeps a direct ride and a faster ride with a transfer, drops a transfer the direct ride beats', () => {
    const slowDirect = trip([0, 3], [100, 200]);
    const fast = [trip([0, 1], [100, 110]), trip([1, 3], [120, 150])];
    const r = run([slowDirect, ...fast], { departAt: 90 });
    expect(r.map((j) => [j.transfers, j.finish])).toEqual([[1, 150], [0, 200]]); // same departure: the earlier arrival first
    const worse = run([trip([0, 3], [100, 120]), ...fast], { departAt: 90 });
    expect(worse.map((j) => j.transfers)).toEqual([0]); // the direct ride (120) beats the transfer (150) on every count
  });
});

describe('raptor: times', () => {
  it('works across midnight and with negative minutes (trips of the day before)', () => {
    const r = run([trip([0, 1], [1430, 1440]), trip([1, 3], [1452, 1470])], { departAt: 1400 });
    expect(r[0]).toMatchObject({ depart: 1430, arrive: 1470 });
    const before = run([trip([0, 3], [-30, -10])], { departAt: -60 });
    expect(before[0]).toMatchObject({ depart: -30, arrive: -10 });
  });
  it('a trip that runs ahead of an earlier one is not behind it in the same pattern', () => {
    const local = trip([0, 1, 3], [0, 20, 60]);
    const express = trip([0, 1, 3], [10, 18, 40]);
    const next = trip([0, 1, 3], [60, 80, 120]);
    const ix = buildRaptorIndex({ stopCount: 12, trips: [local, express, next], footpaths: [] });
    expect(ix.patternCount).toBe(2); // local + next, express alone
    expect(buildRaptorIndex({ stopCount: 12, trips: [local, next], footpaths: [] }).patternCount).toBe(1);
    const r = raptor(ix, { from: new Map([[0, 0]]), to: new Map([[3, 0]]), departAt: 0, window: 30 });
    expect(r.map((j) => [j.depart, j.arrive])).toEqual([[10, 40]]); // leaving at 0 on the local is beaten by the express
  });
  it('estimated and printed trips of one stop sequence are separate patterns', () => {
    const ix = buildRaptorIndex({ stopCount: 12, trips: [trip([0, 3], [0, 10]), trip([0, 3], [20, 30], true)], footpaths: [] });
    expect(ix.patternCount).toBe(2);
  });
});

describe('raptor: hooks', () => {
  const trips = [trip([0, 3], [100, 110]), trip([0, 3], [105, 120])];
  it('board can refuse a trip, the next one is taken', () => {
    const hooks: RaptorHooks = { board: (t) => t !== 0 };
    expect(run(trips, { departAt: 90, hooks }).map((j) => route(j))).toEqual([[1]]);
  });
  it('leg can refuse a ride and is told whether it ends at the destination', () => {
    const seen: boolean[] = [];
    const hooks: RaptorHooks = { leg: (_t, _f, _to, _r, final) => (seen.push(final), false) };
    expect(run(trips, { departAt: 90, hooks })).toEqual([]);
    expect(seen.every(Boolean)).toBe(true);
  });
  it('board is told the bus the traveller arrives by', () => {
    const prevs: number[] = [];
    const hooks: RaptorHooks = { board: (_t, _s, round, prev) => (round > 1 && prevs.push(prev), true) };
    run([trip([0, 1], [100, 110]), trip([1, 3], [120, 130])], { departAt: 90, hooks });
    expect(prevs).toContain(0);
  });
});
