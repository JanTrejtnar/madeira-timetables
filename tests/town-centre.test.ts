import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PARISH_PREFIX, buildNetwork, servicesFor, suggest } from '../src/lib/network';
import { runSearch } from '../src/lib/plannerSearch';
import { shortEnds } from '../src/components/LineView';
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
