// Recent searches and favourite connections, kept in localStorage (the app has no account or server).
import type { Picked } from './plannerForm';

export interface SavedTrip {
  from: Picked;
  to: Picked;
  /** when it was last searched (recent) or starred (favourite), ms since the epoch */
  at: number;
}

const RECENT_KEY = 'recentTrips.v1';
const FAV_KEY = 'favoriteTrips.v1';
export const RECENT_MAX = 5;
export const FAV_MAX = 30;

const sameSide = (a: Picked, b: Picked) => (a.key && b.key ? a.key === b.key && (a.pt?.lat === b.pt?.lat && a.pt?.lon === b.pt?.lon) : a.text.trim().toLowerCase() === b.text.trim().toLowerCase() && a.pt?.lat === b.pt?.lat && a.pt?.lon === b.pt?.lon);
export const sameTrip = (a: Pick<SavedTrip, 'from' | 'to'>, b: Pick<SavedTrip, 'from' | 'to'>) => sameSide(a.from, b.from) && sameSide(a.to, b.to);

const clean = (p: unknown): Picked | null => {
  const o = p as Partial<Picked> | null;
  if (!o || typeof o.text !== 'string' || !o.text.trim()) return null;
  const pt = o.pt && Number.isFinite(o.pt.lat) && Number.isFinite(o.pt.lon) ? { lat: o.pt.lat, lon: o.pt.lon } : undefined;
  return { text: o.text, key: typeof o.key === 'string' ? o.key : null, ...(pt ? { pt } : {}) };
};

export function parseTrips(raw: string | null): SavedTrip[] {
  try {
    const list = JSON.parse(raw ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.flatMap((x) => {
      const from = clean(x?.from);
      const to = clean(x?.to);
      return from && to ? [{ from, to, at: Number.isFinite(x.at) ? x.at : 0 }] : [];
    });
  } catch {
    return [];
  }
}

const load = (key: string) => {
  try {
    return parseTrips(localStorage.getItem(key));
  } catch {
    return [];
  }
};
const save = (key: string, list: SavedTrip[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* private mode: kept for this session only */
  }
};

export const loadRecent = () => load(RECENT_KEY);
export const loadFavorites = () => load(FAV_KEY);

/** A trip with both ends filled in, newest first, without duplicates. */
export function addRecent(list: SavedTrip[], trip: Omit<SavedTrip, 'at'>, now = Date.now()): SavedTrip[] {
  const entry: SavedTrip = { from: trip.from, to: trip.to, at: now };
  return [entry, ...list.filter((x) => !sameTrip(x, entry))].slice(0, RECENT_MAX);
}

export function toggleFavorite(list: SavedTrip[], trip: Omit<SavedTrip, 'at'>, now = Date.now()): SavedTrip[] {
  return list.some((x) => sameTrip(x, trip)) ? list.filter((x) => !sameTrip(x, trip)) : [{ from: trip.from, to: trip.to, at: now }, ...list].slice(0, FAV_MAX);
}

export const saveRecent = (list: SavedTrip[]) => save(RECENT_KEY, list);
export const saveFavorites = (list: SavedTrip[]) => save(FAV_KEY, list);
