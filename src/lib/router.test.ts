import { describe, expect, it } from 'vitest';
import { buildNetwork, resolveNodes, servicesFor } from './network';
import { MIN_TRANSFER_ESTIMATED, mergePlans, plan, routeGuard } from './router';
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

  it('ranks by arrival at the destination, bus plus walk: a near stop beats an earlier far one', () => {
    const to = new Set([...nodes('bravo'), ...nodes('charlie')]);
    const [bravo] = nodes('bravo');
    const [charlie] = nodes('charlie');
    const near = plan(net, trips, nodes('alpha'), to, 7 * 60 + 50, undefined, new Map([[bravo, 2], [charlie, 25]]));
    expect(near.direct[0].legs[0].toPos).toBe(1);
    expect(near.direct[0]).toMatchObject({ arrive: 8 * 60 + 10, finish: 8 * 60 + 12 });
    const far = plan(net, trips, nodes('alpha'), to, 7 * 60 + 50, undefined, new Map([[bravo, 30], [charlie, 1]]));
    expect(far.direct[0].legs[0].toPos).toBe(2);
    expect(far.direct[0].finish).toBe(8 * 60 + 21);
    // without a destination point the first stop reached is used, as before
    expect(plan(net, trips, nodes('alpha'), to, 7 * 60 + 50).direct[0].legs[0].toPos).toBe(1);
  });
  it('a transfer is judged by its finish too', () => {
    const [echo] = nodes('echo');
    const [delta] = nodes('delta');
    const r = plan(net, trips, nodes('alpha'), new Set([echo, delta]), 7 * 60 + 50, undefined, new Map([[echo, 0], [delta, 40]]));
    expect(r.transfers[0].legs.at(-1)!.trip.nodes[r.transfers[0].legs.at(-1)!.toPos]).toBe(echo);
  });

  it('never offers a bus that heads for the starting area or away from the destination', () => {
    // "Home -> Funchal" run: it calls at Mid (as the traveller's area) and ends in the start area, the destination lies the other way
    const east = mk(7, '7', [['Far West', 32.65, -17.2], ['Cabo', 32.65, -17.0], ['Mid', 32.65, -16.95], ['Funchal', 32.65, -16.9]], ['08:00'], [0, 20, 30, 40]);
    const w = buildNetwork([east]);
    const t = servicesFor(w, [east], monday, true, ['Funchal']);
    const ids = (q: string) => resolveNodes(w, q);
    // Funchal -> Cabo with the bus running Far West -> Funchal: Cabo comes before Funchal, no ride exists the right way
    expect(plan(w, t, ids('funchal'), ids('cabo'), 0).direct).toHaveLength(0);
    // from a wayside stop of the start area on a run that ends in that area: heads home
    const area = new Set([...ids('mid'), ...ids('funchal')]);
    expect(routeGuard(w, area, ids('cabo')).intoOrigin(t[0])).toBe(true);
    expect(routeGuard(w, ids('far west'), ids('cabo')).intoOrigin(t[0])).toBe(false);
    // a ride that gets closer is fine, one that moves away from the destination is not
    const g = routeGuard(w, ids('far west'), ids('mid'));
    expect(g.closer?.(ids('far west').values().next().value!, ids('cabo').values().next().value!)).toBe(true);
    expect(g.closer?.(ids('cabo').values().next().value!, ids('far west').values().next().value!)).toBe(false);
  });
});

describe('second-leg index cache', () => {
  const sig = (p: ReturnType<typeof plan>) => JSON.stringify([...p.direct, ...p.transfers].map((it) => [it.depart, it.arrive, it.finish, it.legs.map((l) => [l.trip.line.id, l.fromPos, l.toPos])]));
  it('later searches for the same destination give what a search from scratch gives', () => {
    const from = nodes('alpha');
    const to = nodes('echo');
    plan(net, trips, from, to, 7 * 60 + 50); // fills the cache
    for (const at of [0, 7 * 60 + 50, 8 * 60 + 5, 9 * 60, 11 * 60]) {
      const cached = plan(net, trips, from, to, at);
      const fresh = plan(net, [...trips], from, to, at); // a new array: nothing cached
      expect(sig(cached)).toBe(sig(fresh));
    }
  });
  it('a different destination or walk-out does not reuse the index of another', () => {
    const a = plan(net, trips, nodes('alpha'), nodes('echo'), 7 * 60 + 50);
    const b = plan(net, trips, nodes('alpha'), nodes('delta'), 7 * 60 + 50);
    expect(sig(a)).not.toBe(sig(b));
    const walk = new Map([...nodes('echo')].map((id) => [id, 7] as const));
    const w = plan(net, trips, nodes('alpha'), nodes('echo'), 7 * 60 + 50, undefined, walk);
    expect(w.transfers[0].finish).toBe(w.transfers[0].arrive + 7);
    expect(plan(net, trips, nodes('alpha'), nodes('echo'), 7 * 60 + 50).transfers[0].finish).toBe(a.transfers[0].finish);
  });
});
