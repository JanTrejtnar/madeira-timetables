import { distanceM } from './nearby';

/** Walking speed in the terrain: 4 km/h, about 1 minute per 70 m. */
export const WALK_M_PER_MIN = 70;

export interface Walk {
  /** straight-line distance, metres */
  m: number;
  min: number;
}

/** Straight-line walk from a picked point to a stop (null without a point or stop coordinates). */
export function walkTo(pt: { lat: number; lon: number } | undefined, stop: { lat?: number; lon?: number } | undefined): Walk | null {
  if (!pt || stop?.lat === undefined || stop.lon === undefined) return null;
  const m = Math.round(distanceM(pt, { lat: stop.lat, lon: stop.lon }));
  return { m, min: Math.max(1, Math.round(m / WALK_M_PER_MIN)) };
}
