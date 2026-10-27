import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script
import { inheritSameSpot } from '../scripts/lib-coords.mjs';
import type { Dataset } from '../src/types';

const line = (stops: object[]) => ({ number: 'x', directions: [{ stops }] });

describe('inheritSameSpot: an estimated stop next to an official namesake takes its position', () => {
  const official = { name: 'Poiso', code: '1', lat: 32.7122, lon: -16.8881, locationPrecision: 'exact' };
  it('within 250 m: the estimate becomes the official position', () => {
    const est = { name: 'Poiso', code: null, lat: 32.7127, lon: -16.8878, approx: true, locationPrecision: 'name_match' };
    const lines = [line([official]), line([est])];
    expect(inheritSameSpot(lines)).toBe(1);
    expect(est).toMatchObject({ lat: 32.7122, lon: -16.8881, locationPrecision: 'exact' });
    expect(est).not.toHaveProperty('approx');
  });
  it('farther away, or a hand-placed override: left alone', () => {
    const far = { name: 'Poiso', code: null, lat: 32.73, lon: -16.88, approx: true, locationPrecision: 'name_match' };
    const hand = { name: 'Poiso', code: null, lat: 32.7125, lon: -16.888, approx: true, source: 'override', locationPrecision: 'name_match' };
    expect(inheritSameSpot([line([official]), line([far, hand])])).toBe(0);
    expect(far.locationPrecision).toBe('name_match');
    expect(hand.locationPrecision).toBe('name_match');
  });
});

describe.skipIf(!existsSync('public/data/schedules.json'))('Poiso saddle (run `npm run build:data` first)', () => {
  const data: Dataset = JSON.parse(readFileSync('public/data/schedules.json', 'utf8'));
  it('lines 56, 103, 138 and the Areeiro shuttle share one position and precision', () => {
    const seen = new Set<string>();
    for (const l of data.lines.filter((l) => ['56', '103', '138', 'HF Areeiro'].includes(l.number)))
      for (const d of l.directions) for (const s of d.stops.filter((s) => s.name === 'Poiso')) seen.add(`${s.lat},${s.lon},${s.locationPrecision}`);
    expect([...seen]).toEqual(['32.712225,-16.8880585,manual_osm_match']);
  });
});
