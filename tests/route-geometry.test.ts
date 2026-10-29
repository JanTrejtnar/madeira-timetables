// The route line must pass the places a trip serves. Two ways it silently did not: a detour through "Via" places whose anchors no longer
// fit the (redrawn) route of the direction is skipped by spliceDetours, and a stop that no road of the generated route touches hangs in the terrain.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { spliceDetours } from '../src/lib/via';
import { OFF_ROAD_MAX_M, OFF_ROAD_MIN_M, offRoadLinks } from '../src/lib/offRoad';
import { metres } from '../shared/geo.mjs';
import type { Dataset, ViaRoutes } from '../src/types';

type Pt = [number, number];

describe('offRoadLinks', () => {
  const road: Pt[] = [[32.7, -17], [32.7, -16.99], [32.7, -16.98]];
  it('joins a stop beside the road to the nearest point of it', () => {
    const [[stop, at]] = offRoadLinks(road, [[32.7 + 0.002, -16.995]]);
    expect(stop).toEqual([32.7 + 0.002, -16.995]);
    expect(at[0]).toBeCloseTo(32.7, 6);
    expect(at[1]).toBeCloseTo(-16.995, 6);
  });
  it('leaves stops on the road and a stop that is hopelessly far (a wrong position) alone', () => {
    expect(offRoadLinks(road, [[32.7 + (OFF_ROAD_MIN_M - 20) / 110540, -16.99]])).toEqual([]);
    expect(offRoadLinks(road, [[32.7 + (OFF_ROAD_MAX_M + 500) / 110540, -16.99]])).toEqual([]);
  });
  it('the link ends at the end of the line, not beyond it', () => {
    const [[, at]] = offRoadLinks(road, [[32.7, -16.97]]);
    expect(metres(at, road[2])).toBeLessThan(1);
  });
});

const file = 'public/data/schedules.json';
describe.skipIf(!existsSync(file))('detours through "Via" places on the real data', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  it('every stored detour fits the route of its direction (else the map would not draw it)', () => {
    const stale: string[] = [];
    let checked = 0;
    for (const l of data.lines) {
      const vf = `public/data/via/${l.id}.json`;
      if (!l.hasViaRoutes || !existsSync(vf)) continue;
      const routes: ViaRoutes = JSON.parse(readFileSync(vf, 'utf8'));
      for (const [key, r] of Object.entries(routes)) {
        const di = Number(key.split('|')[1]);
        const d = l.directions[di];
        if (d?.shapeId == null || !existsSync(`public/data/shapes/${d.shapeId}.json`)) continue;
        const shape: Pt[] = JSON.parse(readFileSync(`public/data/shapes/${d.shapeId}.json`, 'utf8'));
        const mid = r.pts[Math.floor(r.pts.length / 2)];
        checked++;
        if (!spliceDetours(shape, [r]).some((p) => p[0] === mid[0] && p[1] === mid[1])) stale.push(`${l.number} ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(50);
    // `npm run fetch:via-routes` draws them again
    expect(stale).toEqual([]);
  });
});
