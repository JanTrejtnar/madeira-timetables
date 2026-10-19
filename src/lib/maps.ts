import type { Stop } from '../types';

/** Google Maps: by coordinates, or (no coordinates) by stop name + "Madeira". */
export function googleMapsUrl(s: Pick<Stop, 'name' | 'lat' | 'lon'>): string {
  const q = s.lat !== undefined && s.lon !== undefined ? `${s.lat},${s.lon}` : `${s.name} Madeira`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Mapy.cz; undefined when the stop has no coordinates. */
export function mapyCzUrl(s: Pick<Stop, 'lat' | 'lon'>): string | undefined {
  if (s.lat === undefined || s.lon === undefined) return undefined;
  return `https://mapy.cz/zakladni?q=${s.lat},${s.lon}&z=17`;
}
