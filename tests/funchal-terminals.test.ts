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
    // the transfer may be at a planner stop next to the terminal (line 7 now calls at Praça do Povo), so any walking change counts
    const across = r.transfers.filter((it) => it.walk > 0);
    expect(across.length).toBeGreaterThan(0);
    for (const it of across) {
      expect(it.walk).toBeGreaterThanOrEqual(1);
      // the wait covers the walk: the second bus leaves no earlier than the first arrives plus the walk
      expect(it.legs[1].depart).toBeGreaterThanOrEqual(it.legs[0].arrive + it.walk);
    }
  });
});

describe.skipIf(!existsSync(file))('terminals of lines without a stop list (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  // the planner may add intermediate stops (enrich:stops): the terminals are the first and the last
  const stopNames = (num: string) => data.lines.find((l) => l.number === num)!.directions.map((d) => [d.stops[0].name, d.stops.at(-1)!.name]);

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
  it('gives lines whose planner pattern follows the drawn route their intermediate stops and running times', () => {
    const d = data.lines.find((x) => x.number === '221')!.directions[0];
    expect(d.enrichedFrom).toBe('siga-planner');
    expect(d.stops.length).toBeGreaterThan(10);
    expect(d.stopOffsets).toHaveLength(d.stops.length);
    expect(d.stopOffsets!.every((o, i, a) => i === 0 || o >= a[i - 1])).toBe(true);
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
    const names = back.stops.map((s) => s.name);
    const ci = names.indexOf('Corticeiras');
    expect(names[0]).toBe('Jardim Serra');
    expect(names.at(-1)).toBe('Funchal');
    expect(ci).toBeGreaterThan(0);
    expect(ci).toBeLessThan(names.indexOf('Estreito de Câmara de Lobos'));
    expect(back.trips!.some((t) => t.times[ci] !== null)).toBe(true);
    expect(back.trips!.some((t) => t.times[ci] === null)).toBe(true); // via Fôro
  });
  it('line 96 Corticeiras is the junction below Jardim da Serra, so Corrida > Funchal is no longer than Funchal > Corrida', () => {
    const l = data.lines.find((x) => x.number === '96')!;
    const there = l.directions.find((d) => d.from === 'Funchal' && d.to === 'Corrida')!;
    const back = l.directions.find((d) => d.from === 'Corrida' && d.to === 'Funchal')!;
    const c = back.stops.find((s) => s.name === 'Corticeiras')!;
    // not the upper hamlet (32.709, -16.974) next to Corrida: the stop of the SIGA planner 'ESTR das Corticeiras' (32.6848, -16.9888)
    expect(Math.hypot((c.lat! - 32.68482) * 111, (c.lon! - -16.988796) * 93)).toBeLessThan(0.1);
    const km = (d: typeof there) => d.stops.slice(1).reduce((n, s, k) => n + Math.hypot((s.lat! - d.stops[k].lat!) * 111, (s.lon! - d.stops[k].lon!) * 93), 0);
    expect(km(back)).toBeLessThan(1.1 * km(there));
    expect(back.stops.map((s) => s.name).indexOf('Hotel Jardim da Serra')).toBeLessThan(back.stops.map((s) => s.name).indexOf('Corticeiras'));
  });
  it('the most-used stops that had no coordinates now have a labelled position (Tabúa, Achada, P. Cruz (Túnel), Boqueirão, Meia Légua)', () => {
    const at = (line: string, name: string) => data.lines.filter((x) => x.number === line).flatMap((l) => l.directions.flatMap((d) => d.stops)).filter((s) => s.name === name);
    for (const [line, name] of [['4', 'Tabúa'], ['6', 'Meia Légua'], ['56', 'P. Cruz (Túnel)'], ['525', 'Boqueirão'], ['525', 'Achada'], ['111', 'Achada'], ['208', 'Achada']]) {
      const found = at(line, name);
      expect(found.length, `${line} ${name}`).toBeGreaterThan(0);
      for (const s of found) {
        expect(s.lat, `${line} ${name}`).toBeDefined();
        expect(s.locationPrecision, `${line} ${name}`).not.toBe('exact'); // hand-matched by name, never presented as official
      }
    }
  });
  it('line 96 ends Funchal trips at Corrida / Jardim Serra, the 08:15 trip included, with an estimated arrival', () => {
    const l = data.lines.find((x) => x.number === '96')!;
    const corrida = l.directions.find((d) => d.from === 'Funchal' && d.to === 'Corrida')!;
    const names = corrida.stops.map((s) => s.name);
    expect(names[0]).toBe('Funchal');
    expect(names.at(-1)).toBe('Corrida');
    // the planner stops of the road between the printed ones, Jardim da Serra included (not a three-stop stub)
    expect(names.length).toBeGreaterThan(40);
    expect(names.some((n) => /Jardim da Serra/.test(n))).toBe(true);
    expect(names.indexOf('Estreito de Câmara de Lobos')).toBeGreaterThan(0);
    expect(corrida.stops.every((s) => s.lat !== undefined && s.lat !== null)).toBe(true);
    expect(corrida.shapeId).not.toBeNull();
    const ei = names.indexOf('Estreito de Câmara de Lobos');
    expect(corrida.printedIdx).toEqual([0, ei]);
    const trip = corrida.trips!.find((t) => t.times[0] === '08:15')!;
    expect(trip.times[ei]).toBe('08:50');
    expect(trip.times.length).toBe(names.length);
    expect(trip.times.every((x) => x !== null)).toBe(true);
    expect([...trip.times].sort()).toEqual(trip.times); // rising through the intermediate stops
    expect(trip.times.at(-1)! > '08:50').toBe(true);
    expect(trip.estLast).toBe(true);
    const js = l.directions.find((d) => d.to === 'Jardim Serra')!;
    expect(js.stops.at(-1)!.name).toBe('Jardim Serra');
    expect(js.stops.length).toBeGreaterThan(40);
  });
  it('line 96 from Corrida starts at the upper terminus and runs through Jardim da Serra and Estreito to Funchal', () => {
    const l = data.lines.find((x) => x.number === '96')!;
    const d = l.directions.find((x) => x.from === 'Corrida' && x.to === 'Funchal')!;
    const names = d.stops.map((s) => s.name);
    expect(names[0]).toBe('Corrida');
    expect(names.at(-1)).toBe('Funchal');
    expect(names.length).toBeGreaterThan(40);
    expect(names.some((n) => /Jardim da Serra/.test(n))).toBe(true);
    expect(names.indexOf('Estreito de Câmara de Lobos')).toBeGreaterThan(names.findIndex((n) => /Jardim da Serra/.test(n)));
  });
});
