// The ridden stretch of a route is cut by the order of the trip's stops along the polyline: a stop that is not on the polyline
// (it was trimmed away for a short-turn trip) must not move the cut of the stops that are.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rideSplit } from '../src/lib/ride';
import { matchStopsToShape } from '../src/lib/shapeMatch';
import { cutSpurs } from '../src/lib/spur';
import { metres } from '../shared/geo.mjs';
import type { Dataset } from '../src/types';

type Pt = [number, number];
const line = (n: number): Pt[] => Array.from({ length: n }, (_, i) => [32.7, -17 + i * 0.001]);
const at = (i: number): Pt => [32.7, -17 + i * 0.001];

describe('matchStopsToShape', () => {
  it('never goes back along the polyline', () => {
    const idx = matchStopsToShape(line(50), [at(5), at(20), at(35), at(45)]) as number[];
    expect(idx).toEqual([5, 20, 35, 45]);
  });
  it('stops that lie far away from a trimmed polyline do not drag the following stops along', () => {
    // the polyline is only the stretch 100..140; the first stops of the trip (0..90 km away) are not on it
    const shape = Array.from({ length: 41 }, (_, i) => at(100 + i));
    const stops: (Pt | null)[] = [at(0), at(30), null, at(60), at(105), at(125), at(140)];
    const idx = matchStopsToShape(shape, stops);
    expect(idx.slice(4)).toEqual([5, 25, 40]);
    expect(idx[2]).toBeNull();
    // ... and the cut of boarding at stop 4 and getting off at stop 5 is the stretch between them
    const r = rideSplit(shape, stops, 4, 5)!;
    expect(r.ride[0]).toEqual(at(105));
    expect(r.ride.at(-1)).toEqual(at(125));
    expect(r.after[0]).toEqual(at(125));
  });
  it('a place passed twice: the cut follows the order of the stops', () => {
    // 0 .. 10 east, a loop that passes 5 again, then on to 20
    const shape: Pt[] = [...line(11), at(10.5), at(5.0004), ...Array.from({ length: 10 }, (_, i) => at(11 + i))];
    const idx = matchStopsToShape(shape, [at(0), at(5), at(10), at(5), at(20)]) as number[];
    expect(idx[1]).toBe(5);
    expect(idx[3]).toBe(12);
    expect(idx.every((x, i) => i === 0 || x >= idx[i - 1])).toBe(true);
  });
});

const file = 'public/data/schedules.json';
describe.skipIf(!existsSync(file))('ridden stretch on the real data', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const shapeOf = (id: number): Pt[] => JSON.parse(readFileSync(`public/data/shapes/${id}.json`, 'utf8'));
  const length = (s: Pt[]) => s.slice(1).reduce((n, p, i) => n + metres(s[i], p), 0);
  const near = (shape: Pt[], p: Pt) => Math.min(...shape.map((q) => metres(q, p)));

  it('line 6, São Vicente -> Falca, on a trip that starts at São Vicente: the ridden stretch is São Vicente..Falca, not the rest of the road', () => {
    const dir = data.lines.find((l) => l.number === '6')!.directions[0];
    const falca = dir.stops.findIndex((s) => s.name === 'Falca');
    // a trip whose first call is São Vicente (one of its two poles)
    const trip = dir.trips!.find((t) => /^São Vicente/.test(dir.stops[t.times.findIndex((x) => x !== null)].name) && t.times[falca] !== null)!;
    expect(trip).toBeTruthy();
    const sv = trip.times.findIndex((x) => x !== null);
    const shape = shapeOf(dir.shapeId!);
    const calls = dir.stops.flatMap((s, i) => (s.lat !== undefined ? [{ at: [s.lat, s.lon!] as Pt, calls: trip.times[i] !== null }] : []));
    const full = cutSpurs(shape, calls);
    const pts = dir.stops.map((s) => (s.lat !== undefined ? ([s.lat, s.lon!] as Pt) : null));
    const r = rideSplit(full, pts, sv, falca)!;
    expect(r).toBeTruthy();
    // the ridden stretch starts at São Vicente (the beginning of this trip's road) and ends at Falca, with the rest of the road after it
    expect(metres(r.ride[0], pts[sv]!)).toBeLessThan(300);
    expect(metres(r.ride.at(-1)!, pts[falca]!)).toBeLessThan(1200);
    expect(length(r.before)).toBeLessThan(500);
    expect(length(r.after)).toBeGreaterThan(0);
    expect(length(r.ride)).toBeGreaterThan(length(r.after));
  });

  it('every pair of called stops of lines 6, 80, 103, 139: the ridden stretch starts and ends at the stops, in order', () => {
    let checked = 0;
    for (const l of data.lines.filter((x) => ['6', '80', '103', '139'].includes(x.number))) {
      l.directions.forEach((dir, di) => {
        if (dir.shapeId === null || !dir.trips?.length) return;
        const shape = shapeOf(dir.shapeId);
        const pts = dir.stops.map((s) => (s.lat !== undefined ? ([s.lat, s.lon!] as Pt) : null));
        const seen = new Set<string>();
        for (const t of dir.trips) {
          const key = t.times.map((x) => (x === null ? 0 : 1)).join('');
          if (seen.has(key)) continue;
          seen.add(key);
          const calls = dir.stops.flatMap((s, i) => (s.lat !== undefined ? [{ at: [s.lat, s.lon!] as Pt, calls: t.times[i] !== null }] : []));
          const full = cutSpurs(shape, calls);
          const called = dir.stops.map((_, i) => i).filter((i) => t.times[i] !== null && pts[i] && near(full, pts[i]!) < 150);
          for (let k = 0; k < called.length; k++) {
            for (const j of [k + 1, called.length - 1]) {
              if (j <= k || j >= called.length) continue;
              const [from, to] = [called[k], called[j]];
              if (metres(pts[from]!, pts[to]!) < 150) continue;
              // as the planner hands them over: the stops the trip skips are not matched
              const r = rideSplit(full, pts.map((p, i) => (t.times[i] !== null ? p : null)), from, to);
              const tag = `${l.number} dir ${di} ${dir.stops[from].name} -> ${dir.stops[to].name} (${key})`;
              expect(r, tag).toBeTruthy();
              expect(metres(r!.ride[0], pts[from]!), `${tag} start`).toBeLessThan(300);
              expect(metres(r!.ride.at(-1)!, pts[to]!), `${tag} end`).toBeLessThan(300);
              checked++;
            }
          }
        }
      });
    }
    expect(checked).toBeGreaterThan(100);
  }, 120_000);
});
