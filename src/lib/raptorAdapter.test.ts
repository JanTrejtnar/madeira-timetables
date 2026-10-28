import { describe, expect, it } from 'vitest';
import { buildNetwork, resolveNodes, servicesFor } from './network';
import { plan } from './router';
import { compactTrip, planRaptor, raptorJourneys } from './raptorAdapter';
import type { Direction, Line } from '../types';

/** a line whose timetable prints the time at every stop (null = the bus does not call there on that run) */
const printed = (id: number, number: string, stops: [string, number, number][], runs: (string | null)[][]): Line => {
  const dir: Direction = {
    variant: null, from: stops[0][0], to: stops.at(-1)![0], shapeId: 1, stopSource: 'shapedata',
    stops: stops.map(([name, lat, lon]) => ({ code: null, name, lat, lon })),
    departures: {}, isEstimated: false, trips: runs.map((times) => ({ days: ['weekday' as const], times })),
  };
  return { id, number, newNumber: number, oldNumber: number, name: number, route: '', municipality: 'Funchal', type: 'urbano', pdfUrl: '', jpgUrl: null, family: 'x', hasParsedSchedule: true, notes: {}, directions: [dir] };
};

const monday = { y: 2026, m: 10, d: 19 };
const setup = (lines: Line[]) => {
  const net = buildNetwork(lines);
  const trips = servicesFor(net, lines, monday, true, ['Funchal']);
  return { net, trips, nodes: (q: string) => resolveNodes(net, q) };
};
const t = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

describe('compactTrip', () => {
  it('turns a wait (an arrival row and a departure row of one stop) into one call: off with the first time, on with the last', () => {
    const { trips } = setup([printed(1, '1', [['Alpha', 32.65, -16.9], ['Bravo', 32.66, -16.9], ['Bravo', 32.66, -16.9], ['Charlie', 32.67, -16.9]], [['08:00', '08:10', '08:14', '08:30']])]);
    const ct = compactTrip(trips.find((x) => x.times[0] === t('08:00'))!);
    expect(ct.nodes).toHaveLength(3);
    expect([ct.arr, ct.dep]).toEqual([[t('08:00'), t('08:10'), t('08:30')], [t('08:00'), t('08:14'), t('08:30')]]);
    expect([ct.arrRow, ct.depRow]).toEqual([[0, 1, 3], [0, 2, 3]]);
  });
  it('leaves out calls without a time, keeping the rows of the others', () => {
    const { trips } = setup([printed(1, '1', [['Alpha', 32.65, -16.9], ['Bravo', 32.66, -16.9], ['Charlie', 32.67, -16.9]], [['08:00', null, '08:20']])]);
    const ct = compactTrip(trips.find((x) => x.times[0] === t('08:00'))!);
    expect(ct.nodes).toHaveLength(2);
    expect(ct.arr).toEqual([t('08:00'), t('08:20')]);
    expect(ct.arrRow).toEqual([0, 2]);
  });
});

describe('planRaptor on small networks', () => {
  const l1 = printed(1, '1', [['Alpha', 32.65, -16.9], ['Bravo', 32.66, -16.9], ['Charlie', 32.67, -16.9]], [['08:00', '08:10', '08:20'], ['09:00', '09:10', '09:20']]);
  // Delta stands 122 m from Charlie: a transfer on foot (2 minutes)
  const l2 = printed(2, '2', [['Delta', 32.6711, -16.9], ['Echo', 32.68, -16.9]], [['08:30', '08:50'], ['09:30', '09:50']]);
  const { net, trips, nodes } = setup([l1, l2]);

  it('finds the same connection as plan(), and says where the walk is', () => {
    const mine = planRaptor(net, trips, nodes('alpha'), nodes('echo'), 7 * 60 + 50);
    const old = plan(net, trips, nodes('alpha'), nodes('echo'), 7 * 60 + 50);
    expect(mine.direct).toEqual([]);
    expect(mine.transfers[0]).toMatchObject({ depart: old.transfers[0].depart, finish: old.transfers[0].finish, walk: 2 });
    expect(mine.transfers[0].legs.map((l) => [l.trip.line.number, l.walkBefore])).toEqual([['1', 0], ['2', 2]]);
  });
  it('the walk and the 5 minute buffer both have to fit: 08:20 + 2 + 5 = 08:27', () => {
    const tight = printed(3, '3', [['Delta', 32.6711, -16.9], ['Echo', 32.68, -16.9]], [['08:26', '08:46']]);
    const s = setup([l1, tight]);
    expect(raptorJourneys(s.net, s.trips, s.nodes('alpha'), s.nodes('echo'), 7 * 60 + 50, undefined, undefined, { window: 60 })).toEqual([]);
  });
  it('crosses midnight: a bus at 23:40 -> 00:10 connects with one leaving after midnight', () => {
    const late = printed(4, '4', [['Alpha', 32.65, -16.9], ['Bravo', 32.66, -16.9]], [['23:40', '00:10']]);
    const after = printed(5, '5', [['Bravo', 32.66, -16.9], ['Charlie', 32.67, -16.9]], [['00:20', '00:40']]);
    const s = setup([late, after]);
    const r = planRaptor(s.net, s.trips, s.nodes('alpha'), s.nodes('charlie'), 23 * 60 + 30);
    expect(r.transfers[0]).toMatchObject({ depart: t('23:40'), arrive: 24 * 60 + 40 });
  });
  it('rides at most three buses: two transfers are found, three are not', () => {
    const chain = [
      printed(11, '11', [['P1', 32.60, -16.9], ['P2', 32.61, -16.9]], [['08:00', '08:10']]),
      printed(12, '12', [['P2', 32.61, -16.9], ['P3', 32.62, -16.9]], [['08:20', '08:30']]),
      printed(13, '13', [['P3', 32.62, -16.9], ['P4', 32.63, -16.9]], [['08:40', '08:50']]),
      printed(14, '14', [['P4', 32.63, -16.9], ['P5', 32.64, -16.9]], [['09:00', '09:10']]),
    ];
    const s = setup(chain);
    const three = planRaptor(s.net, s.trips, s.nodes('p1'), s.nodes('p4'), 7 * 60 + 50);
    expect(three.transfers[0].legs.map((l) => l.trip.line.number)).toEqual(['11', '12', '13']);
    expect(planRaptor(s.net, s.trips, s.nodes('p1'), s.nodes('p5'), 7 * 60 + 50)).toEqual({ direct: [], transfers: [] });
  });
  it('nothing for the next hours: shows the first connection that runs, not an empty list', () => {
    const r = planRaptor(net, trips, nodes('alpha'), nodes('bravo'), 22 * 60);
    expect(r.direct[0]?.depart).toBeGreaterThan(22 * 60); // tomorrow's first bus (the 48 hours of services)
  });
});
