import { describe, expect, it } from 'vitest';
import { spliceDetours } from '../src/lib/via';
import { rideSplit } from '../src/lib/ride';
import { localStopName } from '../src/lib/text';

const shape: [number, number][] = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]];

describe('spliceDetours', () => {
  it('replaces the stretch between the anchors by the road through the place', () => {
    const out = spliceDetours(shape, [{ a: [0, 1], b: [0, 3], pts: [[0, 1], [1, 1.5], [0, 3]] }]);
    expect(out).toEqual([[0, 0], [0, 1], [1, 1.5], [0, 3], [0, 4]]);
  });
  it('joins neighbouring detours that share an anchor point', () => {
    const out = spliceDetours(shape, [
      { a: [0, 2], b: [0, 4], pts: [[0, 2], [2, 3], [0, 4]] },
      { a: [0, 0], b: [0, 2], pts: [[0, 0], [1, 1], [0, 2]] },
    ]);
    expect(out).toEqual([[0, 0], [1, 1], [0, 2], [2, 3], [0, 4]]);
  });
  it('ignores a detour whose anchors are not on the shape', () => {
    expect(spliceDetours(shape, [{ a: [5, 5], b: [0, 3], pts: [[9, 9]] }])).toEqual(shape);
  });
  it('returns the shape itself without detours', () => {
    expect(spliceDetours(shape, [])).toBe(shape);
  });
});

describe('localStopName', () => {
  it('translates the airport only', () => {
    expect(localStopName('Aeroporto', 'cs')).toBe('Letiště');
    expect(localStopName('Aeroporto', 'en')).toBe('Airport');
    expect(localStopName('Aeroporto', 'pt')).toBe('Aeroporto');
    expect(localStopName('Poiso', 'cs')).toBe('Poiso');
  });
});

describe('rideSplit', () => {
  const shape: [number, number][] = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]];
  const stops: ([number, number] | null)[] = [[0, 0], null, [0, 2], [0, 4], [0, 5]];
  it('cuts the polyline at the boarding and alighting stop', () => {
    const r = rideSplit(shape, stops, 2, 3)!;
    expect(r.ride).toEqual([[0, 2], [0, 3], [0, 4]]);
    expect(r.before.at(-1)).toEqual([0, 2]);
    expect(r.after[0]).toEqual([0, 4]);
  });
  it('gives null when a stop has no position or the stretch is empty', () => {
    expect(rideSplit(shape, stops, 1, 3)).toBeNull();
    expect(rideSplit(shape, stops, 3, 2)).toBeNull();
  });
  it('follows the order of the stops on a line that passes a place twice', () => {
    const loop: [number, number][] = [[0, 0], [0, 1], [0, 2], [0, 1.001], [0, 5]];
    const r = rideSplit(loop, [[0, 0], [0, 1], [0, 5]], 1, 2)!;
    expect(r.ride[0]).toEqual([0, 1]);
    expect(r.ride.at(-1)).toEqual([0, 5]);
  });
});
