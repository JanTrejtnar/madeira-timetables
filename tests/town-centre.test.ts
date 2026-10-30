import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PARISH_PREFIX, buildNetwork, servicesFor, suggest } from '../src/lib/network';
import { CITY_CENTRE_M, runSearch } from '../src/lib/plannerSearch';
import { metres } from '../shared/geo.mjs';
import { shortEnds } from '../src/components/LineView';
import { fromWire, toWire } from '../src/lib/searchWire';
import type { Dataset } from '../src/types';

const file = 'public/data/schedules.json';
describe.skipIf(!existsSync(file))('parish as a destination, short trips (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const net = buildNetwork(data.lines);
  const trips = servicesFor(net, data.lines, { y: 2026, m: 10, d: 19 }, true, ['Funchal']);
  const camacha = suggest(net, data.lines, 'camacha').find((s) => s.group && s.name === 'Camacha')!;

  it('"Funchal" -> "Camacha (all stops)" alights in the village, not at the first stop of the parish border', () => {
    expect(camacha.key.startsWith(PARISH_PREFIX)).toBe(true);
    for (const at of [8 * 60, 12 * 60, 17 * 60]) {
      const r = runSearch(net, trips, { text: 'Funchal', key: suggest(net, data.lines, 'funchal').find((s) => s.group)!.key }, { text: 'Camacha', key: camacha.key }, at, false)!;
      const first = [...r.plan.direct, ...r.plan.transfers].slice(0, 5);
      expect(first.length).toBeGreaterThan(0);
      for (const it of first) {
        const last = it.legs.at(-1)!;
        expect(['largo da achada', 'igreja da camacha']).toContain(net.nodes[last.trip.nodes[last.toPos]].key);
      }
    }
  }, 60_000);

  it('"Funchal" as the start boards in the centre (a terminal or hub, or a line start near one), not at the edge of the town', () => {
    const city = suggest(net, data.lines, 'funchal').find((s) => s.group)!;
    const hubs = net.nodes.filter((n) => (n.terminal || n.transferHub) && n.lat !== undefined);
    for (const at of [8 * 60, 12 * 60, 17 * 60]) {
      const r = runSearch(net, trips, { text: 'Funchal', key: city.key }, { text: 'Camacha', key: camacha.key }, at, false)!;
      const first = [...r.plan.direct, ...r.plan.transfers].slice(0, 5);
      expect(first.length).toBeGreaterThan(0);
      for (const it of first) {
        const n = net.nodes[it.legs[0].trip.nodes[it.legs[0].fromPos]];
        expect(n.name).not.toMatch(/Estrada da Camacha/);
        expect(hubs.some((h) => h.id === n.id || metres(h as never, n as never) <= CITY_CENTRE_M)).toBe(true);
      }
    }
  }, 60_000);

  it('"Funchal" as the destination alights in the centre (a terminal or hub, or a line end near one), not at the edge of the town (Palheiro Ferreiro)', () => {
    const city = suggest(net, data.lines, 'funchal').find((s) => s.group)!;
    const hubs = net.nodes.filter((n) => (n.terminal || n.transferHub) && n.lat !== undefined);
    for (const at of [8 * 60, 12 * 60, 17 * 60]) {
      const r = runSearch(net, trips, { text: 'Camacha', key: camacha.key }, { text: 'Funchal', key: city.key }, at, false)!;
      const first = [...r.plan.direct, ...r.plan.transfers].slice(0, 5);
      expect(first.length).toBeGreaterThan(0);
      for (const it of first) {
        const l = it.legs.at(-1)!;
        const n = net.nodes[l.trip.nodes[l.toPos]];
        expect(n.name).not.toMatch(/Palheiro Ferreiro/);
        expect(hubs.some((h) => h.id === n.id || metres(h as never, n as never) <= CITY_CENTRE_M)).toBe(true);
      }
    }
  }, 60_000);

  it('"Ilha" (a parish of two "Via" places on line 138) is the village Ilha, not Achada do Marques, in both directions', () => {
    const city = suggest(net, data.lines, 'funchal').find((s) => s.group)!;
    const ilha = suggest(net, data.lines, 'ilha').find((s) => s.group)!;
    const ends = (it: { legs: { trip: { nodes: number[] }; fromPos: number; toPos: number }[] }, last: boolean) => {
      const l = last ? it.legs.at(-1)! : it.legs[0];
      return net.nodes[l.trip.nodes[last ? l.toPos : l.fromPos]].key;
    };
    for (const at of [5 * 60, 11 * 60, 17 * 60]) {
      const out = runSearch(net, trips, { text: 'Ilha', key: ilha.key }, { text: 'Funchal', key: city.key }, at, false)!;
      const back = runSearch(net, trips, { text: 'Funchal', key: city.key }, { text: 'Ilha', key: ilha.key }, at, false)!;
      const o = [...out.plan.direct, ...out.plan.transfers].slice(0, 5);
      const b = [...back.plan.direct, ...back.plan.transfers].slice(0, 5);
      expect(o.length).toBeGreaterThan(0);
      expect(b.length).toBeGreaterThan(0);
      for (const it of o) expect(ends(it, false)).toBe('ilha');
      for (const it of b) expect(ends(it, true)).toBe('ilha');
    }
  }, 60_000);

  it('"Funchal" as the start boards where the bus starts (Teleférico-Término), not at the second stop of the same trip', () => {
    const city = suggest(net, data.lines, 'funchal').find((s) => s.group)!;
    for (const at of [8 * 60, 12 * 60]) {
      const r = runSearch(net, trips, { text: 'Funchal', key: city.key }, { text: 'Camacha', key: camacha.key }, at, false)!;
      const first = [...r.plan.direct, ...r.plan.transfers].slice(0, 5);
      expect(first.length).toBeGreaterThan(0);
      for (const it of first) {
        const l = it.legs[0];
        const hubBefore = l.trip.nodes.slice(0, l.fromPos).some((id) => net.nodes[id].transferHub || net.nodes[id].terminal);
        expect(hubBefore).toBe(false);
        expect(l.depart).toBeGreaterThanOrEqual(at);
      }
    }
  }, 60_000);

  it('a town as the start never boards at a mere settlement centre when a real stop follows close on the same trip (line 503 "Funchal")', () => {
    const city = suggest(net, data.lines, 'funchal').find((s) => s.group)!;
    const l503 = data.lines.find((x) => x.number === '503')!;
    expect(l503.directions[0].stops[0].locationPrecision).toBe('settlement_center');
    const centroids = net.nodes.filter((n) => n.centroid);
    expect(centroids.length).toBeGreaterThan(0);
    let seen503 = 0;
    for (const dest of ['Fonte Almocreves', 'Camacha', 'Santana']) {
      const to = suggest(net, data.lines, dest.toLowerCase())[0];
      for (const at of [7 * 60, 10 * 60, 15 * 60]) {
        const r = runSearch(net, trips, { text: 'Funchal', key: city.key }, { text: dest, key: to.key }, at, false)!;
        for (const it of [...r.plan.direct, ...r.plan.transfers]) {
          const l = it.legs[0];
          const here = net.nodes[l.trip.nodes[l.fromPos]];
          if (l.trip.line.number === '503') seen503++;
          if (!here.centroid) continue;
          // still at the centre: no real stop within 1 km follows on that trip before the alighting stop
          const next = l.trip.nodes.slice(l.fromPos + 1, l.toPos).map((id) => net.nodes[id]).find((n) => !n.centroid && n.lat !== undefined);
          expect(!next || metres(here as never, next as never) > 1000).toBe(true);
        }
      }
    }
    expect(seen503).toBeGreaterThan(0);
  }, 60_000);

  it('a result crossing the worker boundary (trips as indices) comes back as the same result', () => {
    const city = suggest(net, data.lines, 'funchal').find((s) => s.group)!;
    const r = runSearch(net, trips, { text: 'Funchal', key: city.key }, { text: 'Camacha', key: camacha.key }, 9 * 60, false)!;
    const back = fromWire(structuredClone(toWire(r)), new Map(data.lines.map((l) => [l.id, l])));
    expect(back).toEqual(r);
    expect(back.plan.direct[0]?.legs[0].trip.line).toBe(r.plan.direct[0]?.legs[0].trip.line);
  }, 60_000);

  it('the network map lists the "Via" places (Ilha), which are no stops', () => {
    const o = JSON.parse(readFileSync('public/data/overview.json', 'utf8'));
    expect(o.places.find((p: { n: string }) => p.n === 'Ilha')?.i.length).toBeGreaterThan(0);
  });

  it('a parish whose centre cannot be reached keeps all of its stops as the fallback', () => {
    // Rochão: nothing is listed for it, the busiest stops of the parish area are used, and a connection is found either way
    const g = suggest(net, data.lines, 'caniço').find((s) => s.group)!;
    const r = runSearch(net, trips, { text: 'Funchal', key: null }, { text: 'Caniço', key: g.key }, 9 * 60, false)!;
    expect(r.plan.direct.length + r.plan.transfers.length).toBeGreaterThan(0);
  });

  it('line 181 has two sides; short-turn trips are not directions of their own', () => {
    const l = data.lines.find((x) => x.number === '181')!;
    const full = l.directions.filter((d) => !d.variant);
    expect(full).toHaveLength(2);
    // no direction whose stops are all stops of the main direction on that side (apart from a turn-around)
    const names = (d: (typeof l.directions)[number]) => new Set(d.stops.map((s) => s.name.replace(/,?\s+T-\d+$/, '')));
    for (const d of l.directions.filter((x) => x.variant)) {
      const main = full.find((m) => (m.from ?? m.stops[0].name) === (d.from ?? d.stops[0].name) || m.to === d.to) ?? null;
      if (main) expect([...names(d)].every((n) => names(main).has(n))).toBe(false);
    }
    // a trip that ends early reports where
    const main = full[0];
    const shortened = main.trips!.map((t) => shortEnds(main, t)).filter(Boolean);
    expect(shortened.length).toBeGreaterThan(0);
    expect(shortened.every((c) => c!.end || c!.start)).toBe(true);
  });
});
