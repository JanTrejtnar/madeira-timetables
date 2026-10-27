import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Dataset } from '../src/types';

// reads hundreds of shape files: with 23 parallel workers the default 5 s limit was exceeded now and then
vi.setConfig({ testTimeout: 30000 });

const file = 'public/data/schedules.json';
const m = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180));
/** known directions whose line is not drawn up to the stop pin (see scripts/audit-shape-ends.mjs) */
const KNOWN = new Set(['049#2', '049#3', '142#1']);

describe.skipIf(!existsSync(file))('the drawn line reaches the end stops (run `npm run build:data` first)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const shape = (id: number): [number, number][] => JSON.parse(readFileSync(`public/data/shapes/${id}.json`, 'utf8'));

  it('line 6 (Falca) and the Pico do Areeiro shuttle end exactly on their last stop', () => {
    for (const d of [...data.lines.find((l) => l.number === '6')!.directions, ...data.lines.find((l) => l.number === 'HF Areeiro')!.directions]) {
      const s = shape(d.shapeId!);
      const first = d.stops.find((x) => x.lat !== undefined)!;
      const last = [...d.stops].reverse().find((x) => x.lat !== undefined)!;
      expect(m(s[0], [first.lat!, first.lon!])).toBeLessThan(30);
      expect(m(s.at(-1)!, [last.lat!, last.lon!])).toBeLessThan(30);
    }
  });
  it('line 6 passes Falca (32.79681, -16.96904) in both directions', () => {
    for (const d of data.lines.find((l) => l.number === '6')!.directions) expect(Math.min(...shape(d.shapeId!).map((p) => m(p, [32.79681, -16.96904])))).toBeLessThan(30);
  });
  it('every direction: first and last stop within 120 m of the line ends', () => {
    const bad: string[] = [];
    for (const l of data.lines) {
      l.directions.forEach((d, i) => {
        if (d.shapeId === null || !existsSync(`public/data/shapes/${d.shapeId}.json`) || KNOWN.has(`${l.number}#${i}`)) return;
        const placed = d.stops.filter((x) => x.lat !== undefined);
        if (!placed.length) return;
        const s = shape(d.shapeId);
        const a = placed[0];
        const z = placed.at(-1)!;
        if (m(s[0], [a.lat!, a.lon!]) > 120 || m(s.at(-1)!, [z.lat!, z.lon!]) > 120) bad.push(`${l.number}#${i}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
