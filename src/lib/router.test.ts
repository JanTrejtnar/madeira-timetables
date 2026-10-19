import { describe, expect, it } from 'vitest';
import { buildNetwork, resolveNodes, servicesFor } from './network';
import { MIN_TRANSFER_ESTIMATED, mergePlans, plan } from './router';
import type { Direction, Line } from '../types';

const mk = (id: number, number: string, stops: [string, number, number][], deps: string[], offsets: number[]): Line => {
  const dir: Direction = {
    variant: null, from: stops[0][0], to: stops.at(-1)![0], shapeId: 1, stopSource: 'shapedata',
    stops: stops.map(([name, lat, lon]) => ({ code: null, name, lat, lon })),
    departures: { weekday: deps.map((t) => ({ t })) }, isEstimated: true, stopOffsets: offsets,
  };
  return { id, number, newNumber: number, oldNumber: number, name: number, route: '', municipality: 'Funchal', type: 'urbano', pdfUrl: '', jpgUrl: null, family: 'x', hasParsedSchedule: true, notes: {}, directions: [dir] };
};

// A - B - C on line 1 (hourly), C - D - E on line 2; C is the transfer node
const l1 = mk(1, '1', [['Alpha', 32.65, -16.9], ['Bravo', 32.66, -16.9], ['Charlie', 32.67, -16.9]], ['08:00', '09:00', '10:00'], [0, 10, 20]);
const l2 = mk(2, '2', [['Charlie', 32.67, -16.9], ['Delta', 32.68, -16.9], ['Echo', 32.69, -16.9]], ['08:25', '08:35', '09:50'], [0, 10, 20]);
const net = buildNetwork([l1, l2]);
const monday = { y: 2026, m: 10, d: 19 };
const trips = servicesFor(net, [l1, l2], monday, true, ['Funchal']);
const nodes = (q: string) => resolveNodes(net, q);

describe('router', () => {
  it('finds direct trips in time order and flags estimated times', () => {
    const r = plan(net, trips, nodes('alpha'), nodes('bravo'), 8 * 60 + 30);
    expect(r.direct[0]).toMatchObject({ depart: 9 * 60, arrive: 9 * 60 + 10 });
    expect(r.direct[0].legs[0]).toMatchObject({ departEstimated: false, arriveEstimated: true });
  });
  it('does not go backwards along the route', () => {
    expect(plan(net, trips, nodes('bravo'), nodes('alpha'), 0).direct).toHaveLength(0);
  });
  it('needs 12 minutes to transfer when the times are estimated', () => {
    // Alpha 08:00 -> Charlie ~08:20; line 2 leaves Charlie 08:25 (only 5 min, too tight for estimates) and 08:35 (15 min)
    const r = plan(net, trips, nodes('alpha'), nodes('echo'), 7 * 60 + 50);
    expect(r.direct).toHaveLength(0);
    expect(r.transfers[0].legs.map((l) => l.trip.line.number)).toEqual(['1', '2']);
    expect(r.transfers[0].legs[1].depart).toBe(8 * 60 + 35);
    expect(r.transfers[0].arrive).toBe(8 * 60 + 55);
    expect(r.transfers.every((x) => x.legs[1].depart - x.legs[0].arrive >= MIN_TRANSFER_ESTIMATED)).toBe(true);
  });
  it('keeps the 5 minute minimum when both buses have printed times', () => {
    const printed = (l: Line): Line => ({ ...l, directions: l.directions.map((d) => ({ ...d, isEstimated: false, stopOffsets: undefined, trips: d.departures.weekday!.map((dep) => { const [h, m] = dep.t.split(':').map(Number); const base = h * 60 + m; return { days: ['weekday' as const], times: d.stopOffsets!.map((o) => { const x = base + o; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; }) }; }) })) });
    const p1 = printed(l1);
    const p2 = printed(l2);
    const n2 = buildNetwork([p1, p2]);
    const t2 = servicesFor(n2, [p1, p2], monday, true, ['Funchal']);
    const r = plan(n2, t2, resolveNodes(n2, 'alpha'), resolveNodes(n2, 'echo'), 7 * 60 + 50);
    expect(r.transfers[0]).toMatchObject({ depart: 8 * 60, arrive: 8 * 60 + 45 }); // 08:20 -> 08:25 is enough
  });
  it('rejects a transfer with less than 5 minutes', () => {
    const tight = mk(3, '3', [['Charlie', 32.67, -16.9], ['Foxtrot', 32.68, -16.9]], ['08:24'], [0, 10]); // 4 minutes after line 1
    const n2 = buildNetwork([l1, tight]);
    const t2 = servicesFor(n2, [l1, tight], monday, true, ['Funchal']);
    const r = plan(n2, t2, resolveNodes(n2, 'alpha'), resolveNodes(n2, 'foxtrot'), 7 * 60 + 50);
    expect(r.transfers.every((x) => x.legs[1].depart >= x.legs[0].arrive + MIN_TRANSFER_ESTIMATED)).toBe(true);
    expect(r.transfers.find((x) => x.depart === 8 * 60)).toBeUndefined();
  });
  it('uses the Sunday timetable (no weekday trips on Sunday)', () => {
    const sunday = servicesFor(net, [l1, l2], { y: 2026, m: 10, d: 18 }, true, ['Funchal']);
    // only weekday lists exist, so nothing runs on Sunday itself; the first trip is Monday morning (shifted by one day)
    const r = plan(net, sunday, nodes('alpha'), nodes('bravo'), 6 * 60);
    expect(r.direct[0].depart).toBeGreaterThanOrEqual(24 * 60);
  });
});

describe('mergePlans', () => {
  it('puts the preferred results first and drops duplicates', () => {
    const a = plan(net, trips, nodes('alpha'), nodes('bravo'), 0);
    const b = plan(net, trips, nodes('alpha'), nodes('bravo'), 0);
    const merged = mergePlans({ direct: a.direct.slice(0, 1), transfers: [] }, b);
    expect(merged.direct[0]).toBe(a.direct[0]);
    expect(merged.direct.length).toBe(b.direct.length);
  });
});
