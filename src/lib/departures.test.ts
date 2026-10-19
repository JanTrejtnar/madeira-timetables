import { describe, expect, it } from 'vitest';
import { nextDepartures, withMinutes } from './departures';
import { findConnections, norm, stopKey } from './search';
import type { Direction, Line } from '../types';

const dir = (departures: Direction['departures'], stops: string[] = []): Direction => ({
  variant: null,
  from: 'A',
  to: 'B',
  shapeId: null,
  stopSource: 'pdf',
  stops: stops.map((name) => ({ code: null, name })),
  departures,
});
const ctx = (y: number, m: number, d: number, hh: number, mm: number) => ({
  now: { y, m, d, minutes: hh * 60 + mm },
  school: true,
  municipalities: ['Funchal'] as const,
});

describe('withMinutes', () => {
  it('rolls over after midnight', () => {
    expect(withMinutes([{ t: '23:30' }, { t: '00:10' }]).map((x) => x.minutes)).toEqual([1410, 1450]);
  });
});

describe('nextDepartures', () => {
  const d = dir({ weekday: [{ t: '07:00' }, { t: '23:50' }, { t: '00:20' }], sunday: [{ t: '09:00' }] });
  it('picks the next trip today', () => {
    // Monday 2026-10-19 06:30
    expect(nextDepartures(d, ctx(2026, 10, 19, 6, 30), 2).map((x) => [x.t, x.inMin])).toEqual([
      ['07:00', 30],
      ['23:50', 1040],
    ]);
  });
  it("includes yesterday's after-midnight trip", () => {
    // Tuesday 00:10: the Monday service has a 00:20 trip in 10 minutes
    expect(nextDepartures(d, ctx(2026, 10, 20, 0, 10), 1)[0]).toMatchObject({ t: '00:20', inMin: 10 });
  });
  it('falls over to tomorrow and uses its day type', () => {
    // Saturday 23:00, no Saturday list; tomorrow is Sunday 09:00
    expect(nextDepartures(d, ctx(2026, 10, 17, 23, 0), 1)[0]).toMatchObject({ t: '09:00', dayOffset: 1, inMin: 600 });
  });
  it('selects the school variant only when there is no plain weekday list', () => {
    const s = dir({ weekday_school: [{ t: '08:00' }], weekday_holiday: [{ t: '10:00' }] });
    expect(nextDepartures(s, { ...ctx(2026, 10, 19, 7, 0), school: true }, 1)[0].t).toBe('08:00');
    expect(nextDepartures(s, { ...ctx(2026, 10, 19, 7, 0), school: false }, 1)[0].t).toBe('10:00');
  });
});

describe('search', () => {
  it('normalises names', () => {
    expect(norm('Câmara de Lobos')).toBe('camara de lobos');
    expect(stopKey('Igreja Boa Nova, D')).toBe('igreja boa nova');
    expect(stopKey('CAM Azinhaga, S2A')).toBe('cam azinhaga');
  });
  it('finds connections in stop order only', () => {
    const line = {
      id: 1,
      number: '1',
      directions: [dir({}, ['Pinga', 'Campo da Barca, S', 'Mercedes, D']), dir({}, ['Mercedes, D', 'Pinga'])],
    } as unknown as Line;
    const r = findConnections([line], 'pinga', 'mercedes');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ dirIndex: 0, between: 1 });
    expect(findConnections([line], 'mercedes', 'pinga')[0].dirIndex).toBe(1);
  });
});

describe('per-stop times (trips)', () => {
  const d: Direction = {
    ...dir({ weekday: [{ t: '08:00' }] }, ['A', 'B', 'C']),
    trips: [
      { days: ['weekday'], times: ['08:00', '08:20', '08:40'] },
      { days: ['weekday'], times: [null, '09:10', '09:30'] },
      { days: ['sunday'], times: ['10:00', '10:20', '10:40'] },
    ],
  };
  it('returns the real time at the chosen stop, including trips that start mid-route', async () => {
    const { nextAtStop } = await import('./departures');
    // Monday 2026-10-19 08:10
    expect(nextAtStop(d, 1, ctx(2026, 10, 19, 8, 10), 2).map((x) => [x.t, x.inMin])).toEqual([
      ['08:20', 10],
      ['09:10', 60],
    ]);
    // nothing else leaves stop 0 today; tomorrow (Tuesday, weekday timetable) the 08:00 trip runs again
    expect(nextAtStop(d, 0, ctx(2026, 10, 19, 8, 10), 1)[0]).toMatchObject({ t: '08:00', dayOffset: 1 });
    // on Saturday evening the next trip is Sunday's
    expect(nextAtStop(d, 0, ctx(2026, 10, 17, 22, 0), 1)[0]).toMatchObject({ t: '10:00', dayOffset: 1 });
  });
});
