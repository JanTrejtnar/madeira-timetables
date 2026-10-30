import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildNetwork, nodeIdsOfKeys, nodesNearPoint, resolveNodes, servicesFor, tripStops } from '../src/lib/network';
import { plan } from '../src/lib/router';
import type { Dataset } from '../src/types';

const file = 'public/data/schedules.json';
describe.skipIf(!existsSync(file))('Funchal -> Eira do Serrado (line 181, timetable from the GTFS feed)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const line = data.lines.find((x) => x.number === '181')!;
  const net = buildNetwork(data.lines);
  const day = { y: 2026, m: 10, d: 23 }; // a Friday in school term

  it('line 181 comes from the feed: the viewpoint is a stop with its official position and a printed time, no "Via" note', () => {
    expect(line.family).toBe('gtfs');
    expect(line.via).toBeUndefined();
    const stops = line.directions.flatMap((d) => d.stops).filter((s) => s.name === 'Eira do Serrado');
    expect(stops.length).toBeGreaterThan(0);
    for (const s of stops) {
      expect(s.source).toBe('gtfs');
      expect(Math.hypot((s.lat! - 32.7107) * 110540, (s.lon! + 16.9619) * 93000)).toBeLessThan(400);
    }
    // trips that call at the viewpoint have a time there, the others a dash
    const d = line.directions.find((x) => x.stops.some((s) => s.name === 'Eira do Serrado'))!;
    const i = d.stops.findIndex((s) => s.name === 'Eira do Serrado');
    expect(d.trips!.some((t) => t.times[i] !== null)).toBe(true);
  });
  it('the viewpoint of the places list (picked as a place) stands for the Eira do Serrado stop, and a connection is found', () => {
    const near = nodesNearPoint(net, 32.7083, -16.9633);
    expect(near.nodes.some((x) => /Eira do Serrado/.test(x.node.name))).toBe(true);
    const trips = servicesFor(net, data.lines, day, true, ['Funchal']);
    const to = nodeIdsOfKeys(net, near.nodes.map((x) => x.node.key));
    const r = plan(net, trips, resolveNodes(net, 'Funchal'), to, 8 * 60);
    expect(r.direct.some((it) => it.legs[0].trip.line.number === '181')).toBe(true);
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
    expect(leg.arriveEstimated).toBe(false);
    expect(hit.depart).toBeGreaterThanOrEqual(8 * 60);
    expect(hit.arrive).toBeGreaterThan(hit.depart);
  });
});
