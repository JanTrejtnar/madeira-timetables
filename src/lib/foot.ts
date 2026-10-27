// Walking routes along real streets and paths. The public OpenStreetMap routing service (OSRM, "foot" profile, routed-foot) answers
// with the street geometry; the app shows it on the map and uses the real distance for the walk times. Offline, or when the service
// is slow or says something absurd, the callers keep the straight line corrected for winding roads (lib/walk.ts).
import { useEffect, useState } from 'react';

export const FOOT_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
/** a slow or rate-limited public server is given up on quickly: the straight dashed line is drawn instead */
export const FOOT_TIMEOUT_MS = 3000;
const MEM_MAX = 200;
const STORE_KEY = 'footRoutes.v1';
const STORE_MAX = 80;
/** a walking route more than this many times (plus 400 m) longer than the straight line is a routing artefact (a detour round a missing link) */
const MAX_DETOUR = 4;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface FootRoute {
  /** length along the streets, metres */
  m: number;
  /** [lat, lon] along the way */
  pts: [number, number][];
}

const R = 6_371_008.8;
const rad = Math.PI / 180;
export function straightM(a: LatLon, b: LatLon): number {
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const footKey = (a: LatLon, b: LatLon) => `${a.lat.toFixed(5)},${a.lon.toFixed(5)};${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;

/** Reads the OSRM answer; null when it is not a usable walk (no route, or a detour round the block that no walker would take). */
export function parseFoot(json: unknown, a: LatLon, b: LatLon): FootRoute | null {
  const r = (json as { code?: string; routes?: { distance?: number; geometry?: { coordinates?: [number, number][] } }[] })?.routes?.[0];
  if ((json as { code?: string })?.code !== 'Ok' || !r?.geometry?.coordinates?.length || typeof r.distance !== 'number') return null;
  const straight = straightM(a, b);
  if (r.distance > straight * MAX_DETOUR + 400) return null;
  // the service snaps both ends to the nearest path: join the real endpoints so the line starts and ends at the pins
  const pts = r.geometry.coordinates.map(([lon, lat]) => [+lat.toFixed(5), +lon.toFixed(5)] as [number, number]);
  return { m: Math.round(r.distance), pts: [[a.lat, a.lon], ...pts, [b.lat, b.lon]] };
}

const mem = new Map<string, Promise<FootRoute | null>>();
/** answers that arrived, for synchronous reads; a least-recently-used cache (Map keeps insertion order) */
const done = new Map<string, FootRoute | null>();
export function remember(key: string, route: FootRoute | null) {
  done.delete(key);
  done.set(key, route);
  if (done.size > MEM_MAX) done.delete(done.keys().next().value as string);
}

function readStore(): Record<string, FootRoute | null> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function writeStore(key: string, route: FootRoute) {
  try {
    const all = readStore();
    delete all[key];
    all[key] = route;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - STORE_MAX))) delete all[k];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* storage full or unavailable: the route just is not remembered */
  }
}

/** Cached answer if the route was fetched before (this session or an earlier one), else undefined. */
export function cachedFoot(a: LatLon, b: LatLon): FootRoute | null | undefined {
  const key = footKey(a, b);
  if (done.has(key)) {
    const hit = done.get(key)!;
    remember(key, hit);
    return hit;
  }
  const stored = readStore()[key];
  if (stored) {
    remember(key, stored);
    return stored;
  }
  return undefined;
}

/** The walking route from a to b; null when there is none to be had (offline, timeout, nonsense). Never rejects. */
export function fetchFoot(a: LatLon, b: LatLon): Promise<FootRoute | null> {
  const key = footKey(a, b);
  const known = cachedFoot(a, b);
  if (known !== undefined) return Promise.resolve(known);
  if (straightM(a, b) < 15) return Promise.resolve(null);
  let p = mem.get(key);
  if (!p) {
    p =
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? Promise.resolve(null)
        : fetch(`${FOOT_URL}/${a.lon.toFixed(6)},${a.lat.toFixed(6)};${b.lon.toFixed(6)},${b.lat.toFixed(6)}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(FOOT_TIMEOUT_MS) })
            // 429 and 5xx: no route, the caller keeps the straight line
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => parseFoot(j, a, b))
            .catch(() => null);
    p = p.then((route) => {
      if (route) {
        remember(key, route);
        writeStore(key, route);
      } else mem.delete(key); // a failure is retried next time (the phone may be back online)
      return route;
    });
    mem.set(key, p);
  }
  return p;
}

export type FootPair = [LatLon, LatLon] | null;

/**
 * Walking routes for several pairs of points; the result has the same length: undefined while it loads, null where there is none.
 * Pairs are compared by their coordinates, so passing a new array each render is fine.
 */
export function useFootRoutes(pairs: FootPair[]): (FootRoute | null | undefined)[] {
  const keys = pairs.map((p) => (p ? footKey(p[0], p[1]) : ''));
  const sig = keys.join('|');
  const [, bump] = useState(0);
  useEffect(() => {
    let alive = true;
    pairs.forEach((p) => {
      if (p) void fetchFoot(p[0], p[1]).then(() => alive && bump((n) => n + 1));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return pairs.map((p) => (p ? cachedFoot(p[0], p[1]) : null));
}
