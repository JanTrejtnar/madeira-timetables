import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildNetwork, nodeIdsOfKeys, nodesNearPoint, resolveNodes, servicesFor, tripStops } from '../src/lib/network';
import { plan } from '../src/lib/router';
import type { Dataset, ViaRoutes } from '../src/types';

const file = 'public/data/schedules.json';
describe.skipIf(!existsSync(file))('Funchal -> Eira do Serrado (line 181, trips "Via Eira do Serrado")', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const line = data.lines.find((x) => x.number === '181')!;
  // the detour routes are a file of their own (build:data), loaded with the line's detail
  const viaRoutes: ViaRoutes = line.hasViaRoutes ? JSON.parse(readFileSync(`public/data/via/${line.id}.json`, 'utf8')) : {};
  const net = buildNetwork(data.lines);
  const day = { y: 2026, m: 10, d: 23 }; // a Friday in school term

  it('places Eira do Serrado on the trips that carry the notes b, c and e, between the Ribeira da Lapa and the tunnel stops', () => {
    for (const code of ['b', 'c', 'e']) {
      const eira = line.via![code].find((p) => p.name === 'Eira do Serrado')!;
      expect(eira).toBeDefined();
      expect(eira.lat).toBeCloseTo(32.7107, 3);
      expect(eira.lon).toBeCloseTo(-16.9619, 3);
      for (const [di, after] of Object.entries(eira.after)) {
        const d = line.directions[+di];
        const names = [d.stops[after].name, d.stops[after + 1].name].join(' | ');
        expect(names).toMatch(/Ribeira da Lapa/);
        expect(names).toMatch(/T.nel/);
      }
    }
    // the road through the place is routed as a spur from that stretch
    expect(Object.keys(viaRoutes)).toEqual(expect.arrayContaining(['b|0|42', 'b|1|24', 'c|1|24', 'e|1|24', 'e|0|45']));
    for (const key of ['b|0|42', 'c|1|24', 'e|1|24']) expect(viaRoutes[key].pts.some(([la, lo]) => Math.hypot((la - 32.710657) * 110540, (lo + 16.96188) * 93000) < 120)).toBe(true);
    // variant e (Curral -> Funchal over Fajã Escura and Eira) is routed too, through both places
    const near = (key: string, la: number, lo: number) => viaRoutes[key].pts.some(([a, b]) => Math.hypot((a - la) * 110540, (b - lo) * 93000) < 150);
    expect(near('e|1|24', 32.731757, -16.970856)).toBe(true);
    expect(near('e|0|45', 32.731757, -16.970856)).toBe(true);
  });
  it('the viewpoint of the places list (picked as a place) stands for the Eira do Serrado stop, and a connection is found', () => {
    const near = nodesNearPoint(net, 32.7083, -16.9633);
    expect(near.nodes.some((x) => /Eira do Serrado/.test(x.node.name))).toBe(true);
    const trips = servicesFor(net, data.lines, day, true, ['Funchal']);
    const to = nodeIdsOfKeys(net, near.nodes.map((x) => x.node.key));
    const r = plan(net, trips, resolveNodes(net, 'Funchal'), to, 8 * 60);
    expect(r.direct.some((it) => it.legs[0].trip.line.number === '181')).toBe(true);
  });
  it('legend of the notes is complete', () => {
    expect(line.notes.b).toBe('Via Fajã dos Cardos - Eira do Serrado');
    expect(line.notes.g).toBe('Em dias não letivos, só via Fajã dos Cardos');
    expect(line.notes.h).toBe('Transbordo de/para Terra Chã de Cima e Seara Velha de Baixo');
    expect(line.notes['*']).toMatch(/Eira do Serrado/);
  });
  it('the planner finds Funchal -> Eira do Serrado, with the departure from Funchal and the arrival at the viewpoint', () => {
    const trips = servicesFor(net, data.lines, day, true, ['Funchal']);
    const r = plan(net, trips, resolveNodes(net, 'Funchal'), resolveNodes(net, 'Eira do Serrado'), 8 * 60);
    const all = [...r.direct, ...r.transfers];
    expect(all.length).toBeGreaterThan(0);
    const hit = r.direct.find((it) => it.legs[0].trip.line.number === '181')!;
    expect(hit).toBeDefined();
    const leg = hit.legs[0];
    expect(tripStops(leg.trip)[leg.toPos].name).toBe('Eira do Serrado');
    expect(hit.depart).toBeGreaterThanOrEqual(8 * 60);
    expect(hit.arrive).toBeGreaterThan(hit.depart);
    // only the trips that carry a "Via Eira do Serrado" note go there
    for (const it of r.direct) if (it.legs[0].trip.line.number === '181') expect(it.legs[0].trip.notes?.some((n) => ['b', 'c', 'e'].includes(n))).toBe(true);
  });
});
