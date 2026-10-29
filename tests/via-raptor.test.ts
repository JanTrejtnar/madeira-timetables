// "Via X" places in the RAPTOR index, on the real timetables (public/data/schedules.json): a place a trip calls at through a note
// (line 138 "Via Ilha, A. Marques e Silveira") is a call of its own that one can board at and get off at, with an interpolated time.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildNetwork, servicesFor, suggest } from '../src/lib/network';
import { compactTrip, planRaptor, prepare } from '../src/lib/raptorAdapter';
import type { Dataset } from '../src/types';

const file = 'public/data/schedules.json';
const NOTE = 'Via Ilha, A. Marques e Silveira';
const hhmm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

describe.skipIf(!existsSync(file))('"Via" places on real data', () => {
  const ds = JSON.parse(readFileSync(file, 'utf8')) as Dataset;
  const net = buildNetwork(ds.lines, ds.terminalWalks);
  // a Wednesday outside school holidays
  const trips = servicesFor(net, ds.lines, { y: 2026, m: 10, d: 28 }, true, ['Funchal']);
  const ilha = net.viaNodes.get(`5011:${NOTE}#0`)!;
  const bus = trips.find((t) => t.line.number === '138' && t.dirIndex === 1 && t.notes?.includes(NOTE) && t.times.includes(hhmm('05:20')))!;
  const funchal = new Set(net.nodes.filter((n) => n.name === 'Funchal').map((n) => n.id));

  it('the via place is a call of the trip with a time between its neighbours', () => {
    const i = bus.nodes.indexOf(ilha);
    expect(i).toBeGreaterThan(0);
    expect(bus.times[i]).toBeGreaterThan(hhmm('05:35')); // São Jorge
    expect(bus.times[i]).toBeLessThan(hhmm('06:17')); // Santana
  });

  it('buildRaptorIndex keeps it: boardable and alightable in the compact trip, and the stop is served in the index', () => {
    const ct = compactTrip(bus);
    expect(ct.nodes).toContain(ilha);
    const { index } = prepare(net, trips);
    expect(index.paStart[ilha + 1] - index.paStart[ilha]).toBeGreaterThan(0);
  });

  it('every line with "Via" notes: each place a trip calls at survives compaction', () => {
    for (const t of trips) {
      if (!t.notes?.length || !t.stops) continue;
      const ct = compactTrip(t);
      t.nodes.forEach((n, i) => { if (t.stops![i].via && t.times[i] !== null) expect(ct.nodes, `${t.line.number} ${t.notes}`).toContain(n); });
    }
  });

  it('Ilha -> Funchal in the morning: the 138 that passes Ilha at 05:48 (Santana 06:17) is found for 05:30', () => {
    const r = planRaptor(net, trips, new Set([ilha]), funchal, hhmm('05:30'));
    const hit = r.direct.find((it) => it.legs[0].trip.line.number === '138' && it.depart === hhmm('05:48'));
    expect(hit?.finish).toBe(hhmm('07:40'));
  });

  it('...and not for 06:30, when that bus has already passed Ilha (the next direct bus is the 103 at 17:04)', () => {
    const r = planRaptor(net, trips, new Set([ilha]), funchal, hhmm('06:30'));
    expect(r.direct.some((it) => it.legs[0].trip === bus)).toBe(false);
    expect(r.direct.find((it) => it.legs[0].trip.line.number === '103' && it.depart === hhmm('17:04'))).toBeTruthy();
  });

  it('Ilha -> Funchal from 04:31: the first bus is the 138 that calls at Ilha at 05:48', () => {
    const r = planRaptor(net, trips, new Set([ilha]), funchal, hhmm('04:31'));
    expect(r.direct[0].legs[0].trip.line.number).toBe('138');
    expect(r.direct[0].depart).toBe(hhmm('05:48'));
  });

  it('Funchal -> Ilha from 07:00: the 07:30 whose "Via Ilha" branch follows its last printed time (Santana 09:00) is found', () => {
    const r = planRaptor(net, trips, funchal, new Set([ilha]), hhmm('07:00'));
    const hit = r.direct.find((it) => it.depart === hhmm('07:30'));
    expect(hit?.legs[0].trip.notes).toContain('Via Ilha');
    expect(hit!.finish).toBeGreaterThan(hhmm('09:00'));
    expect(hit!.finish).toBeLessThan(hhmm('09:30'));
  });

  it('the suggestions for "ilha" are words that start with it, not "Pavilhao" or "Maravilhas"', () => {
    const names = suggest(net, ds.lines, 'ilha').map((s) => s.name);
    expect(names).toContain('Ilha');
    expect(names.filter((n) => /pavilh|maravilh/i.test(n))).toEqual([]);
  });
});
