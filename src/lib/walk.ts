import { distanceM } from './nearby';

/** Walking speed in the terrain: 4 km/h, about 1 minute per 70 m. */
export const WALK_M_PER_MIN = 70;
/** Roads on Madeira wind: the walked distance is the straight line times this. */
export const TERRAIN_FACTOR = 1.3;

export interface Walk {
  /** straight-line distance x TERRAIN_FACTOR, metres */
  m: number;
  min: number;
}

/** Walk (straight line corrected for winding roads) from a picked point to a stop (null without a point or stop coordinates). */
export function walkTo(pt: { lat: number; lon: number } | undefined, stop: { lat?: number; lon?: number } | undefined): Walk | null {
  if (!pt || stop?.lat === undefined || stop.lon === undefined) return null;
  const m = Math.round(distanceM(pt, { lat: stop.lat, lon: stop.lon }) * TERRAIN_FACTOR);
  return { m, min: Math.max(1, Math.round(m / WALK_M_PER_MIN)) };
}
