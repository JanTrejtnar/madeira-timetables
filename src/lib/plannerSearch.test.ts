import { describe, expect, it } from 'vitest';
import { buildNetwork, servicesFor } from './network';
import { runSearch } from './plannerSearch';
import type { Picked } from './plannerForm';
import type { Direction, Line } from '../types';

const mk = (id: number, number: string, stops: [string, number, number][], deps: string[], offsets: number[]): Line => {
  const dir: Direction = {
    variant: null, from: stops[0][0], to: stops.at(-1)![0], shapeId: 1, stopSource: 'shapedata',
    stops: stops.map(([name, lat, lon]) => ({ code: null, name, lat, lon })),
    departures: { weekday: deps.map((t) => ({ t })) }, isEstimated: true, stopOffsets: offsets,
  };
  return { id, number, newNumber: number, oldNumber: number, name: number, route: '', municipality: 'Funchal', type: 'urbano', pdfUrl: '', jpgUrl: null, family: 'x', hasParsedSchedule: true, notes: {}, directions: [dir] };
};
// Alpha - Bravo - Charlie on line 1, Charlie - Delta - Echo on line 2; Charlie is the transfer
const l1 = mk(1, '1', [['Alpha', 32.65, -16.9], ['Bravo', 32.66, -16.9], ['Charlie', 32.67, -16.9]], ['08:00', '09:00'], [0, 10, 20]);
const l2 = mk(2, '2', [['Charlie', 32.67, -16.9], ['Delta', 32.68, -16.9], ['Echo', 32.69, -16.9]], ['08:35', '09:35'], [0, 10, 20]);
const net = buildNetwork([l1, l2]);
const trips = servicesFor(net, [l1, l2], { y: 2026, m: 10, d: 19 }, true, ['Funchal']);
const pick = (text: string): Picked => ({ text, key: null });

describe('runSearch', () => {
  it('is null while a field is empty', () => {
    expect(runSearch(net, trips, pick(''), pick('echo'), 7 * 60, false)).toBeNull();
    expect(runSearch(net, trips, pick('alpha'), pick('  '), 7 * 60, false)).toBeNull();
  });
  it('finds a direct connection and a connection with a transfer', () => {
    const direct = runSearch(net, trips, pick('alpha'), pick('bravo'), 7 * 60, false)!;
    expect(direct.A).toBe(1);
    expect(direct.B).toBe(1);
    expect(direct.plan.direct[0].depart).toBe(8 * 60);
    const transfer = runSearch(net, trips, pick('alpha'), pick('echo'), 7 * 60, false)!;
    expect(transfer.plan.direct).toHaveLength(0);
    expect(transfer.plan.transfers[0].legs.map((l) => l.trip.line.number)).toEqual(['1', '2']);
  });
  it('"direct only" drops the transfers', () => {
    expect(runSearch(net, trips, pick('alpha'), pick('echo'), 7 * 60, true)!.plan.transfers).toHaveLength(0);
  });
  it('a name without stops gives zero stops, not a crash', () => {
    const r = runSearch(net, trips, pick('nowhere'), pick('echo'), 7 * 60, false)!;
    expect(r.A).toBe(0);
    expect(r.plan.direct).toHaveLength(0);
  });
  it('a picked stop also stands for nothing else, and says where it is', () => {
    const r = runSearch(net, trips, { text: 'Alpha', key: 'alpha' }, pick('bravo'), 7 * 60, false)!;
    expect(r.ext.from?.pt.lat).toBeCloseTo(32.65, 5);
    expect(r.ext.from?.base.size).toBe(1);
  });
});
