import { describe, expect, it } from 'vitest';
import { withTransfer, plan } from '../src/lib/router';
import type { Network, Trip } from '../src/lib/network';

// nodes on a line of longitude, 0.01° ≈ 1.1 km apart unless stated
const node = (id: number, lon: number) => ({ id, key: `n${id}`, name: `N${id}`, lat: 32.65, lon });
const lons = [-16.9, -16.89, -16.88, -16.87, -16.8695, -16.86, -16.85]; // 0..6; nodes 3 and 4 are ~55 m apart
const net = {
  nodes: lons.map((l, i) => node(i, l)),
  near: new Map(lons.map((_, i) => [i, [{ node: i, walk: 0 }]])),
  viaOnly: new Set<number>(),
} as unknown as Network;

const trip = (lineId: number, dirIndex: number, nodes: number[], times: number[]): Trip =>
  ({ line: { id: lineId }, dirIndex, dir: {}, nodes, times, estimated: false }) as unknown as Trip;

describe('transfer rules', () => {
  it('never changes onto the same line in the opposite direction (U-turn)', () => {
    const out = trip(601, 0, [0, 1, 2], [480, 490, 500]);
    const back = trip(601, 1, [2, 1], [520, 521]); // waits 20 min, rides one stop back
    expect(withTransfer(net, [out, back], new Set([0]), new Set([1]), 470)).toEqual([]);
  });

  it('does not offer a one-stop last leg when the destination is walkable (< 800 m)', () => {
    const first = trip(1, 0, [0, 1, 2], [480, 490, 500]);
    const hop = trip(2, 0, [2, 3], [510, 511]); // 1 minute, 1.1 km: too far to walk
    const near = trip(3, 0, [3, 4], [510, 511]); // not used from node 2
    expect(withTransfer(net, [first, hop], new Set([0]), new Set([3]), 470)).toHaveLength(1);
    const first2 = trip(1, 0, [0, 1, 3], [480, 490, 500]);
    const walkable = trip(2, 0, [3, 4], [510, 511]); // 55 m
    expect(withTransfer(net, [first2, walkable, near], new Set([0]), new Set([4]), 470)).toEqual([]);
  });

  it('limits the wait at a transfer to 30 minutes, longer only when nothing else exists', () => {
    const first = trip(1, 0, [0, 1, 2], [480, 490, 500]);
    const late = trip(2, 0, [2, 5, 6], [549, 560, 570]); // 49 min wait
    expect(withTransfer(net, [first, late], new Set([0]), new Set([6]), 470)).toEqual([]);
    expect(plan(net, [first, late], new Set([0]), new Set([6]), 470).transfers).toHaveLength(1);
    const soon = trip(3, 0, [2, 5, 6], [520, 530, 540]);
    expect(plan(net, [first, late, soon], new Set([0]), new Set([6]), 470).transfers[0].legs[1].trip).toBe(soon);
  });
});
