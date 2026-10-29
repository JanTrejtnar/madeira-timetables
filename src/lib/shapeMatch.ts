// Stops -> points of a route polyline. The stops of a trip stand in driving order, so their indices along the polyline must not decrease;
// among all such assignments the one with the smallest total distance wins. A greedy "nearest point from the previous one on" is not
// enough: a stop that is not on the polyline at all (the polyline was trimmed to the stretch the trip runs, a side road was cut out, an
// estimated position) would snap to some far point and drag every following stop after it.
import { metres } from '../../shared/geo.mjs';

type Pt = [number, number];

/** a stop further than this from every point of the polyline costs the same wherever it is placed: it has no say in the others */
const FAR_M = 2000;

/** Index into `shape` of each stop (null for a stop without a position); the indices never decrease. */
export function matchStopsToShape(shape: readonly Pt[], stops: readonly (Pt | null)[]): (number | null)[] {
  const rows = stops.flatMap((s, i) => (s ? [i] : []));
  const out: (number | null)[] = stops.map(() => null);
  const m = shape.length;
  if (!rows.length || !m) return out;
  // back[r][j]: the index chosen for the previous stop when stop r sits at j
  const back = rows.map(() => new Int32Array(m));
  let prev = new Float64Array(m);
  for (let r = 0; r < rows.length; r++) {
    const s = stops[rows[r]]!;
    const cur = new Float64Array(m);
    let bestVal = Infinity;
    let bestAt = 0;
    for (let j = 0; j < m; j++) {
      // best of the previous stop at any index <= j (the earliest on a tie)
      if (r > 0 && prev[j] < bestVal) { bestVal = prev[j]; bestAt = j; }
      cur[j] = (r > 0 ? bestVal : 0) + Math.min(metres(shape[j], s), FAR_M);
      back[r][j] = bestAt;
    }
    prev = cur;
  }
  let j = 0;
  for (let k = 1; k < m; k++) if (prev[k] < prev[j]) j = k;
  for (let r = rows.length - 1; r >= 0; r--) {
    out[rows[r]] = j;
    j = back[r][j];
  }
  return out;
}
