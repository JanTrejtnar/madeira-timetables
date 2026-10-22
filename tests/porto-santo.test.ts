import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildNetwork, resolveNodes, servicesFor } from '../src/lib/network';
import { plan } from '../src/lib/router';
import type { Dataset } from '../src/types';

const file = 'public/data/schedules.json';

describe.skipIf(!existsSync(file))('Porto Santo (lines 991-995, CAM)', () => {
  const ds = JSON.parse(readFileSync(file, 'utf8')) as Dataset;
  const line = (n: string) => ds.lines.find((l) => l.number === n)!;
  const net = buildNetwork(ds.lines);
  const trips = servicesFor(net, ds.lines, { y: 2026, m: 10, d: 23 } as never, true, ['Porto Santo']);
  const direct = (a: string, b: string) => plan(net, trips, resolveNodes(net, a), resolveNodes(net, b), 7 * 60).direct;

  it('all five lines exist with departures and stops on the island', () => {
    for (const n of ['991', '992', '993', '994', '995']) {
      const l = line(n);
      expect(l, n).toBeDefined();
      for (const d of l.directions) {
        expect(Object.values(d.departures).some((v) => v?.length), `${n} ${d.from}`).toBe(true);
        expect(d.stops.length, `${n} ${d.from} stops`).toBeGreaterThanOrEqual(3);
        for (const s of d.stops) {
          expect(s.lat! > 33.0 && s.lat! < 33.15 && s.lon! > -16.45 && s.lon! < -16.25, `${n} ${s.name}`).toBe(true);
        }
      }
    }
  });
  it('line 994 has a road route per direction, passing the Calheta terminus', () => {
    for (const d of line('994').directions) expect(d.shapeId).not.toBeNull();
    expect(line('994').directions.some((d) => d.stops.at(-1)!.name === 'Calheta (Porto Santo)')).toBe(true);
  });
  it('the Porto Santo Calheta does not clash with the Calheta of Madeira', () => {
    const ps = net.nodes.filter((n) => n.muni === 'Porto Santo');
    const names = new Set(ps.map((n) => n.name));
    expect(names.has('Calheta (Porto Santo)')).toBe(true);
    expect(resolveNodes(net, 'Calheta (Porto Santo)').size).toBe(1);
  });
  it('plans Vila Baleira -> Calheta (Porto Santo) and the airport -> Calheta directly on line 994', () => {
    for (const [a, b] of [['Vila Baleira', 'Calheta (Porto Santo)'], ['Calheta (Porto Santo)', 'Vila Baleira'], ['Aeroporto do Porto Santo', 'Calheta (Porto Santo)']]) {
      const d = direct(a, b);
      expect(d.length, `${a} > ${b}`).toBeGreaterThan(0);
      expect(d[0].legs.every((leg) => leg.trip.line.number === '994')).toBe(true);
    }
  });
});
