import { describe, expect, it } from 'vitest';
import { cutSpurs, trimToServed } from './spur';

// a straight road going east, one stop every 0.01 degrees
const road: [number, number][] = Array.from({ length: 51 }, (_, i) => [32.7, -17 + i * 0.002]);
const stopAt = (k: number, calls: boolean) => ({ at: [32.7, -17 + k * 0.01] as [number, number], calls });

describe('trimToServed', () => {
  it('a short-turn trip starts at its first called stop and ends at its last', () => {
    const stops = [stopAt(0, false), stopAt(1, false), stopAt(2, true), stopAt(3, true), stopAt(4, false)];
    const r = trimToServed(road, stops);
    expect(r.shape[0]).toEqual(road[10]);
    expect(r.shape.at(-1)).toEqual(road[15]);
    expect(r.stops).toHaveLength(2);
  });
  it('a trip calling at every stop keeps the whole road', () => {
    const stops = [stopAt(0, true), stopAt(2, true), stopAt(4, true)];
    expect(trimToServed(road, stops).shape).toBe(road);
  });
  it('cutSpurs trims the unserved ends', () => {
    const stops = [stopAt(0, false), stopAt(1, true), stopAt(2, true), stopAt(3, false)];
    const out = cutSpurs(road, stops);
    expect(out[0]).toEqual(road[5]);
    expect(out.at(-1)).toEqual(road[10]);
  });
});
