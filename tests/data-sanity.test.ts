// Sanity of the built timetables (public/data/schedules.json, made by `npm run build:data`): times that go backwards, speeds a bus cannot drive,
// loop lines, and a search across midnight. Found by the data audit; a failure here is a wrong stop position or a misread timetable.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildNetwork, servicesFor, suggest, type Network, type Trip } from '../src/lib/network';
import { runSearch } from '../src/lib/plannerSearch';
import type { Picked } from '../src/lib/plannerForm';
import type { Dataset } from '../src/types';
import { haversineKm } from '../shared/geo.mjs';

const file = 'public/data/schedules.json';
const MAX_KMH = 90;
/** a hop shorter than this is not judged: the printed times are whole minutes */
const MIN_HOP_KM = 0.5;

/**
 * Hops known to be too fast, each with the reason. NOT a licence: fix the data and remove the entry (the test below fails when an entry
 * no longer occurs, so the list cannot go stale). Key: `line|from stop|to stop`.
 */
const KNOWN_FAST: Record<string, string> = {
  '675|Santo da Serra|Torre': 'direction 1 prints Torre 3 min after Santo da Serra, but Torre is ~5 km away (3 min after Santa Cruz in direction 2): the printed order or times are probably misread',
  '785|Rochão|Porto da Cruz': 'Rochão (Porto da Cruz loop) is placed at the Rochão near Santa Cruz (exact) 10 km away; the one by Porto da Cruz is not identified yet',
  '785|Serrado|Rochão': 'same wrong Rochão position',
};

const minutes = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

interface Hop {
  where: string;
  line: string;
  from: string;
  to: string;
  min: number;
  km: number;
}

/** every hop between two consecutive printed times of a trip; times after midnight follow the evening ones (a drop of 12 h or more is a new day) */
function hops(data: Dataset): Hop[] {
  const out: Hop[] = [];
  for (const line of data.lines) {
    line.directions.forEach((dir, di) => {
      (dir.trips ?? []).forEach((trip, ti) => {
        let prev: number | null = null;
        let prevI = -1;
        let day = 0;
        trip.times.forEach((x, i) => {
          if (x === null) return;
          const m0 = minutes(x);
          if (m0 === null) return;
          let m = m0 + day;
          if (prev !== null && prev - m >= 720) {
            day += 1440;
            m += 1440;
          }
          if (prev !== null) {
            const a = dir.stops[prevI];
            const b = dir.stops[i];
            const km = a.lat !== undefined && a.lon !== undefined && b.lat !== undefined && b.lon !== undefined ? haversineKm([a.lat, a.lon], [b.lat, b.lon]) : 0;
            out.push({ where: `${line.number}/${di} trip ${ti}`, line: line.number, from: a.name, to: b.name, min: m - prev, km });
          }
          prev = m;
          prevI = i;
        });
      });
    });
  }
  return out;
}

describe.skipIf(!existsSync(file))('timetable sanity (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const all = hops(data);

  it('has hops to judge', () => {
    expect(all.length).toBeGreaterThan(5000);
  });

  it('no trip goes back in time between two stops', () => {
    const back = all.filter((h) => h.min < 0).map((h) => `${h.where}: ${h.from} -> ${h.to} ${h.min} min`);
    expect(back).toEqual([]);
  });

  const fast = all.filter((h) => h.min > 0 && h.km > MIN_HOP_KM && h.km / (h.min / 60) > MAX_KMH);
  const key = (h: Hop) => `${h.line}|${h.from}|${h.to}`;

  it(`no hop averages more than ${MAX_KMH} km/h, except the listed known ones`, () => {
    const unknown = [...new Set(fast.filter((h) => !(key(h) in KNOWN_FAST)).map((h) => `${key(h)} ${h.km.toFixed(1)} km in ${h.min} min`))];
    expect(unknown).toEqual([]);
  });

  it('every known fast hop still occurs (a fixed one must leave KNOWN_FAST)', () => {
    const seen = new Set(fast.map(key));
    expect(Object.keys(KNOWN_FAST).filter((k) => !seen.has(k))).toEqual([]);
  });
});

describe.skipIf(!existsSync(file))('loops and midnight (real data)', () => {
  const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
  const net: Network = buildNetwork(data.lines, data.terminalWalks);
  // a Monday in term time
  const trips: Trip[] = servicesFor(net, data.lines, { y: 2026, m: 11, d: 2 }, true, ['Funchal']);
  const stop = (id: number): Picked => ({ text: net.nodes[id].name, key: net.nodes[id].key });
  const found = (r: ReturnType<typeof runSearch>) => (r ? [...r.plan.direct, ...r.plan.transfers] : []);

  it('a loop trip (it ends where it began) can be ridden from a stop on it back to its start', () => {
    const loops = trips.filter((t) => t.nodes.length >= 4 && t.nodes[0] === t.nodes[t.nodes.length - 1] && t.times[0] !== null && t.times[0] >= 0 && t.times[0] < 1440);
    expect(loops.length).toBeGreaterThan(5);
    const seen = new Set<string>();
    const failures: string[] = [];
    for (const t of loops) {
      const id = `${t.line.number}/${t.dirIndex}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const last = t.nodes.length - 1;
      const mid = t.nodes.findIndex((n, i) => i > 0 && i < last && n !== t.nodes[last] && t.times[i] !== null);
      if (mid < 0) continue;
      const at = (t.times[mid] as number) - 1;
      // the printed end of a loop may have no time of its own (line 528): then any journey back to it counts
      const arrive = t.times[last] ?? Infinity;
      const its = found(runSearch(net, trips, stop(t.nodes[mid]), stop(t.nodes[last]), at, false));
      if (!its.some((it) => it.arrive <= arrive)) failures.push(`${id}: ${net.nodes[t.nodes[mid]].name} -> ${net.nodes[t.nodes[last]].name} at ${at}, no journey arriving by ${arrive}`);
    }
    expect(seen.size).toBeGreaterThan(3);
    expect(failures).toEqual([]);
  }, 60_000);

  it('a loop trip has rising times from start to end', () => {
    const bad = trips
      .filter((t) => t.nodes[0] === t.nodes[t.nodes.length - 1] && t.nodes.length >= 4)
      .filter((t) => {
        const ts = t.times.filter((x): x is number => x !== null);
        return ts.some((x, i) => i > 0 && x < ts[i - 1]);
      })
      .map((t) => `${t.line.number}/${t.dirIndex}`);
    expect([...new Set(bad)]).toEqual([]);
  });

  const pick = (q: string): Picked => {
    const s = suggest(net, data.lines, q, 5)[0];
    expect(s, q).toBeDefined();
    return { text: s.name, key: s.key };
  };

  it.each([
    ['Funchal', 'Santana'],
    ['Ribeira Brava', 'Funchal'],
  ])('a search at 23:50 %s -> %s finds the morning buses of the next day', (a, b) => {
    const at = 23 * 60 + 50;
    const its = found(runSearch(net, trips, pick(a), pick(b), at, false));
    expect(its.length).toBeGreaterThan(0);
    // none leaves before the asked time, and the earliest leaves the next morning (after midnight, before noon)
    expect(its.every((it) => it.depart >= at)).toBe(true);
    const first = Math.min(...its.map((it) => it.depart));
    expect(first).toBeGreaterThanOrEqual(1440);
    expect(first).toBeLessThan(1440 + 12 * 60);
  });
});
