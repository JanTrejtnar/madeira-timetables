import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script
import { applyOverrides } from '../scripts/lib-overrides.mjs';

const stop = (name: string, extra: object = {}) => ({ name, code: null, ...extra });
const file = {
  overrides: [
    { name: 'Rib. Machico', lines: ['20'], adjacent: ['Portela'], lat: 1, lon: 2, locationPrecision: 'name_match' },
    { name: 'Rib. Machico', lines: ['20'], adjacent: ['P. Empresarial', 'Fajã Rolos'], lat: 3, lon: 4, locationPrecision: 'interpolated_road_point' },
  ],
};

describe('overrides with `adjacent`: one stop name can be two places on one line', () => {
  it('each variant takes the position that belongs to its neighbours', () => {
    const lines = [
      { number: '20', directions: [{ stops: [stop('Portela', { lat: 9, lon: 9 }), stop('Rib. Machico'), stop('Lombo Faias', { lat: 9, lon: 9 })] }, { stops: [stop('P.Empresarial', { lat: 9, lon: 9 }), stop('Rib. Machico'), stop('Fajã Rolos', { lat: 9, lon: 9 })] }] },
    ];
    expect(applyOverrides(lines, file)).toBe(2);
    expect(lines[0]!.directions[0]!.stops[1]).toMatchObject({ lat: 1, lon: 2, locationPrecision: 'name_match' });
    expect(lines[0]!.directions[1]!.stops[1]).toMatchObject({ lat: 3, lon: 4, locationPrecision: 'interpolated_road_point' });
  });
  it('a stop with other neighbours is left alone', () => {
    const lines = [{ number: '20', directions: [{ stops: [stop('Machico', { lat: 9, lon: 9 }), stop('Rib. Machico'), stop('Funchal', { lat: 9, lon: 9 })] }] }];
    expect(applyOverrides(lines, file)).toBe(0);
    expect((lines[0]!.directions[0]!.stops[1] as { lat?: number }).lat).toBeUndefined();
  });
});
