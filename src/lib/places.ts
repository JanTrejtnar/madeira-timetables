// Places of interest (beaches, peaks, viewpoints, harbours, malls, towns ...) for the planner's autocomplete, next to the bus stops.
// public/data/pois.json is built from OpenStreetMap + a curated list of famous destinations (scripts/lib-pois.mjs).
import { assetUrl } from '../data';
import { expandTerms } from './aliases';
import { norm } from './search';
import type { IconName } from '../components/Icons';

export type PlaceKind =
  | 'town'
  | 'village'
  | 'beach'
  | 'nature'
  | 'viewpoint'
  | 'harbor'
  | 'mall'
  | 'attraction'
  | 'museum'
  | 'park'
  | 'peak'
  | 'levada'
  | 'hotel'
  | 'church'
  | 'hospital'
  | 'airport'
  | 'market'
  | 'cable_car'
  | 'trail'
  | 'bus_station';

export interface Place {
  name: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  /** other names people type (English, Czech ...) */
  alt: string[];
}

/** The row format of public/data/pois.json: [name, kind, lat, lon, alt?] */
export type PlaceRow = [string, PlaceKind, number, number, string[]?];

/** Icon, colour and rank (lower = shown first among equal matches) of each kind of place in the suggestion list. */
export const KIND_META: Record<PlaceKind | 'stop', { icon: IconName; tone: string; rank: number }> = {
  stop: { icon: 'bus', tone: 'text-sky-600', rank: 1 },
  town: { icon: 'building', tone: 'text-violet-600', rank: 0 },
  village: { icon: 'pin', tone: 'text-violet-500', rank: 1 },
  beach: { icon: 'umbrella', tone: 'text-amber-500', rank: 1 },
  nature: { icon: 'tree', tone: 'text-emerald-600', rank: 1 },
  park: { icon: 'tree', tone: 'text-emerald-600', rank: 2 },
  peak: { icon: 'mountain', tone: 'text-emerald-700', rank: 1 },
  levada: { icon: 'waves', tone: 'text-cyan-600', rank: 2 },
  trail: { icon: 'footprints', tone: 'text-emerald-700', rank: 3 },
  viewpoint: { icon: 'eye', tone: 'text-rose-500', rank: 1 },
  harbor: { icon: 'anchor', tone: 'text-blue-600', rank: 1 },
  mall: { icon: 'bag', tone: 'text-pink-600', rank: 2 },
  market: { icon: 'bag', tone: 'text-pink-600', rank: 2 },
  attraction: { icon: 'camera', tone: 'text-rose-500', rank: 2 },
  museum: { icon: 'landmark', tone: 'text-indigo-600', rank: 2 },
  hotel: { icon: 'bed', tone: 'text-slate-500', rank: 3 },
  church: { icon: 'church', tone: 'text-slate-500', rank: 3 },
  hospital: { icon: 'hospital', tone: 'text-red-600', rank: 2 },
  airport: { icon: 'plane', tone: 'text-sky-700', rank: 1 },
  cable_car: { icon: 'cable', tone: 'text-rose-500', rank: 2 },
  bus_station: { icon: 'bus', tone: 'text-sky-600', rank: 2 },
};

export interface PlaceIndex {
  places: { place: Place; keys: string[] }[];
}

export function buildPlaceIndex(rows: PlaceRow[]): PlaceIndex {
  return {
    places: rows.map(([name, kind, lat, lon, alt]) => {
      const place: Place = { name, kind, lat, lon, alt: alt ?? [] };
      return { place, keys: [norm(name), ...place.alt.map(norm)].filter(Boolean) };
    }),
  };
}

let cached: Promise<PlaceIndex> | null = null;
/** Loads the places once (the file is precached by the service worker, so this also works offline). */
export function loadPlaces(): Promise<PlaceIndex> {
  cached ??= fetch(assetUrl('data/pois.json'))
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: { places: PlaceRow[] }) => buildPlaceIndex(j.places))
    .catch((e) => {
      cached = null;
      throw e;
    });
  return cached;
}

/** 0 = exact, 1 = starts with, 2 = every word starts a word of the name, 3 = contains it (4+ characters); Infinity = no match */
function matchScore(keys: string[], q: string): number {
  const tokens = q.split(' ');
  let best = Infinity;
  for (const k of keys) {
    let s = Infinity;
    if (k === q) s = 0;
    else if (k.startsWith(q)) s = 1;
    else if (tokens.every((t) => k.startsWith(t) || k.includes(' ' + t))) s = 2;
    else if (q.length >= 4 && k.includes(q)) s = 3;
    if (s < best) best = s;
  }
  return best;
}

export interface PlaceHit {
  place: Place;
  score: number;
}

/** Places for what was typed, best first: exact and prefix matches, then by how much a tourist wants the kind of place. */
export function searchPlaces(ix: PlaceIndex, query: string, limit = 8): PlaceHit[] {
  const qs = expandTerms(query);
  if (!qs.length || qs[0].length < 2) return [];
  const hits: PlaceHit[] = [];
  for (const e of ix.places) {
    let score = Infinity;
    for (const q of qs) score = Math.min(score, matchScore(e.keys, q));
    if (score !== Infinity) hits.push({ place: e.place, score });
  }
  return hits
    .sort((a, b) => a.score - b.score || KIND_META[a.place.kind].rank - KIND_META[b.place.kind].rank || a.place.name.length - b.place.name.length)
    .slice(0, limit);
}

/** Key of a picked place in the planner form: no stop key, the point decides which stops are near. */
export const POI_PREFIX = '@poi:';
export const poiKey = (p: Place) => POI_PREFIX + norm(p.name);
export const isPoiKey = (key: string | null | undefined): key is string => !!key?.startsWith(POI_PREFIX);
