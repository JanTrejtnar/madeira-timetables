// One road polyline serves every trip of a direction, but a trip may skip stops (a dash in the timetable). When a skipped stop lies on a
// side road that the bus would drive into and out of again (Ginjas on line 139), the polyline of that trip must not make the excursion.
type Pt = [number, number];

/** a stop of the trip in driving order: where it is, and whether the trip calls there */
export interface TripStopPt {
  at: Pt;
  calls: boolean;
}

const M_LAT = 110540;
const M_LON = 111320 * 0.84;
const dist = (a: Pt, b: Pt) => Math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON);

/** the road comes back to within this distance of the junction: out and back on one road */
const JUNCTION_M = 25;
/** points of the way back that must lie on the way out (share of the sampled points) */
const RETURN_ON_ROAD_M = 20;
const RETURN_SHARE = 0.85;
/** shorter excursions are left in: the stop is beside the road */
const MIN_SPUR_M = 300;
const WINDOW = 1500;

/** Index of the shape point nearest to each stop, matched in order (a road passing the same place twice is cut at the right pass). */
function project(shape: readonly Pt[], stops: readonly TripStopPt[]): number[] {
  let at = 0;
  return stops.map((s) => {
    let best = at;
    let bd = Infinity;
    for (let i = at; i < shape.length; i++) {
      const d = dist(shape[i], s.at);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return (at = best);
  });
}

/** Out-and-back stretch around shape point `apex` between the called stops at `lo` and `hi`: [k, m] of the first and the last point of the road shared by both ways, or null. */
function spurAround(shape: readonly Pt[], apex: number, lo: number, hi: number): [number, number] | null {
  const a = Math.max(lo, apex - WINDOW);
  const b = Math.min(hi, apex + WINDOW);
  for (let k = a; k < apex; k++) {
    let m = -1;
    for (let q = b; q > apex; q--) {
      if (dist(shape[k], shape[q]) <= JUNCTION_M) {
        m = q;
        break;
      }
    }
    if (m < 0) continue;
    let len = 0;
    for (let i = k; i < m; i++) len += dist(shape[i], shape[i + 1]);
    if (len < MIN_SPUR_M) continue;
    // the way back (apex..m) follows the way out (k..apex): sampled points are within a few metres of it
    const step = Math.max(1, Math.floor((m - apex) / 40));
    let on = 0;
    let n = 0;
    for (let q = apex; q <= m; q += step) {
      n++;
      for (let i = k; i <= apex; i++) {
        if (dist(shape[q], shape[i]) <= RETURN_ON_ROAD_M) {
          on++;
          break;
        }
      }
    }
    if (n > 0 && on / n >= RETURN_SHARE) return [k, m];
  }
  return null;
}

/**
 * A short-turn trip does not run the whole road: the part before the first stop it calls at and the part after the last one are not driven.
 * Returns the shape from the first to the last called stop and the stops between them.
 */
export function trimToServed(shape: Pt[], stops: readonly TripStopPt[]): { shape: Pt[]; stops: readonly TripStopPt[] } {
  const first = stops.findIndex((s) => s.calls);
  let last = -1;
  stops.forEach((s, i) => { if (s.calls) last = i; });
  if (first < 0 || (first === 0 && last === stops.length - 1)) return { shape, stops };
  const idx = project(shape, stops);
  const a = idx[first];
  const b = idx[last];
  if (b <= a) return { shape, stops };
  return { shape: shape.slice(a, b + 1), stops: stops.slice(first, last + 1) };
}

/**
 * The polyline of one trip: side-road excursions to stops the trip does not call at are cut out. A hairpin or a loop is not an excursion
 * (the way back is another road) and stays; so does a stretch with a stop the trip calls at.
 */
export function cutSpurs(shape: Pt[], stops0: readonly TripStopPt[] | undefined): Pt[] {
  if (!stops0 || !stops0.some((s) => !s.calls) || shape.length < 3) return shape;
  const trimmed = trimToServed(shape, stops0);
  shape = trimmed.shape;
  const stops = trimmed.stops;
  if (!stops.some((s) => !s.calls) || shape.length < 3) return shape;
  const idx = project(shape, stops);
  const cuts: [number, number][] = [];
  stops.forEach((s, n) => {
    if (s.calls) return;
    let lo = 0;
    for (let p = n - 1; p >= 0; p--) if (stops[p].calls) { lo = idx[p]; break; }
    let hi = shape.length - 1;
    for (let p = n + 1; p < stops.length; p++) if (stops[p].calls) { hi = idx[p]; break; }
    const c = spurAround(shape, idx[n], lo, hi);
    if (c && !cuts.some(([k, m]) => c[0] <= m && c[1] >= k)) cuts.push(c);
  });
  if (!cuts.length) return shape;
  cuts.sort((p, q) => p[0] - q[0]);
  const out: Pt[] = [];
  let from = 0;
  for (const [k, m] of cuts) {
    out.push(...shape.slice(from, k + 1));
    from = m;
  }
  out.push(...shape.slice(from));
  return out;
}
