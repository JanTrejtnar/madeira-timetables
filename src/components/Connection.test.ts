import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../lib/router';
import { daysAfter } from './Connection';

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
