import { describe, expect, it } from 'vitest';
import { hasGps, isApproxPosition } from '../src/lib/precision';
import type { Stop } from '../src/types';

const stop = (o: Partial<Stop>): Stop => ({ name: 'X', code: null, ...o }) as Stop;

describe('position warnings', () => {
  it('warns for anything but an official position', () => {
    for (const locationPrecision of ['settlement_center', 'name_match', 'manual_osm_match', 'corridor_osm_match', 'interpolated_road_point', 'interpolated'] as const) expect(isApproxPosition(stop({ lat: 1, lon: 2, locationPrecision }))).toBe(true);
    expect(isApproxPosition(stop({ lat: 1, lon: 2, approx: true, locationPrecision: 'exact' }))).toBe(true); // OSM stop matched by name
    expect(isApproxPosition(stop({ lat: 1, lon: 2, isEstimatedLocation: true }))).toBe(true);
    expect(isApproxPosition(stop({ lat: 1, lon: 2, locationPrecision: 'exact' }))).toBe(false);
  });
  it('a stop without coordinates has no position to warn about; it is "no GPS"', () => {
    const s = stop({ locationPrecision: undefined });
    expect(isApproxPosition(s)).toBe(false);
    expect(hasGps(s)).toBe(false);
    expect(hasGps(stop({ lat: 1, lon: 2 }))).toBe(true);
  });
});
