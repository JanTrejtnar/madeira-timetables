import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSegment } from '../src/lib/overview';
import { parseFoot, straightM } from '../src/lib/foot';
import { buildNetwork, nodesNearPoint, suggest } from '../src/lib/network';
import { OPERATORS, operatorOf } from '../src/lib/operators';
import { buildPlaceIndex, searchPlaces, type PlaceRow } from '../src/lib/places';
import { addRecent, parseTrips, RECENT_MAX, sameTrip, toggleFavorite, type SavedTrip } from '../src/lib/trips-store';
import type { Dataset } from '../src/types';

const file = 'public/data/schedules.json';
const poiFile = 'public/data/pois.json';

describe.skipIf(!existsSync(poiFile))('places of interest (real data)', () => {
  const ix = buildPlaceIndex((JSON.parse(readFileSync(poiFile, 'utf8')) as { places: PlaceRow[] }).places);
  const top = (q: string) => searchPlaces(ix, q, 5).map((h) => `${h.place.name}|${h.place.kind}`);

  it('finds the famous destinations by name, by a typo-free prefix and by their English / Czech names', () => {
    expect(top('Cristo Rei')[0]).toBe('Cristo Rei (Garajau)|viewpoint');
    expect(top('pico do arieiro')[0]).toBe('Pico do Arieiro|peak');
    expect(top('pico do areeiro')[0]).toBe('Pico do Arieiro|peak');
    expect(top('cabo gir')[0]).toBe('Cabo Girão|viewpoint');
    expect(top('Christ the King')[0]).toBe('Cristo Rei (Garajau)|viewpoint');
    expect(top('farmers market')[0]).toBe('Mercado dos Lavradores|market');
  });
  it('offers beaches, ports, malls and levadas with their category', () => {
    const kinds = (q: string) => new Set(searchPlaces(ix, q, 20).map((h) => h.place.kind));
    expect(kinds('praia').has('beach')).toBe(true);
    expect(kinds('marina').has('harbor')).toBe(true);
    expect(kinds('shopping').has('mall')).toBe(true);
    expect(kinds('levada').has('levada')).toBe(true);
  });
  it('knows the airport and the towns', () => {
    expect(top('airport')[0]).toMatch(/\|airport$/);
    expect(top('machico').some((x) => x.endsWith('|town') || x.endsWith('|village'))).toBe(true);
  });
  it('returns nothing for one letter or for gibberish', () => {
    expect(searchPlaces(ix, 'a')).toEqual([]);
    expect(searchPlaces(ix, 'qzxqzxqzx')).toEqual([]);
  });
});

const cabo = existsSync(poiFile) ? ((JSON.parse(readFileSync(poiFile, 'utf8')) as { places: PlaceRow[] }).places.filter((p) => p[0] === 'Cabo Girão' && p[1] === 'viewpoint').map((p) => [p[2], p[3]])[0] ?? [0, 0]) : [0, 0];

describe.skipIf(!existsSync(file))('picked places and the network (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const net = buildNetwork(data.lines, data.terminalWalks);

  it('finds the stops within walking distance of a place, nearest first, one per name', () => {
    const r = nodesNearPoint(net, 32.6389, -16.847); // Cristo Rei
    expect(r.nodes.length).toBeGreaterThan(0);
    expect(r.nodes.length).toBeLessThanOrEqual(8);
    const m = r.nodes.map((x) => x.metres);
    expect(m).toEqual([...m].sort((a, b) => a - b));
    expect(new Set(r.nodes.map((x) => x.node.key)).size).toBe(r.nodes.length);
    if (!r.widened) expect(m.at(-1)!).toBeLessThanOrEqual(900);
  });
  it('Cabo Girão is by the viewpoint: a stop within 150 m', () => {
    const r = nodesNearPoint(net, ...(cabo as [number, number]));
    expect(r.widened).toBe(false);
    expect(r.nodes[0].metres).toBeLessThanOrEqual(150);
  });
  it('widens the radius where no stop is near and returns nothing in the open sea', () => {
    const peak = nodesNearPoint(net, 32.7353, -16.9281); // Pico do Arieiro: the nearest stops are far
    if (peak.nodes.length) expect(peak.nodes[0].metres).toBeLessThanOrEqual(2200);
    expect(nodesNearPoint(net, 32.3, -17.6).nodes).toEqual([]);
  });
  it('still suggests the stops with the old ranking', () => {
    expect(suggest(net, data.lines, 'machico').some((s) => /machico/i.test(s.name))).toBe(true);
  });
});

describe.skipIf(!existsSync(file))('operators of the catalogue (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const numbers = (op: string) => data.lines.filter((l) => operatorOf(l) === op).map((l) => l.number);

  it('puts every line in exactly one of the four sections', () => {
    const all = OPERATORS.flatMap((o) => numbers(o.id));
    expect(all.length).toBe(data.lines.length);
    for (const o of OPERATORS) expect(numbers(o.id).length, o.id).toBeGreaterThan(5);
  });
  it('groups the known lines by company', () => {
    expect(numbers('hf')).toEqual(expect.arrayContaining(['001', '008', '131', '181']));
    expect(numbers('rodoeste')).toEqual(expect.arrayContaining(['3', '7', '154', '221', '250']));
    expect(numbers('sam')).toEqual(expect.arrayContaining(['20', '701', '725', '825']));
    expect(numbers('cam')).toEqual(expect.arrayContaining(['551', '555', '56', '991']));
  });
});

describe('walking routes', () => {
  const a = { lat: 32.6496, lon: -16.9087 };
  const b = { lat: 32.648, lon: -16.904 };
  const ok = { code: 'Ok', routes: [{ distance: 599, geometry: { coordinates: [[-16.9086, 32.6495], [-16.9, 32.6485]] } }] };

  it('reads an OSRM answer into [lat, lon] pairs joined to the real end points', () => {
    const r = parseFoot(ok, a, b)!;
    expect(r.m).toBe(599);
    expect(r.pts[0]).toEqual([a.lat, a.lon]);
    expect(r.pts.at(-1)).toEqual([b.lat, b.lon]);
    expect(r.pts[1]).toEqual([32.6495, -16.9086]);
  });
  it('refuses answers that are no walk: errors, empty routes and absurd detours', () => {
    expect(parseFoot({ code: 'NoRoute', routes: [] }, a, b)).toBeNull();
    expect(parseFoot({ code: 'Ok', routes: [] }, a, b)).toBeNull();
    expect(parseFoot({ code: 'Ok', routes: [{ distance: 20_000, geometry: ok.routes[0].geometry }] }, a, b)).toBeNull();
    expect(parseFoot(null, a, b)).toBeNull();
    expect(straightM(a, b)).toBeGreaterThan(400);
  });
});

describe('recent and favourite trips', () => {
  const p = (text: string, key: string | null = null) => ({ text, key });
  const trip = (a: string, b: string) => ({ from: p(a, a.toLowerCase()), to: p(b, b.toLowerCase()) });

  it('keeps the newest search first, without duplicates, at most five', () => {
    let list: SavedTrip[] = [];
    for (const [i, [a, b]] of [['A', 'B'], ['C', 'D'], ['A', 'B'], ['E', 'F'], ['G', 'H'], ['I', 'J'], ['K', 'L']].entries()) list = addRecent(list, trip(a, b), i);
    expect(list.length).toBe(RECENT_MAX);
    expect(list.map((x) => x.from.text)).toEqual(['K', 'I', 'G', 'E', 'A']);
    expect(list.filter((x) => sameTrip(x, trip('A', 'B'))).length).toBe(1);
  });
  it('stars and un-stars a trip; a picked point makes it another trip', () => {
    let favs = toggleFavorite([], trip('A', 'B'), 1);
    expect(favs).toHaveLength(1);
    expect(toggleFavorite(favs, { from: { ...p('A', 'a'), pt: { lat: 32.7, lon: -16.9 } }, to: p('B', 'b') }, 2)).toHaveLength(2);
    favs = toggleFavorite(favs, trip('A', 'B'), 3);
    expect(favs).toEqual([]);
  });
  it('survives broken storage', () => {
    expect(parseTrips(null)).toEqual([]);
    expect(parseTrips('not json')).toEqual([]);
    expect(parseTrips('{"a":1}')).toEqual([]);
    expect(parseTrips(JSON.stringify([{ from: p('A'), to: p('') , at: 1 }, { from: p('A'), to: p('B', 'b'), at: 5 }]))).toEqual([{ from: p('A'), to: p('B', 'b'), at: 5 }]);
  });
});

describe('overview geometry', () => {
  it('decodes the delta encoded segments', () => {
    expect(decodeSegment([3265000, -1690000, 10, -20, 5, 5])).toEqual([[32.65, -16.9], [32.6501, -16.9002], [32.65015, -16.90015]]);
  });
});
