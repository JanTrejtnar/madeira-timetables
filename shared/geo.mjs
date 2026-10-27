// The one place for distances and text normalisation, used by the app (src/) and the build scripts (scripts/).
// Points are [lat, lon] pairs or { lat, lon } objects.

/** Metres per degree of latitude, and per degree of longitude at the equator (scaled by cos(latitude) for a place). */
export const M_PER_DEG_LAT = 110540;
export const M_PER_DEG_LON_EQ = 111320;
export const EARTH_RADIUS_KM = 6371.0088;
/** cos(latitude) of Madeira (32.7° N): a fixed longitude scale for "which vertex is nearest" comparisons, which need no real distance. */
export const MADEIRA_COS = 0.84;

const rad = Math.PI / 180;
const latOf = (p) => (Array.isArray(p) ? p[0] : p.lat);
const lonOf = (p) => (Array.isArray(p) ? p[1] : p.lon);

/** Great-circle distance in kilometres. */
export function haversineKm(a, b) {
  const dLat = (latOf(b) - latOf(a)) * rad;
  const dLon = (lonOf(b) - lonOf(a)) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latOf(a) * rad) * Math.cos(latOf(b) * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
/** Great-circle distance in metres. */
export const haversineM = (a, b) => haversineKm(a, b) * 1000;

/** Flat-earth distance in metres (longitude scaled at the mean latitude): exact enough below a few km and far cheaper than the haversine. */
export function metres(a, b) {
  const kx = M_PER_DEG_LON_EQ * Math.cos(((latOf(a) + latOf(b)) / 2) * rad);
  return Math.hypot((lonOf(a) - lonOf(b)) * kx, (latOf(a) - latOf(b)) * M_PER_DEG_LAT);
}

/** Distance in metres from p to the segment a-b, in a flat projection around p. */
export function metresToSegment(p, a, b) {
  const kx = M_PER_DEG_LON_EQ * Math.cos(latOf(p) * rad);
  const ax = (lonOf(a) - lonOf(p)) * kx, ay = (latOf(a) - latOf(p)) * M_PER_DEG_LAT;
  const bx = (lonOf(b) - lonOf(p)) * kx, by = (latOf(b) - latOf(p)) * M_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Squared distance in degrees with longitude scaled by MADEIRA_COS: only for ordering candidates (nearest vertex of a polyline). */
export const localSq = (p, q) => (latOf(p) - latOf(q)) ** 2 + ((lonOf(p) - lonOf(q)) * MADEIRA_COS) ** 2;

/** Lower-case ASCII words: accents removed, everything but letters and digits is a single space ("Câmara de Lobos" -> "camara de lobos"). */
export const norm = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
