import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../lib/router';
import { daysAfter, totalWalk, transferWalk } from './Connection';

const at = (depart: number) => ({ depart }) as Itinerary;

describe('daysAfter ("+N" marker of a time)', () => {
  it('a trip of the same day has no marker', () => {
    expect(daysAfter(7 * 60 + 15, at(7 * 60 + 15))).toBe(0);
    expect(daysAfter(8 * 60 + 50, at(7 * 60 + 15))).toBe(0);
  });
  it("tomorrow's morning trip (minutes above 1440 from the searched day) has no marker", () => {
    const dep = 1440 + 7 * 60 + 15;
    expect(daysAfter(dep, at(dep))).toBe(0);
    expect(daysAfter(dep + 95, at(dep))).toBe(0);
  });
  it('crossing midnight after the first departure is +1, the next midnight +2', () => {
    expect(daysAfter(1440 + 40, at(23 * 60 + 30))).toBe(1);
    expect(daysAfter(2 * 1440 + 10, at(23 * 60 + 30))).toBe(2);
    expect(daysAfter(2 * 1440 + 40, at(1440 + 23 * 60 + 30))).toBe(1);
  });
});

describe('walking of a connection', () => {
  const leg = (walkBefore?: number) => ({ walkBefore }) as Itinerary['legs'][number];
  const itin = (walks: (number | undefined)[], walk = 0) => ({ legs: walks.map(leg), walk }) as Itinerary;
  it('a transfer on foot is the walkBefore of the next bus', () => {
    expect(transferWalk(itin([0, 3, 2]), 1)).toBe(3);
    expect(transferWalk(itin([0, 3, 2]), 2)).toBe(2);
    expect(transferWalk(itin([0, 0]), 1)).toBe(0);
  });
  it('an itinerary without walkBefore (the older planner) has its single transfer walk in `walk`', () => {
    expect(transferWalk(itin([undefined, undefined], 4), 1)).toBe(4);
    expect(transferWalk(itin([undefined, undefined, undefined], 4), 1)).toBe(0);
  });
  it('the total adds the walk to the first stop, every transfer and the walk to the destination, but not the walk of the first leg itself', () => {
    expect(totalWalk(itin([7, 3, 2]), { min: 5 }, { min: 4 })).toBe(5 + 3 + 2 + 4);
    expect(totalWalk(itin([0, 0]), null, undefined)).toBe(0);
    expect(totalWalk(itin([0]), { min: 2 }, null)).toBe(2);
  });
});
