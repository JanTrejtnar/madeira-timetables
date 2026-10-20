import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildNetwork, resolveNodes, servicesFor, suggest, tripStops } from '../src/lib/network';
import { plan } from '../src/lib/router';
import type { Dataset } from '../src/types';

const file = 'public/data/schedules.json';
describe.skipIf(!existsSync(file))('terminal-only lines (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const net = buildNetwork(data.lines);
  const trips = servicesFor(net, data.lines, { y: 2026, m: 10, d: 21 }, true, ['Funchal']);

  it('gives the scanned 155/555 its two terminals and the Via places', () => {
    const l = data.lines.find((x) => x.number === '555')!;
    expect(l.directions.map((d) => d.stops.map((s) => s.name))).toEqual([['Ponta da Oliveira', 'Funchal'], ['Funchal', 'Ponta da Oliveira']]);
    expect(Object.keys(l.via ?? {}).sort()).toEqual(['a', 'b']);
    expect(l.directions.every((d) => d.isEstimated && d.stopOffsets!.length === 2)).toBe(true);
  });
  it('offers Garajau and Figueirinhas as stops', () => {
    expect(suggest(net, data.lines, 'garaj').some((s) => /garajau/i.test(s.name))).toBe(true);
    expect(suggest(net, data.lines, 'figueirinh').some((s) => /figueirinhas/i.test(s.name))).toBe(true);
  });
  it('goes from Funchal to Garajau directly, only on the trips that carry the Via note', () => {
    const r = plan(net, trips, resolveNodes(net, 'Funchal'), resolveNodes(net, 'Garajau'), 7 * 60);
    expect(r.direct.length).toBeGreaterThan(0);
    for (const it of r.direct) {
      const t = it.legs[0].trip;
      expect(tripStops(t)[it.legs[0].toPos].name).toBe('Garajau');
      expect(it.legs[0].arrive - it.legs[0].depart).toBeLessThan(40);
    }
  });
  it('never turns around on the same line', () => {
    const r = plan(net, trips, resolveNodes(net, 'Garajau'), resolveNodes(net, 'Figueirinhas'), 8 * 60);
    for (const it of [...r.direct, ...r.transfers]) if (it.legs.length > 1) expect(it.legs[0].trip.line.id).not.toBe(it.legs[1].trip.line.id);
  });
  it('does not show the stray "rano" note on line 208', () => {
    const l = data.lines.find((x) => x.number === '208')!;
    const notes = l.directions.flatMap((d) => (d.trips ?? []).flatMap((t) => t.notes ?? []));
    expect(notes).not.toContain('rano');
    expect(notes).toContain('La');
  });
});
