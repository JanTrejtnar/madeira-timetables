import { useEffect, useMemo, useState } from 'react';
import { suggest, type Suggestion } from '../../lib/network';
import { norm } from '../../lib/search';
import { KIND_META, loadPlaces, searchPlaces, type Place, type PlaceIndex } from '../../lib/places';
import type { Shared } from '../common';

/** A row of the suggestion list: a stop (or an "all stops of" area) or a place of interest. */
export type Item = { kind: 'stop'; s: Suggestion } | { kind: 'place'; place: Place };

/** Stops, areas and places for what was typed: areas first, then stops and places by how well they match, important kinds first. */
export function useSuggestions(query: string, open: boolean, shared: Shared): Item[] {
  const [ix, setIx] = useState<PlaceIndex | null>(null);
  useEffect(() => {
    let alive = true;
    loadPlaces().then((i) => alive && setIx(i), () => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return useMemo(() => {
    if (!open) return [];
    const q = norm(query);
    const found = suggest(shared.net, shared.lines, query);
    const groups = found.filter((s) => s.group);
    const stops = found.filter((s) => !s.group);
    // a town or village that is also a stop or an area of the same name is offered once, as the stop (its lines are known)
    const names = new Set(found.map((s) => norm(s.name.split(',')[0])));
    const places = (ix ? searchPlaces(ix, query, 10) : []).filter((h) => !((h.place.kind === 'town' || h.place.kind === 'village') && names.has(norm(h.place.name))));
    const rows: { item: Item; score: number; rank: number }[] = [
      ...stops.map((s) => ({ item: { kind: 'stop', s } as Item, score: norm(s.name) === q ? 0 : norm(s.name).startsWith(q) ? 1 : 2, rank: KIND_META.stop.rank })),
      ...places.map((h) => ({ item: { kind: 'place', place: h.place } as Item, score: h.score, rank: KIND_META[h.place.kind].rank })),
    ];
    rows.sort((a, b) => a.score - b.score || a.rank - b.rank);
    return [...groups.map((s) => ({ kind: 'stop', s }) as Item), ...rows.slice(0, Math.max(5, 10 - groups.length)).map((r) => r.item)];
  }, [open, query, ix, shared.net, shared.lines]);
}
