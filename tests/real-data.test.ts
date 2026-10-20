import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { board } from '../src/lib/departures';
import { buildIndex, findConnections, searchLines, searchStops } from '../src/lib/search';
import { buildNetwork, resolveNodes, servicesFor } from '../src/lib/network';
import { plan } from '../src/lib/router';
import { poiFor } from '../src/lib/aliases';
import type { Dataset } from '../src/types';

const file = 'public/data/schedules.json';
describe.skipIf(!existsSync(file))('real data (run `npm run build:data` first)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const ix = buildIndex(data.lines);
  const ctx = { now: { y: 2026, m: 10, d: 19, minutes: 8 * 60 }, school: true, municipalities: ['Funchal'] as const };

  it('has the expected scale', () => {
    expect(data.lines.length).toBe(137);
    expect(data.lines.filter((l) => l.hasParsedSchedule).length).toBeGreaterThan(70);
  });
  it('searches by number, destination and stop', () => {
    expect(searchLines(ix, '007')[0].number).toBe('007');
    expect(searchLines(ix, 'machico').length).toBeGreaterThan(0);
    expect(searchLines(ix, 'monte').length).toBeGreaterThan(0);
    expect(searchStops(ix, 'pinga').length).toBeGreaterThan(0);
  });
  it('finds a connection in order and not the reverse on the same direction', () => {
    const r = findConnections(data.lines, 'pinga', 'mercedes').filter((c) => c.line.number === '007');
    expect(r.length).toBe(1);
    expect(r[0].dir.from).toBe('Centro');
  });
  it('builds a departures board for a Monday morning', () => {
    const rows = board(data.lines, ctx);
    expect(rows.length).toBeGreaterThan(50);
    expect(rows[0].next[0].inMin).toBeGreaterThanOrEqual(0);
  });
});

describe.skipIf(!existsSync(file))('per-stop lines (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  it('has lines with per-stop times and consistent trip shapes', () => {
    const dirs = data.lines.flatMap((l) => l.directions.filter((d) => d.trips?.length));
    expect(dirs.length).toBeGreaterThan(0);
    for (const d of dirs) for (const t of d.trips ?? []) expect(t.times.length).toBe(d.stops.length);
  });
});

describe.skipIf(!existsSync(file))('regression: lines that must show departure times', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  for (const num of ['007', '181', '142']) {
    it(`line ${num} has parsed departures in the shipped data`, () => {
      const line = data.lines.find((l) => l.number === num);
      expect(line, `line ${num} missing`).toBeTruthy();
      expect(line!.hasParsedSchedule).toBe(true);
      const n = line!.directions.reduce((a, d) => a + Object.values(d.departures).reduce((x, l) => x + (l?.length ?? 0), 0), 0);
      expect(n).toBeGreaterThanOrEqual(12);
      // the first direction has a weekday list the UI can show by default
      const d = line!.directions[0];
      expect((d.departures.weekday ?? d.departures.weekday_school ?? []).length).toBeGreaterThan(0);
    });
  }
});

describe.skipIf(!existsSync(file))('journey planner on real data', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const net = buildNetwork(data.lines);
  const monday = { y: 2026, m: 10, d: 19 };
  const trips = servicesFor(net, data.lines, monday, true, ['Funchal']);

  it('finds a direct connection on line 007 with a real departure and an estimated arrival', () => {
    const r = plan(net, trips, resolveNodes(net, 'pinga'), resolveNodes(net, 'mercedes'), 9 * 60);
    const l007 = r.direct.find((x) => x.legs[0].trip.line.number === '007');
    expect(l007).toBeTruthy();
    expect(l007!.legs[0].departEstimated).toBe(false);
    expect(l007!.legs[0].arriveEstimated).toBe(true);
    expect(l007!.arrive).toBeGreaterThan(l007!.depart);
  });
  it('line 142 exposes real (printed) times at intermediate stops', () => {
    const l142 = data.lines.find((l) => l.number === '142')!;
    expect(l142.directions.some((d) => d.trips?.length && d.isEstimated === false)).toBe(true);
  });
  it('every estimate is flagged and monotonic', () => {
    for (const l of data.lines) {
      for (const d of l.directions) {
        if (!d.stopOffsets) continue;
        expect(d.isEstimated).toBe(true);
        expect(d.stopOffsets.length).toBe(d.stops.length);
        for (let i = 1; i < d.stopOffsets.length; i++) expect(d.stopOffsets[i]).toBeGreaterThanOrEqual(d.stopOffsets[i - 1]);
      }
    }
  });
  it('a transfer respects the 5 minute minimum', () => {
    const r = plan(net, trips, resolveNodes(net, 'curral'), resolveNodes(net, 'funchal'), 9 * 60);
    for (const t of r.transfers) expect(t.legs[1].depart - t.legs[0].arrive).toBeGreaterThanOrEqual(5);
  });
});

describe.skipIf(!existsSync(file))('SAM (east of the island) lines', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const sam = data.lines.filter((l) => l.family === 'sam');
  it('parsed most of the SAM sheets, each trip has a time per stop slot', () => {
    expect(sam.length).toBe(21);
    expect(sam.filter((l) => l.hasParsedSchedule).length).toBeGreaterThanOrEqual(14);
    for (const l of sam.filter((x) => x.hasParsedSchedule)) {
      for (const d of l.directions) {
        expect(d.isEstimated).toBe(false);
        for (const t of d.trips ?? []) expect(t.times.length).toBe(d.stops.length);
      }
    }
  });
  it('plans Machico -> Funchal with printed times (no estimates)', () => {
    const net = buildNetwork(data.lines);
    const trips = servicesFor(net, data.lines, { y: 2026, m: 10, d: 19 }, true, ['Funchal']);
    const interurban = trips.filter((t) => t.line.type === 'interurbano');
    const r = plan(net, interurban, resolveNodes(net, 'machico'), resolveNodes(net, 'funchal'), 7 * 60);
    expect(r.direct.length).toBeGreaterThan(0);
    expect(r.direct[0].legs[0].departEstimated).toBe(false);
    expect(r.direct[0].legs[0].arriveEstimated).toBe(false);
  });
});

describe.skipIf(!existsSync(file))('coverage', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  it('every intercity line has a parsed or transcribed schedule', () => {
    const missing = data.lines.filter((l) => l.type === 'interurbano' && !l.hasParsedSchedule).map((l) => l.number || l.oldNumber);
    expect(missing).toEqual([]);
  });
  it('at least 130 of 137 lines have times; manual transcriptions are labelled', () => {
    expect(data.lines.filter((l) => l.hasParsedSchedule).length).toBeGreaterThanOrEqual(130);
    for (const l of data.lines.filter((x) => (x as unknown as { family: string }).family === 'manual')) {
      expect((l as unknown as { manualSource?: string }).manualSource).toBeTruthy();
    }
  });
  it('no direction mixes up trip length and stop list', () => {
    for (const l of data.lines) for (const d of l.directions) for (const t of d.trips ?? []) expect(t.times.length).toBe(d.stops.length);
  });
  it('line 181 includes the Transbordo shuttle page (Terra Chã / Seara Velha)', () => {
    const l = data.lines.find((x) => x.number === '181')!;
    const tr = l.directions.filter((d) => d.variant === 'transbordo');
    expect(tr.length).toBe(4);
    const all = tr.flatMap((d) => d.trips ?? []);
    expect(all.length).toBe(6);
    const f = tr.find((d) => d.stops[0].name === 'Funchal' && d.stops[1].name === 'ESTR Lombo Chão')!;
    expect(f.trips![0].times).toEqual(['10:00', '11:20', '11:35', '11:50']);
    expect(tr.some((d) => d.stops.some((s) => s.name === 'Seara Velha Baixo'))).toBe(true);
  });
  it('urban lines that span municipalities or exceed 15 km are interurbano (994 on Porto Santo stays urban)', () => {
    const t = (n: string) => data.lines.find((l) => l.number === n)!;
    for (const n of ['048', '050', '703', '704']) {
      expect(t(n).type).toBe('interurbano');
      expect(t(n).typeSiga).toBe('urbano');
      expect(t(n).isInterurbano).toBe(true);
    }
    expect(t('994').type).toBe('urbano');
    expect(t('007').type).toBe('urbano');
  });
  it('aliases: airport / Letiště / Flugplatz find the Aeroporto stops and the Aerobus', () => {
    const ix = buildIndex(data.lines);
    for (const q of ['airport', 'Letiště', 'Flugplatz']) {
      expect(searchStops(ix, q).some((s) => s.key.includes('aeroporto'))).toBe(true);
      expect(searchLines(ix, q).some((l) => l.number === '500')).toBe(true);
    }
  });
  it('aliases: tourist destinations', () => {
    const ix = buildIndex(data.lines);
    expect(searchLines(ix, 'curral das freiras').some((l) => l.number === '181')).toBe(true);
    expect(searchStops(ix, 'cabo girao').length).toBeGreaterThan(0);
    expect(searchStops(ix, 'ribeiro frio').length).toBeGreaterThan(0);
    // no scheduled line to Pico do Arieiro in the data: an information card is shown instead
    const poi = poiFor('Pico do Arieiro')!;
    expect(poi.info?.cs).toMatch(/Poiso/);
    expect(searchLines(ix, 'Pico do Arieiro')).toHaveLength(0);
    expect(searchStops(ix, 'poiso').length).toBeGreaterThan(0);
  });
  it('stops known only by name got approximate coordinates (181 Transbordo)', () => {
    const l = data.lines.find((x) => x.number === '181')!;
    for (const d of l.directions.filter((x) => x.variant === 'transbordo')) for (const s of d.stops) expect(s.lat).toBeDefined();
    expect(l.directions.some((d) => d.stops.some((s) => s.approx))).toBe(true);
  });
});
