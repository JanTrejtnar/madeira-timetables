import type { Direction, Line } from '../types';
import { expandTerms } from './aliases';
import { norm } from '../../shared/geo.mjs';

/** lower-case, no diacritics, punctuation → spaces (shared/geo.mjs) */
export { norm };

/** Stop name without the trailing direction marker ("…, D", "…, S2A") so both sides of the road match. */
/** key of a stop name without the printed direction marker ("…, D", "…, S2A") and the operator's pole number ("T-42" of the GTFS names) */
export const stopKey = (name: string) => norm(name).replace(/ (d|s)\d*[a-z]?$/, '').replace(/ t \d+(?: e \d+| \d+)*$/, '');

export interface LineIndex {
  line: Line;
  number: string;
  oldNumber: string;
  hay: string;
}

export interface StopHit {
  key: string;
  name: string;
  lines: Line[];
}

export interface Index {
  lines: LineIndex[];
  stops: StopHit[];
}

const byNumber = (a: Line, b: Line) => a.number.localeCompare(b.number, undefined, { numeric: true });

export function buildIndex(lines: Line[]): Index {
  const stopMap = new Map<string, { name: string; lines: Map<number, Line> }>();
  const lix = lines.map((line) => {
    const parts = [line.number, line.oldNumber, line.name, line.route, line.municipality ?? '', line.type];
    for (const d of line.directions) {
      parts.push(d.from ?? '', d.to, d.variant ?? '');
      for (const s of d.stops) {
        parts.push(s.name);
        const k = stopKey(s.name);
        if (!k) continue;
        const e = stopMap.get(k) ?? { name: s.name.replace(/,?\s*(D|S)\d*[A-Z]?$/, ''), lines: new Map() };
        e.lines.set(line.id, line);
        stopMap.set(k, e);
      }
    }
    return { line, number: norm(line.number), oldNumber: norm(line.oldNumber), hay: norm(parts.join(' ')) };
  });
  const stops = [...stopMap].map(([key, v]) => ({ key, name: v.name, lines: [...v.lines.values()].sort(byNumber) }));
  stops.sort((a, b) => a.name.localeCompare(b.name));
  return { lines: lix, stops };
}

export function searchLines(ix: Index, query: string): Line[] {
  const terms = expandTerms(query); // the typed text plus aliases ("airport" -> "aeroporto")
  if (!terms.length) return [];
  const scored: { line: Line; score: number }[] = [];
  for (const l of ix.lines) {
    let best = -Infinity;
    terms.forEach((q, ti) => {
      if (!q.split(' ').every((t) => l.hay.includes(t))) return;
      let score = ti === 0 ? 1 : 0; // what was typed ranks above what an alias added
      if (l.number === q || l.oldNumber === q) score += 100;
      else if (l.number.startsWith(q) || l.oldNumber.startsWith(q)) score += 60;
      if (norm(l.line.name).includes(q)) score += 30;
      if (norm(l.line.route).includes(q)) score += 20;
      best = Math.max(best, score);
    });
    if (best === -Infinity) continue;
    scored.push({ line: l.line, score: best + (l.line.hasParsedSchedule ? 1 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || byNumber(a.line, b.line)).map((s) => s.line);
}

export function searchStops(ix: Index, query: string, limit = 12): StopHit[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const terms = expandTerms(query);
  return ix.stops
    .filter((s) => terms.some((term) => term.split(' ').every((t) => s.key.includes(t))))
    .sort((a, b) => Number(b.key.startsWith(q)) - Number(a.key.startsWith(q)) || a.key.length - b.key.length)
    .slice(0, limit);
}

export interface Connection {
  line: Line;
  dirIndex: number;
  dir: Direction;
  /** index of the boarding stop in dir.stops (stop-based matches) */
  boardIdx: number | null;
  board: string;
  alight: string;
  /** stops strictly between boarding and alighting stop; null when the direction has no stop list */
  between: number | null;
  via: 'stops' | 'terminals';
}

/** Lines that serve A before B (by stop order of a direction; terminal names for lines without stop lists). */
export function findConnections(lines: Line[], aQuery: string, bQuery: string): Connection[] {
  const as = expandTerms(aQuery);
  const bs = expandTerms(bQuery);
  if (!as.length || !bs.length) return [];
  const out: Connection[] = [];
  for (const line of lines) {
    line.directions.forEach((dir, dirIndex) => {
      if (dir.stops.length) {
        const keys = dir.stops.map((s) => stopKey(s.name));
        const i = keys.findIndex((k) => as.some((a) => k.includes(a)));
        if (i < 0) return;
        const j = keys.findIndex((k, idx) => idx > i && bs.some((b) => k.includes(b)));
        if (j < 0) return;
        out.push({ line, dirIndex, dir, boardIdx: i, board: dir.stops[i].name, alight: dir.stops[j].name, between: j - i - 1, via: 'stops' });
      } else if (dir.from && as.some((a) => norm(dir.from as string).includes(a)) && bs.some((b) => norm(dir.to).includes(b))) {
        out.push({ line, dirIndex, dir, boardIdx: null, board: dir.from, alight: dir.to, between: null, via: 'terminals' });
      }
    });
  }
  return out.sort((x, y) => (x.between ?? 999) - (y.between ?? 999) || byNumber(x.line, y.line));
}
