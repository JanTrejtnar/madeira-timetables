// Runtime check of the data the app loads. `JSON.parse(...) as Dataset` only asserts a type; a truncated download, an interrupted service
// worker update or a file from an incompatible build would then fail somewhere deep in the planner. This checks the structures the app
// walks (lines -> directions -> stops / trips / departures) and names the first problem, so the caller can fall back to the last good copy.
// Hand-written on purpose: no schema library in the bundle.
import type { Dataset } from '../types';

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Why `data` is not a usable dataset (a path like `lines[3].directions[0].stops[12].lat: …`), or null when it is one. */
export function datasetProblem(data: unknown): string | null {
  if (!isRec(data)) return 'dataset: not an object';
  if (!isStr(data.generatedAt)) return 'generatedAt: not a string';
  const { lines } = data;
  if (!Array.isArray(lines) || lines.length === 0) return 'lines: missing or empty';
  if (data.terminalWalks !== undefined) {
    if (!Array.isArray(data.terminalWalks)) return 'terminalWalks: not an array';
    for (const [i, w] of data.terminalWalks.entries()) if (!isRec(w) || !isStr(w.a) || !isStr(w.b) || !isNum(w.min)) return `terminalWalks[${i}]: needs a, b, min`;
  }
  for (const [li, line] of lines.entries()) {
    const at = `lines[${li}]`;
    if (!isRec(line)) return `${at}: not an object`;
    if (!isNum(line.id)) return `${at}.id: not a number`;
    if (!isStr(line.number) || !isStr(line.name)) return `${at}: number / name missing`;
    if (line.type !== 'urbano' && line.type !== 'interurbano') return `${at}.type: ${String(line.type)}`;
    if (typeof line.hasParsedSchedule !== 'boolean') return `${at}.hasParsedSchedule: not a boolean`;
    if (!isRec(line.notes)) return `${at}.notes: not an object`;
    if (line.via !== undefined && (!isRec(line.via) || !Object.values(line.via).every((places) => Array.isArray(places) && places.every((p) => isRec(p) && isStr(p.name) && isNum(p.lat) && isNum(p.lon) && isRec(p.after))))) return `${at}.via: not lists of places`;
    if (!Array.isArray(line.directions)) return `${at}.directions: not an array`;
    for (const [di, dir] of line.directions.entries()) {
      const d = `${at}.directions[${di}]`;
      if (!isRec(dir)) return `${d}: not an object`;
      if (!isStr(dir.to)) return `${d}.to: not a string`;
      if (dir.shapeId !== null && !isNum(dir.shapeId)) return `${d}.shapeId: neither a number nor null`;
      if (!Array.isArray(dir.stops)) return `${d}.stops: not an array`;
      for (const [si, s] of dir.stops.entries()) {
        if (!isRec(s) || !isStr(s.name)) return `${d}.stops[${si}]: no name`;
        const { lat, lon } = s;
        if ((lat === undefined) !== (lon === undefined)) return `${d}.stops[${si}]: lat / lon only one of them`;
        if (lat !== undefined && (!isNum(lat) || !isNum(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)) return `${d}.stops[${si}]: position ${String(lat)}, ${String(lon)}`;
      }
      if (!isRec(dir.departures)) return `${d}.departures: not an object`;
      for (const [key, list] of Object.entries(dir.departures)) {
        if (!Array.isArray(list)) return `${d}.departures.${key}: not an array`;
        for (const [i, dep] of list.entries()) if (!isRec(dep) || !isStr(dep.t)) return `${d}.departures.${key}[${i}]: no time`;
      }
      if (dir.trips !== undefined) {
        if (!Array.isArray(dir.trips)) return `${d}.trips: not an array`;
        for (const [i, tr] of dir.trips.entries()) {
          // a time per stop: the planner reads trip.times[i] as the time at stop i
          if (!isRec(tr) || !Array.isArray(tr.days) || !Array.isArray(tr.times) || tr.times.length !== dir.stops.length) return `${d}.trips[${i}]: days / times do not fit the stops`;
          if (tr.times.some((x) => x !== null && !isStr(x))) return `${d}.trips[${i}].times: not strings`;
        }
      }
      if (dir.stopOffsets !== undefined && (!Array.isArray(dir.stopOffsets) || !dir.stopOffsets.every(isNum))) return `${d}.stopOffsets: not numbers`;
    }
  }
  return null;
}

export const isDataset = (data: unknown): data is Dataset => datasetProblem(data) === null;

/** The detour routes of a line (public/data/via/<id>.json): an object of { a, b, pts } with at least one point. */
export function isViaRoutes(x: unknown): x is Record<string, { a: [number, number]; b: [number, number]; pts: [number, number][] }> {
  const pair = (p: unknown) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);
  return isRec(x) && Object.values(x).every((r) => isRec(r) && pair(r.a) && pair(r.b) && Array.isArray(r.pts) && r.pts.length > 0 && r.pts.every(pair));
}

/** A route file (public/data/shapes/<id>.json): a list of [lat, lon] points. */
export function isShape(x: unknown): x is [number, number][] {
  return Array.isArray(x) && x.length > 1 && x.every((p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]));
}
