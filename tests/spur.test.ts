import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cutSpurs, type TripStopPt } from '../src/lib/spur';
import type { Dataset } from '../src/types';

type Pt = [number, number];
const M_LAT = 110540;
const M_LON = 111320 * 0.84;
const dist = (a: Pt, b: Pt) => Math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON);
const length = (s: Pt[]) => s.slice(1).reduce((n, p, i) => n + dist(s[i], p), 0);
/** distance from the point to the polyline (to its segments: a thinned shape has long segments between vertices) */
const nearest = (s: Pt[], p: Pt) => {
  const toSegment = (a: Pt, b: Pt) => {
    const [ax, ay, bx, by, px, py] = [a[1] * M_LON, a[0] * M_LAT, b[1] * M_LON, b[0] * M_LAT, p[1] * M_LON, p[0] * M_LAT];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const u = len2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2)) : 0;
    return Math.hypot(px - (ax + u * (bx - ax)), py - (ay + u * (by - ay)));
  };
  return s.length === 1 ? dist(s[0], p) : Math.min(...s.slice(1).map((q, i) => toSegment(s[i], q)));
};

// a straight road east (0 .. 4000 m) with a side road to the north at 2000 m (1000 m out, the same way back)
const road = (n: number, f: (i: number) => Pt) => Array.from({ length: n }, (_, i) => f(i));
const metresE = (m: number): Pt => [32.7, -17 + m / M_LON];
const metresN = (x: number, y: number): Pt => [32.7 + y / M_LAT, -17 + x / M_LON];
const main1 = road(21, (i) => metresE(i * 100));
const spur = [...road(10, (i) => metresN(2000, (i + 1) * 100)), ...road(10, (i) => metresN(2000, (10 - i - 1) * 100))];
const withSpur: Pt[] = [...main1.slice(0, 21).filter((_, i) => i <= 20 && metresE(i * 100)[1] <= -17 + 2000 / M_LON + 1e-9), ...spur, ...road(10, (i) => metresE(2000 + (i + 1) * 200)).slice(0)];
const stopsOf = (calls: boolean[]): TripStopPt[] => [
  { at: metresE(0), calls: true },
  { at: metresN(2000, 1000), calls: calls[0] },
  { at: metresE(4000), calls: true },
];

describe('cutSpurs', () => {
  it('cuts the side road out when the trip skips its stop', () => {
    const cut = cutSpurs(withSpur, stopsOf([false]));
    expect(length(cut)).toBeLessThan(length(withSpur) - 1500);
    expect(nearest(cut, metresN(2000, 1000))).toBeGreaterThan(900);
    expect(cut[0]).toEqual(withSpur[0]);
    expect(cut.at(-1)).toEqual(withSpur.at(-1));
  });
  it('keeps it when the trip calls there', () => {
    expect(cutSpurs(withSpur, stopsOf([true]))).toBe(withSpur);
  });
  it('keeps a hairpin: the way back is another road, not the same one', () => {
    // up the hill and down again 120 m to the side (a switchback), the skipped stop at its tip
    const up = road(12, (i) => metresN(2000, i * 100));
    const down = road(12, (i) => metresN(2120, (11 - i) * 100));
    const hair: Pt[] = [...road(20, (i) => metresE(i * 100)), ...up, ...down, ...road(10, (i) => metresN(2120 + (i + 1) * 200, 0))];
    const stops: TripStopPt[] = [{ at: hair[0], calls: true }, { at: metresN(2000, 1100), calls: false }, { at: hair.at(-1)!, calls: true }];
    expect(cutSpurs(hair, stops)).toBe(hair);
  });
});

const file = 'public/data/schedules.json';
describe.skipIf(!existsSync(file))('cutSpurs on the real data', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const shapeOf = (id: number): Pt[] => JSON.parse(readFileSync(`public/data/shapes/${id}.json`, 'utf8'));

  it('line 139, 07:35 from Funchal skips Ginjas: the road line does not drive the 3.6 km side road', () => {
    const dir = data.lines.find((l) => l.number === '139')!.directions[2];
    const trip = dir.trips!.find((t) => t.times[0] === '07:35')!;
    const shape = shapeOf(dir.shapeId!);
    const stops = dir.stops.flatMap((s, i) => (s.lat !== undefined ? [{ at: [s.lat, s.lon!] as Pt, calls: trip.times[i] !== null }] : []));
    expect(dir.stops[12].name).toBe('Ginjas');
    expect(trip.times[12]).toBeNull();
    const cut = cutSpurs(shape, stops);
    expect(length(shape) - length(cut)).toBeGreaterThan(3000);
    const ginjas = dir.stops[12];
    expect(nearest(cut, [ginjas.lat!, ginjas.lon!])).toBeGreaterThan(300);
    // a trip that calls at Ginjas keeps the whole line
    const all = stops.map((s) => ({ ...s, calls: true }));
    expect(cutSpurs(shape, all)).toBe(shape);
  });

  it('every trip pattern of every line: the stops the trip calls at stay on the line (a cut never removes a called stop)', () => {
    let cuts = 0;
    for (const l of data.lines) {
      for (const dir of l.directions) {
        if (dir.shapeId === null || !dir.trips?.length) continue;
        const shape = shapeOf(dir.shapeId);
        const seen = new Set<string>();
        for (const t of dir.trips) {
          const key = t.times.map((x) => (x === null ? 0 : 1)).join('');
          if (seen.has(key) || !key.includes('0')) continue;
          seen.add(key);
          const stops = dir.stops.flatMap((s, i) => (s.lat !== undefined ? [{ at: [s.lat, s.lon!] as Pt, calls: t.times[i] !== null }] : []));
          const cut = cutSpurs(shape, stops);
          if (cut === shape) continue;
          cuts++;
          for (const s of stops) if (s.calls && nearest(shape, s.at) < 60) expect(nearest(cut, s.at), `${l.number} ${dir.from}->${dir.to} ${s.at}`).toBeLessThan(60);
        }
      }
    }
    expect(cuts).toBeGreaterThan(0);
  }, 120_000);
});
