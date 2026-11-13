import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script
import { applyStopExpansions, offsets, orderFor } from '../scripts/lib-stop-expansion.mjs';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const rule = { line: 1, stop: 'Fazenda', forwardFrom: 'Funchal', anchor: 'B', speedKmh: 20, stops: [{ code: 'A', name: 'A', lat: 32.668, lon: -16.805 }, { code: 'B', name: 'B', lat: 32.667, lon: -16.808 }, { code: 'C', name: 'C', lat: 32.666, lon: -16.811 }] };
const line = () => ({ id: 1, directions: [
  { from: 'Funchal', to: 'Boq', stops: [{ name: 'Funchal' }, { name: 'Fazenda' }, { name: 'Boq' }], trips: [{ days: ['weekday'], times: ['18:00', '18:30', '19:00'] }, { days: ['weekday'], times: ['13:00', null, '14:00'] }] },
  { from: 'Boq', to: 'Funchal', stops: [{ name: 'Boq' }, { name: 'Fazenda' }, { name: 'Funchal' }], trips: [{ days: ['weekday'], times: ['06:00', '06:30', '07:00'] }] },
] });

describe('stop expansion', () => {
  it('replaces the printed stop by the run of stops, reversed against the direction', () => {
    const l = line();
    expect(applyStopExpansions(l, [rule])).toBe(2);
    expect(l.directions[0]!.stops.map((s: { name: string }) => s.name)).toEqual(['Funchal', 'A', 'B', 'C', 'Boq']);
    expect(l.directions[1]!.stops.map((s: { name: string }) => s.name)).toEqual(['Boq', 'C', 'B', 'A', 'Funchal']);
    for (const d of l.directions) for (const t of d.trips) expect(t.times.length).toBe(d.stops.length);
  });
  it('puts the printed time on the anchor, the neighbours around it in driving order, and gives a trip that does not call no times', () => {
    const l = line();
    applyStopExpansions(l, [rule]);
    const [a, b] = l.directions[0]!.trips;
    expect(a!.times[2]).toBe('18:30');
    const m = a!.times.map((t: string | null) => (t ? +t.slice(0, 2) * 60 + +t.slice(3) : null));
    expect(m).toEqual([...m].sort((x, y) => x! - y!));
    expect(m[1]).toBeLessThanOrEqual(m[2]!);
    expect(m[3]).toBeGreaterThanOrEqual(m[2]!);
    expect(b!.times).toEqual(['13:00', null, null, null, '14:00']);
  });
  it('never leaves the printed neighbours', () => {
    const l = line();
    l.directions[0]!.trips[0]!.times = ['18:29', '18:30', '18:31'];
    applyStopExpansions(l, [rule]);
    expect(l.directions[0]!.trips[0]!.times.every((t: string) => t >= '18:29' && t <= '18:31')).toBe(true);
  });
  it('offsets follow the distance', () => {
    const o = offsets(rule.stops, 'B', 20);
    expect(o[1]).toBe(0);
    expect(o[0]).toBeLessThan(0);
    expect(o[2]).toBeGreaterThan(0);
    expect(orderFor(rule, { from: 'Boq' })[0].code).toBe('C');
  });
});

describe('the real rule (line 501, "Fazenda")', () => {
  const schedules = read('schedules.json').lines as { id: number; directions: { from: string; stops: { code: string | null; name: string; lat?: number }[]; trips: { times: (string | null)[] }[] }[] }[];
  const l = schedules.find((x) => x.id === 4004)!;
  it('has the seven SIGA stops in the order SIGA gave, towards Boqueirão, and the reverse on the way back', () => {
    const codes = (d: (typeof l.directions)[number]) => d.stops.filter((s) => s.code).map((s) => s.code);
    expect(codes(l.directions.find((d) => d.from === 'Funchal')!)).toEqual(['68337', '68339', '68341', '68342', '68344', '68343', '68345']);
    expect(codes(l.directions.find((d) => d.from !== 'Funchal')!)).toEqual(['68345', '68343', '68344', '68342', '68341', '68339', '68337']);
  });
  it('every trip has a time at every stop, or at none of the seven', () => {
    for (const d of l.directions) for (const t of d.trips) {
      expect(t.times.length).toBe(d.stops.length);
      const mid = t.times.filter((_, i) => d.stops[i]!.code);
      expect(mid.every(Boolean) || mid.every((x) => x === null)).toBe(true);
    }
  });
});
