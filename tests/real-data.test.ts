import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { board } from '../src/lib/departures';
import { buildIndex, findConnections, searchLines, searchStops } from '../src/lib/search';
import { buildNetwork, nearestNode, resolveNodes, servicesFor, suggest, type Trip } from '../src/lib/network';
import { formFromQuery, formToQuery } from '../src/lib/plannerForm';
import { serviceDay } from '../src/lib/holidays';
import { variantLabel } from '../src/lib/notes';
import { direct, plan } from '../src/lib/router';
import { poiFor } from '../src/lib/aliases';
import { departuresFrom, nearbyStops } from '../src/lib/nearby';
import { decodeEntitiesInJson } from '../src/lib/text';
import { walkTo } from '../src/lib/walk';
import { cleanName } from '../scripts/lib-text.mjs';
import type { Dataset } from '../src/types';

const file = 'public/data/schedules.json';
describe.skipIf(!existsSync(file))('real data (run `npm run build:data` first)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const ix = buildIndex(data.lines);
  const ctx = { now: { y: 2026, m: 10, d: 19, minutes: 8 * 60 }, school: true, municipalities: ['Funchal'] as const };

  it('has the expected scale', () => {
    expect(data.lines.length).toBe(138); // 137 SIGA lines + Pico do Areeiro (Horários do Funchal)
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
    // Pico do Areeiro is served by the Horários do Funchal shuttle (external line 9001)
    for (const q of ['Pico do Arieiro', 'Pico do Areeiro', 'Arieiro']) {
      expect(poiFor(q)?.lineId).toBe(9001);
      expect(searchLines(ix, q).some((l) => l.id === 9001)).toBe(true);
    }
    expect(searchStops(ix, 'poiso').length).toBeGreaterThan(0);
  });
  it('stops known only by name got approximate coordinates (181 Transbordo)', () => {
    const l = data.lines.find((x) => x.number === '181')!;
    for (const d of l.directions.filter((x) => x.variant === 'transbordo')) for (const s of d.stops) expect(s.lat).toBeDefined();
    expect(l.directions.some((d) => d.stops.some((s) => s.approx))).toBe(true);
  });
  it('Pico do Areeiro line: timetable, GPS and interpolated stops', () => {
    const l = data.lines.find((x) => x.id === 9001)!;
    expect(l.type).toBe('interurbano');
    expect(l.operator).toBe('Horários do Funchal');
    const [up, down] = l.directions;
    expect(up.trips!.map((t) => t.times[0])).toEqual(['06:00', '13:30']);
    expect(up.trips![0].times.at(-1)).toBe('06:45');
    expect(down.trips!.map((t) => t.times[0])).toEqual(['12:15', '19:00']);
    expect(down.departures.sunday!.map((d) => d.t)).toEqual(['12:15', '19:00']);
    expect(down.trips![1].notes).toEqual(['a']);
    for (const d of l.directions) {
      expect(d.stops.every((s) => s.lat !== undefined)).toBe(true);
      expect(d.stops.some((s) => s.isEstimatedLocation)).toBe(true);
    }
    const summit = up.stops.at(-1)!;
    expect(summit.lat).toBeCloseTo(32.7357, 2);
    // interpolated stops lie between their neighbours along the route (latitude rises towards the summit)
    const lats = up.stops.map((s) => s.lat!);
    expect([...lats].sort((x, y) => x - y)).toEqual(lats);
  });
  it('nearby stops: Pico do Areeiro summit is found from a position next to it', () => {
    const net = buildNetwork(data.lines);
    const r = nearbyStops(net, { lat: 32.7358, lon: -16.9283, acc: 10, seq: 1 });
    expect(r.stops[0].name).toMatch(/Areeiro/);
    expect(r.stops[0].dist).toBeLessThan(100);
    const deps = departuresFrom(net, data.lines, r.stops.find((x) => /Parque/.test(x.name)) ?? r.stops[0], { now: { y: 2026, m: 10, d: 20, minutes: 12 * 60 }, school: true, municipalities: ['Funchal'] as const });
    expect(deps.every((d) => d.next.inMin >= 0)).toBe(true);
  });
});

describe.skipIf(!existsSync(file))('GTFS coordinates and municipality search (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const gtfs: { stops: { code: string; name: string; lat: number; lon: number }[] } = JSON.parse(readFileSync('data/gtfs/stops.json', 'utf8'));
  const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 111, (a[1] - b[1]) * 93);
  const net = buildNetwork(data.lines);

  it('feed stops are on Madeira with unique ids', () => {
    expect(gtfs.stops.length).toBeGreaterThan(1500);
    for (const s of gtfs.stops) {
      expect(s.lat).toBeGreaterThan(32.3);
      expect(s.lat).toBeLessThan(33.2);
      expect(s.lon).toBeGreaterThan(-17.4);
      expect(s.lon).toBeLessThan(-16.2);
    }
  });
  it('stops whose code is in the feed carry the official position (or lie within 150 m of it)', () => {
    const byCode = new Map<string, typeof gtfs.stops>();
    for (const s of gtfs.stops) byCode.set(s.code, [...(byCode.get(s.code) ?? []), s]);
    let checked = 0;
    let apart = 0; // a stop code shared by two different stops of the two systems keeps its SIGA position
    for (const l of data.lines) for (const d of l.directions) for (const s of d.stops) {
      const c = s.code ? byCode.get(String(s.code)) : undefined;
      if (!c || s.lat === undefined) continue;
      checked++;
      if (Math.min(...c.map((x) => km([s.lat!, s.lon!], [x.lat, x.lon]))) >= 0.15) apart++;
    }
    expect(apart).toBeLessThanOrEqual(3);
    expect(checked).toBeGreaterThan(3000);
  });
  it('Teleférico-Término (4A) uses the official GTFS position, not an estimate', () => {
    const s = data.lines.find((l) => l.id === 9001)!.directions[0].stops[0];
    expect(s.approx).toBeFalsy();
    expect(km([s.lat!, s.lon!], [32.647321, -16.902695])).toBeLessThan(0.03);
  });
  it('fewer stops lack coordinates than before the feed (1122)', () => {
    const missing = data.lines.reduce((n, l) => n + l.directions.reduce((m, d) => m + d.stops.filter((s) => s.lat === undefined).length, 0), 0);
    expect(missing).toBeLessThan(850);
  });
  it('typing a town offers "all stops" first, before single stops', () => {
    for (const q of ['funchal', 'santana', 'machico', 'santa cruz', 'ribeira brava', 'câmara de lobos', 'porto moniz', 'são vicente', 'calheta', 'ponta do sol']) {
      const first = suggest(net, data.lines, q)[0];
      expect(first.group, q).toBe(true);
      expect(first.key.startsWith('@muni:')).toBe(true);
    }
    expect(suggest(net, data.lines, 'pinga')[0].group).toBeFalsy();
  });
  it('the group resolves to the stops of the municipality only', () => {
    const santana = resolveNodes(net, '', '@muni:Santana');
    const funchal = resolveNodes(net, '', '@muni:Funchal');
    expect(santana.size).toBeGreaterThan(5);
    expect(funchal.size).toBeGreaterThan(santana.size);
    for (const id of santana) expect(net.nodes[id].muni).toBe('Santana');
    expect([...santana].some((id) => funchal.has(id))).toBe(false);
  });
  it('connections from "all stops of Santana" to "all stops of Funchal" leave from several Santana stops, in time order', () => {
    const trips = servicesFor(net, data.lines, { y: 2026, m: 10, d: 19 }, true, ['Funchal']);
    const p = plan(net, trips, resolveNodes(net, '', '@muni:Santana'), resolveNodes(net, '', '@muni:Funchal'), 8 * 60);
    expect(p.direct.length).toBeGreaterThan(1);
    for (let i = 1; i < p.direct.length; i++) expect(p.direct[i].depart).toBeGreaterThanOrEqual(p.direct[i - 1].depart);
    expect(new Set(p.direct.map((x) => x.legs[0].trip.nodes[x.legs[0].fromPos])).size).toBeGreaterThan(1);
  });
  it('direction variants are translated', () => {
    expect(variantLabel('up', 'cs')).toBe('Nahoru');
    expect(variantLabel('up', 'en')).toBe('Uphill');
    expect(variantLabel('down', 'cs')).toBe('Dolů');
    expect(variantLabel('via Campanário e Adega', 'cs')).toBe('přes Campanário e Adega');
    expect(variantLabel('up', 'pt')).toBe('Subida');
  });
});

describe.skipIf(!existsSync(file))('OpenStreetMap stops, parishes, map picking, shape ends (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const net = buildNetwork(data.lines);
  const m = (a: [number, number], b: [number, number]) => Math.hypot((a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180), (a[0] - b[0]) * 110540);
  const stopsNamed = (re: RegExp) => data.lines.flatMap((l) => l.directions.flatMap((d) => d.stops.filter((s) => re.test(s.name))));

  it('the OSM extract is on Madeira and complete enough', () => {
    const osm: { stops: { lat: number; lon: number }[] } = JSON.parse(readFileSync('data/osm/stops.json', 'utf8'));
    expect(osm.stops.length).toBeGreaterThan(3000);
    for (const s of osm.stops) {
      expect(s.lat).toBeGreaterThan(32.3);
      expect(s.lat).toBeLessThan(33.3);
      expect(s.lon).toBeGreaterThan(-17.4);
      expect(s.lon).toBeLessThan(-16.2);
    }
  });
  it('Cabo Girão, Seixal and the airport now have a position on the map', () => {
    const at = (re: RegExp) => stopsNamed(re).filter((s) => s.lat !== undefined);
    expect(at(/^Cabo Girão/).length).toBeGreaterThan(0);
    expect(m([at(/^Cabo Girão/)[0].lat!, at(/^Cabo Girão/)[0].lon!], [32.657944, -17.005213])).toBeLessThan(150);
    expect(at(/^Seixal/).length).toBeGreaterThan(0);
    expect(m([at(/^Seixal/)[0].lat!, at(/^Seixal/)[0].lon!], [32.8257, -17.1066])).toBeLessThan(1500);
    const ap = stopsNamed(/^Aeroporto$/).filter((s) => s.lat !== undefined);
    expect(ap.length).toBeGreaterThan(0);
    expect(m([ap[0].lat!, ap[0].lon!], [32.6931, -16.7753])).toBeLessThan(500);
  });
  it('stops placed from OSM are marked approximate and lie on Madeira', () => {
    const osmStops = data.lines.flatMap((l) => l.directions.flatMap((d) => d.stops.filter((s) => (s as { source?: string }).source === 'osm')));
    expect(osmStops.length).toBeGreaterThan(200);
    for (const s of osmStops) {
      expect(s.approx).toBe(true);
      expect(s.lat!).toBeGreaterThan(32.3);
    }
  });
  it('the drawn route starts and ends at the first / last stop (at most 2 directions disagree by over 30 m)', () => {
    let checked = 0;
    const bad: string[] = [];
    for (const l of data.lines) {
      l.directions.forEach((d, i) => {
        const f = `public/data/shapes/${d.shapeId}.json`;
        if (d.shapeId == null || !d.stops.length || !existsSync(f)) return;
        const poly: [number, number][] = JSON.parse(readFileSync(f, 'utf8'));
        checked++;
        for (const [s, p] of [[d.stops[0], poly[0]], [d.stops.at(-1)!, poly.at(-1)!]] as const) {
          if (s.lat !== undefined && !s.approx && m([s.lat, s.lon!], p) > 30) bad.push(`${l.number}/${i}`);
        }
      });
    }
    expect(checked).toBeGreaterThan(100);
    expect(bad.length, bad.join(', ')).toBeLessThanOrEqual(2);
  });
  it('Pico do Areeiro: the line leaves exactly from the Teleférico-Término pin', () => {
    const line = data.lines.find((l) => l.id === 9001)!;
    const d = line.directions[0];
    const poly: [number, number][] = JSON.parse(readFileSync(`public/data/shapes/${d.shapeId}.json`, 'utf8'));
    expect(m([d.stops[0].lat!, d.stops[0].lon!], poly[0])).toBeLessThan(1);
    expect(m([32.647323, -16.902838], poly[0])).toBeLessThan(5);
    const back = line.directions[1];
    const polyBack: [number, number][] = JSON.parse(readFileSync(`public/data/shapes/${back.shapeId}.json`, 'utf8'));
    expect(m([back.stops.at(-1)!.lat!, back.stops.at(-1)!.lon!], polyBack.at(-1)!)).toBeLessThan(1);
  });
  it('parishes are offered as "all stops of …", municipality groups first', () => {
    for (const [q, name] of [['curral das freiras', 'Curral das Freiras'], ['caniço', 'Caniço'], ['camacha', 'Camacha'], ['ponta do pargo', 'Ponta do Pargo']] as const) {
      const s = suggest(net, data.lines, q);
      const g = s.find((x) => x.group && x.name === name);
      expect(g, q).toBeTruthy();
      expect(g!.key).toBe('@par:' + name);
      const ids = resolveNodes(net, '', g!.key);
      expect(ids.size, q).toBeGreaterThanOrEqual(2);
      for (const id of ids) expect(net.nodes[id].par).toBe(name);
    }
    const s = suggest(net, data.lines, 'santa cruz');
    expect(s[0].key).toBe('@muni:Santa Cruz');
  });
  it('a stop with the same name as its group is not listed twice', () => {
    for (const q of ['porto moniz', 'curral das freiras', 'caniço', 'camacha']) {
      const s = suggest(net, data.lines, q);
      const g = s.filter((x) => x.group);
      expect(g.length, q).toBeGreaterThan(0);
      for (const x of s.filter((y) => !y.group)) {
        const same = g.some((y) => y.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() === x.key);
        if (same) expect.fail(`${q}: stop "${x.name}" duplicates its group`);
      }
    }
  });
  it('tapping the map picks the nearest stop within 1 km, nothing at sea', () => {
    const stop = net.nodes.find((n) => n.key === 'cabo girao' && n.lat !== undefined)!;
    const hit = nearestNode(net, stop.lat! + 0.0008, stop.lon! + 0.0004, 1000);
    expect(hit?.node.key).toBe('cabo girao');
    expect(hit!.metres).toBeLessThan(150);
    expect(nearestNode(net, 32.45, -16.5, 1000)).toBeNull();
  });
  it('planner form survives the URL round trip, ignores bad values', () => {
    const f = { from: { text: 'Santana (všechny zastávky)', key: '@muni:Santana' }, to: { text: 'Funchal', key: null }, time: '07:45', date: '2026-12-08', type: 'interurbano' as const, directOnly: true };
    const back = formFromQuery('?' + formToQuery(f), 600);
    expect(back).toEqual(f);
    expect(formFromQuery('?date=2026-02-31&time=25:99&type=zzz', 600)).toMatchObject({ date: null, time: '10:00', type: 'all' });
    expect(formToQuery(formFromQuery('', 600))).toBe('');
  });
  it('a chosen holiday date uses the Sunday timetable, the next day the weekday one', () => {
    const hol = servicesFor(net, data.lines, { y: 2026, m: 12, d: 8 }, false, ['Funchal']).filter((t) => t.times[0]! >= 0 && t.times[0]! < 1440).length;
    const wd = servicesFor(net, data.lines, { y: 2026, m: 12, d: 9 }, false, ['Funchal']).filter((t) => t.times[0]! >= 0 && t.times[0]! < 1440).length;
    expect(serviceDay({ y: 2026, m: 12, d: 8 }).reason).toBe('holiday');
    expect(hol).toBeLessThan(wd);
  });
});

describe.skipIf(!existsSync(file))('position precision and parishes of intercity lines (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const net = buildNetwork(data.lines);
  const stops = data.lines.flatMap((l) => l.directions.flatMap((d) => d.stops));
  const m = (a: [number, number], b: [number, number]) => Math.hypot((a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180), (a[0] - b[0]) * 110540);

  it('every positioned stop has a precision; only the four known values occur', () => {
    const kinds = new Set<string>();
    for (const s of stops) {
      if (s.lat === undefined) expect(s.locationPrecision).toBeUndefined();
      else kinds.add(String(s.locationPrecision));
    }
    expect([...kinds].sort()).toEqual(['exact', 'interpolated', 'name_match', 'settlement_center']);
  });
  it('precision follows the source: village centres are settlement_center, interpolated stops interpolated, official ones exact', () => {
    for (const s of stops) {
      if (s.isEstimatedLocation) expect(s.locationPrecision).toBe('interpolated');
      if ((s as { source?: string }).source === 'gtfs') expect(s.locationPrecision).toBe('exact');
    }
    const centres = stops.filter((s) => s.locationPrecision === 'settlement_center');
    expect(centres.length).toBeGreaterThan(100);
    for (const s of centres) expect(s.approx).toBe(true);
    expect(stops.find((s) => s.name === 'Seixal')?.locationPrecision).toBe('settlement_center');
  });
  it('Encumeada is the saddle Boca da Encumeada, not the tunnel', () => {
    const e = stops.filter((s) => s.name === 'Encumeada');
    expect(e.length).toBeGreaterThan(0);
    for (const s of e) {
      expect(m([s.lat!, s.lon!], [32.7543, -17.0189])).toBeLessThan(5);
      expect(s.locationPrecision).toBe('exact');
    }
  });
  it('Caniçal (line 702) is two stops in the Caniçal parish and offered as a group', () => {
    const par = stops.filter((s) => s.par === 'Caniçal').map((s) => s.name);
    expect(par).toContain('Caniçal');
    expect(par.some((n) => /Abra/.test(n))).toBe(true);
    const g = suggest(net, data.lines, 'caniçal').find((x) => x.group);
    expect(g?.key).toBe('@par:Caniçal');
    expect(resolveNodes(net, '', g!.key).size).toBeGreaterThanOrEqual(2);
    // the town stop is not placed on the stop of Baía d'Abra 3 km away
    const town = stops.find((s) => s.name === 'Caniçal')!;
    expect(m([town.lat!, town.lon!], [32.743124, -16.701429])).toBeGreaterThan(2000);
  });
  it('texts: no HTML entities, no names in capitals except abbreviations', () => {
    expect(readFileSync(file, 'utf8')).not.toMatch(/&#?\w+;/);
    const names = new Set<string>();
    for (const l of data.lines) for (const d of l.directions) for (const t of [d.from, d.to, d.route, ...d.stops.map((x) => x.name)]) t && names.add(t);
    const shouting = [...names].filter((n) => /[A-ZÀ-Ý]/.test(n) && !/[a-zà-ÿ]/.test(n));
    // only the abbreviations of the timetables (route codes, "G N R", "CAM STO A, BC ESCL, S")
    expect(shouting.filter((n) => !/\d|^[A-Z ,]{1,30}$/.test(n))).toEqual([]);
    expect(names.has("Baía d'Abra")).toBe(true);
    expect(names.has('Caniçal')).toBe(true);
  });
  it('cleanName: Title Case with Portuguese small words and kept abbreviations', () => {
    expect(cleanName("Caniçal - Baía D&#039;Abra")).toBe("Caniçal - Baía d'Abra");
    expect(cleanName('CANIÇAL')).toBe('Caniçal');
    expect(cleanName("BAÇA D'ABRA")).toBe("Baía d'Abra");
    expect(cleanName('CENTRO - CAMPO DE CIMA/LAPEIRA')).toBe('Centro - Campo de Cima/Lapeira');
    expect(cleanName('PORTO DA CRUZ E AREIA')).toBe('Porto da Cruz e Areia');
    expect(cleanName('CAM LOMBADA ESCL')).toBe('CAM Lombada ESCL');
    expect(cleanName('T-81')).toBe('T-81');
    expect(JSON.parse(decodeEntitiesInJson('{"a":"D&#039;Abra &amp; Co"}')).a).toBe("D'Abra & Co");
    expect(JSON.parse(decodeEntitiesInJson('{"a":"&quot;x&quot;"}')).a).toBe('"x"');
  });
  it('walk: 4 km/h, about 70 m per minute', () => {
    const w = walkTo({ lat: 32.65, lon: -16.9 }, { lat: 32.65 + 280 / 111000, lon: -16.9 });
    // 280 m straight x 1.3 for winding roads = ~364 m -> 5 min
    expect(w!.m).toBeGreaterThan(355);
    expect(w!.m).toBeLessThan(375);
    expect(w!.min).toBe(5);
    expect(walkTo({ lat: 32.65, lon: -16.9 }, { lat: 32.65, lon: -16.9 })!.min).toBe(1);
    expect(walkTo(undefined, { lat: 1, lon: 1 })).toBeNull();
    expect(walkTo({ lat: 1, lon: 1 }, {})).toBeNull();
  });
  it('names: two-letter Portuguese words are lower case, initials stay', () => {
    expect(cleanName('RUA NO CAMINHO EM BAIXO')).toBe('Rua no Caminho em Baixo');
    expect(cleanName('IGREJA DA FAJA AO MAR')).toBe('Igreja da Faja ao Mar');
    expect(cleanName('NA PONTA')).toBe('Na Ponta');
    expect(cleanName('G N R')).toBe('G N R');
  });
  it('router: with a walk to the stop, a bus leaving too early is not offered', () => {
    const mk = (times: number[]): Trip => ({ line: { id: 1 } as Trip['line'], dirIndex: 0, dir: {} as Trip['dir'], nodes: [0, 1], times, estimated: false });
    const trips = [mk([14 * 60 + 5, 14 * 60 + 30]), mk([14 * 60 + 15, 14 * 60 + 40]), mk([14 * 60 + 10, 14 * 60 + 35])];
    const walk = new Map([[0, 10]]);
    const start = 14 * 60;
    const dep = (w?: Map<number, number>) => direct(trips, new Set([0]), new Set([1]), start, w).map((x) => x.depart);
    expect(dep()).toEqual([14 * 60 + 5, 14 * 60 + 10, 14 * 60 + 15]);
    expect(dep(walk)).toEqual([14 * 60 + 10, 14 * 60 + 15]); // 14:05 would be missed, 14:10 is just made
    expect(dep(new Map([[0, 16]]))).toEqual([]);
  });
  it('planner URL keeps the picked map points', () => {
    const f = formFromQuery('?from=Pinga&fk=pinga&fp=32.65001,-16.90002&to=Funchal&tp=32.7,-16.95', 600);
    expect(f.from.pt).toEqual({ lat: 32.65001, lon: -16.90002 });
    expect(f.to.pt).toEqual({ lat: 32.7, lon: -16.95 });
    const back = formFromQuery('?' + formToQuery(f), 600);
    expect(back.from.pt).toEqual(f.from.pt);
    expect(back.to.pt).toEqual(f.to.pt);
    expect(formFromQuery('?from=a&fp=xx', 600).from.pt).toBeUndefined();
  });
});
