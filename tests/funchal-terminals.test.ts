import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildNetwork, resolveNodes, servicesFor } from '../src/lib/network';
import { plan } from '../src/lib/router';
import type { Dataset } from '../src/types';

const file = 'public/data/schedules.json';
describe.skipIf(!existsSync(file))('Funchal terminals (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const net = buildNetwork(data.lines, data.terminalWalks);
  const terminal = (id: string) => net.nodes.filter((n) => n.terminal === id);
  const walk = (a: string, b: string) => {
    const times = terminal(a).flatMap((x) => terminal(b).map((y) => net.near.get(x.id)!.find((l) => l.node === y.id)?.walk));
    return Math.min(...(times.filter((t) => t !== undefined) as number[]));
  };

  it('keeps one node per Funchal terminal, even where two are 100 m apart', () => {
    for (const id of ['rodoeste', 'sam', 'teleferico', 'cam']) expect(terminal(id).length, id).toBeGreaterThan(0);
    const ids = new Set(['rodoeste', 'sam', 'teleferico', 'cam'].flatMap((t) => terminal(t).map((n) => n.id)));
    expect(ids.size).toBe(['rodoeste', 'sam', 'teleferico', 'cam'].reduce((n, t) => n + terminal(t).length, 0));
  });
  it('links the terminals on foot, never faster than the distance allows', () => {
    expect(walk('rodoeste', 'sam')).toBe(2);
    expect(walk('sam', 'teleferico')).toBe(5);
    expect(walk('rodoeste', 'teleferico')).toBeGreaterThanOrEqual(5);
    expect(walk('teleferico', 'cam')).toBeGreaterThanOrEqual(8);
    expect(walk('sam', 'cam')).toBeGreaterThanOrEqual(10);
    expect(walk('rodoeste', 'cam')).toBeGreaterThanOrEqual(10);
  });
  it('changes between a Rodoeste bus and a SAM bus in Funchal', () => {
    const trips = servicesFor(net, data.lines, { y: 2026, m: 10, d: 21 }, true, ['Funchal']);
    const r = plan(net, trips, resolveNodes(net, 'Ribeira Brava'), resolveNodes(net, 'Machico'), 8 * 60);
    const across = r.transfers.filter((it) => net.nodes[it.legs[0].trip.nodes[it.legs[0].toPos]].terminal !== undefined);
    expect(across.length).toBeGreaterThan(0);
    for (const it of across) {
      expect(it.walk).toBeGreaterThanOrEqual(2);
      // the wait covers the walk: the second bus leaves no earlier than the first arrives plus the walk
      expect(it.legs[1].depart).toBeGreaterThanOrEqual(it.legs[0].arrive + it.walk);
    }
  });
});

describe.skipIf(!existsSync(file))('terminals of lines without a stop list (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const stopNames = (num: string) => data.lines.find((l) => l.number === num)!.directions.map((d) => d.stops.map((s) => s.name));

  it('puts the places found by resolve:terminals on their lines', () => {
    expect(stopNames('221')).toEqual([['Ribeira Brava', 'Furna'], ['Furna', 'Ribeira Brava']]);
    expect(stopNames('258')).toEqual([['Torre', 'Covão'], ['Covão', 'Torre']]);
    expect(stopNames('991')[0]).toEqual(['Vila Baleira', 'Camacha (Porto Santo)']);
  });
  it('places every such terminal on the island part its line serves (no namesake at the other end)', () => {
    const at = (num: string) => data.lines.find((l) => l.number === num)!.directions.flatMap((d) => d.stops);
    for (const s of at('221')) expect(s.lon).toBeLessThan(-16.95);
    for (const s of at('991')) expect(s.lat).toBeGreaterThan(33);
    const moinhos = at('554').find((s) => s.name === 'Moinhos')!;
    expect(moinhos.lon).toBeGreaterThan(-16.85);
  });
  it('estimates times and routes for them', () => {
    const l = data.lines.find((x) => x.number === '260')!;
    expect(l.directions.every((d) => d.terminalsOnly && d.isEstimated && d.shapeId != null)).toBe(true);
  });
});

describe.skipIf(!existsSync(file))('timetable rows repaired at parse time (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const times = (num: string) => data.lines.find((l) => l.number === num)!.directions.flatMap((d) => (d.trips ?? []).flatMap((t) => t.times.filter(Boolean) as string[]));

  it('line 785 keeps the third printed trip and leaves out only its typo', () => {
    const trips = data.lines.find((l) => l.number === '785')!.directions[0].trips!;
    expect(trips.map((t) => t.times.filter(Boolean).length)).toEqual([6, 5, 5]);
    expect(times('785')).not.toContain('18:25');
  });
  it('line 526 has the Porto Novo / Fazenda / Santa Cruz table next to Achada - Salão', () => {
    const l = data.lines.find((x) => x.number === '526')!;
    const names = l.directions.map((d) => `${d.from}>${d.to}`);
    expect(names).toContain('Porto Novo>Santa Cruz');
    expect(names).toContain('Santa Cruz>Porto Novo');
    expect(l.directions.flatMap((d) => d.stops.map((s) => s.name))).toContain('Fazenda');
  });
  it('line 96 keeps the passing time at Corticeiras of the trips from Corrida and Jardim Serra', () => {
    const l = data.lines.find((x) => x.number === '96')!;
    const back = l.directions.find((d) => d.from === 'Jardim Serra')!;
    expect(back.stops.map((s) => s.name)).toEqual(['Jardim Serra', 'Corticeiras', 'Estreito de Câmara de Lobos', 'Funchal']);
    expect(back.trips!.some((t) => t.times[1] !== null)).toBe(true);
    expect(back.trips!.some((t) => t.times[1] === null)).toBe(true); // via Fôro
  });
});
