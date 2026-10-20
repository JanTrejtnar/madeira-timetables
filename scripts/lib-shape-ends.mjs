// Makes the drawn route polyline start and end exactly at the first / last stop (the pins on the map). Shapes come from
// SIGA / OSRM and may stop a few metres short of the stop: the stop position is added as the first / last vertex.
// A bigger gap (over MAX_GAP_M) means the sources disagree about where the stop is; it is left as is and reported.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_GAP_M = 120;
const MIN_GAP_M = 1;
const metres = (a, b) => Math.hypot((a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180), (a[0] - b[0]) * 110540);
const has = (s) => s.lat !== undefined && s.lon !== undefined;

/** Rewrites the shape files in `dir` (the copies in public/). Returns { joined, skipped: ["line/dir: start|end gap m"], maxGapM }. */
export async function snapShapeEnds(lines, dir) {
  let joined = 0;
  const skipped = [];
  const done = new Map();
  for (const l of lines) {
    for (const [i, d] of l.directions.entries()) {
      if (d.shapeId == null || !d.stops.length) continue;
      const f = path.join(dir, `${d.shapeId}.json`);
      if (!existsSync(f)) continue;
      const poly = done.get(f) ?? JSON.parse(await readFile(f, 'utf8'));
      let changed = false;
      const a = d.stops[0];
      const b = d.stops[d.stops.length - 1];
      for (const [stop, atStart] of [[a, true], [b, false]]) {
        if (!has(stop) || stop.approx) continue;
        const p = [+stop.lat.toFixed(6), +stop.lon.toFixed(6)];
        const end = atStart ? poly[0] : poly[poly.length - 1];
        const gap = metres(p, end);
        if (gap < MIN_GAP_M) continue;
        if (gap > MAX_GAP_M) { skipped.push(`${l.number}/${i} ${atStart ? 'start' : 'end'} ${Math.round(gap)} m`); continue; }
        if (atStart) poly.unshift(p); else poly.push(p);
        joined++;
        changed = true;
      }
      done.set(f, poly);
      if (changed) await writeFile(f, JSON.stringify(poly));
    }
  }
  return { joined, skipped, maxGapM: MAX_GAP_M };
}
