// Google Maps style route drawing: of the polyline of a line only the stretch the traveller rides is drawn in full colour,
// the rest (before boarding, after getting off) is faint or hidden.
type Pt = [number, number];

const sq = (p: readonly number[], q: readonly number[]) => (p[0] - q[0]) ** 2 + ((p[1] - q[1]) * 0.84) ** 2;

export interface RideSplit {
  before: Pt[];
  ride: Pt[];
  after: Pt[];
}

/**
 * Splits `shape` at the points nearest to stop `from` and stop `to` of the trip (`stops` = [lat, lon] of every stop, null where unknown).
 * The stops are matched to the polyline in order, so a line that passes the same place twice is cut at the right pass.
 * null when either stop has no position or the stretch is empty (the caller then draws the whole line).
 */
export function rideSplit(shape: readonly Pt[], stops: readonly (Pt | null)[], from: number, to: number): RideSplit | null {
  let at = 0;
  const idx = stops.map((s) => {
    if (!s) return null;
    let best = at;
    let bd = Infinity;
    for (let i = at; i < shape.length; i++) {
      const d = sq(shape[i], s);
      if (d < bd) { bd = d; best = i; }
    }
    return (at = best);
  });
  const a = idx[from];
  const b = idx[to];
  if (a == null || b == null || b <= a) return null;
  return { before: shape.slice(0, a + 1) as Pt[], ride: shape.slice(a, b + 1) as Pt[], after: shape.slice(b) as Pt[] };
}
