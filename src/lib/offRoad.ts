// A stop the route line does not touch (the stop is only roughly placed, or lies on a side road the generated route did not enter):
// the line must not look as if the bus ignored the place, so the map joins the stop to the nearest point of the line with a short link.
import { MADEIRA_COS, metres } from '../../shared/geo.mjs';

type Pt = [number, number];

/** a stop closer than this to the line is simply beside the road */
export const OFF_ROAD_MIN_M = 120;
/** further away is not a side road any more but a wrong position: the link would draw a long false road, the marker alone is the honest picture */
export const OFF_ROAD_MAX_M = 3000;

/** Nearest point of the segment a-b to p (longitude scaled, so the projection is right angled), and its distance in metres. */
function onSegment(p: Pt, a: Pt, b: Pt): { at: Pt; m: number } {
  const ax = a[1] * MADEIRA_COS, ay = a[0];
  const dx = b[1] * MADEIRA_COS - ax, dy = b[0] - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[1] * MADEIRA_COS - ax) * dx + (p[0] - ay) * dy) / len2)) : 0;
  const at: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { at, m: metres(p, at) };
}

/** [stop, nearest point of the line] for every stop further than OFF_ROAD_MIN_M (and not further than OFF_ROAD_MAX_M) from the line. */
export function offRoadLinks(line: readonly Pt[], stops: readonly Pt[]): [Pt, Pt][] {
  if (line.length < 2) return [];
  const out: [Pt, Pt][] = [];
  for (const s of stops) {
    let best: { at: Pt; m: number } | null = null;
    for (let i = 0; i < line.length - 1; i++) {
      const c = onSegment(s, line[i], line[i + 1]);
      if (!best || c.m < best.m) best = c;
    }
    if (best && best.m > OFF_ROAD_MIN_M && best.m <= OFF_ROAD_MAX_M) out.push([s, best.at]);
  }
  return out;
}
