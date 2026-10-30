// Timetable of a line from the official GTFS feed (data/gtfs/lines.json, made by fetch-gtfs.mjs) in the shape parse.mjs `applyManual` produces.
// A direction_id is one direction; the stop patterns of its route variants are merged into one stop list, a trip that skips a stop has null there.

const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * The compact groups of data/gtfs/lines.json (stop ids, trips as first minute + minutes between stops) as one trip per day set:
 * { dir, day, head, shape, ids, stops (names), times ("HH:MM", after midnight wrapped like the PDF timetables) }. `stopsById`: id -> { name }.
 */
export function expandGtfsLine(groups, stopsById) {
  return groups.flatMap((g) => {
    const stops = g.ids.map((id) => {
      const s = stopsById.get(id);
      if (!s) throw new Error(`GTFS stop ${id} is not in data/gtfs/stops.json; run npm run fetch:gtfs`);
      return s.name;
    });
    return g.trips.flatMap(([enc, days]) => {
      let at = 0;
      const times = enc.split(' ').map((d) => hhmm((at += +d)));
      return days.map((day) => ({ dir: g.dir, day, head: g.head, shape: g.shape, ids: g.ids, stops, times }));
    });
  });
}

const sk = (t) => +t.slice(0, 2) * 60 + +t.slice(3);

/** merge stop sequences (arrays of keys) into one order that keeps every sequence's order; the longest goes first */
function mergeSequences(seqs) {
  const merged = [...seqs.sort((a, b) => b.length - a.length)[0]];
  for (const seq of seqs) {
    let at = -1;
    for (const k of seq) {
      const i = merged.indexOf(k);
      if (i >= 0) { at = i; continue; }
      merged.splice(at + 1, 0, k);
      at += 1;
    }
  }
  return merged;
}

/** keys of one trip's stops: the stop id plus the number of earlier visits, so a loop's repeated stop stays distinct */
function tripKeys(t) {
  const seen = new Map();
  return t.ids.map((id) => {
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return `${id}#${n}`;
  });
}

const isSubsequence = (seq, order) => {
  let at = -1;
  for (const k of seq) {
    at = order.indexOf(k, at + 1);
    if (at < 0) return false;
  }
  return true;
};

/**
 * group the stop patterns of one direction_id into clusters whose stops share one list. The longest pattern is the root of a cluster; a pattern joins it when its
 * stops are a subsequence of the root's (a short-turn trip, a trip that skips stops). A pattern with a stop of its own (another pole, a detour, a loop, another branch)
 * starts a cluster of its own: the route shape belongs to one stop list, and a stop the shape does not pass would be drawn off the road.
 */
function clusterPatterns(patterns) {
  const clusters = [];
  for (const p of [...patterns].sort((a, b) => b.keys.length - a.keys.length || b.trips.length - a.trips.length)) {
    const home = clusters.find((c) => isSubsequence(p.keys, c.patterns[0].keys));
    if (home) home.patterns.push(p);
    else clusters.push({ patterns: [p] });
  }
  return clusters;
}

export function gtfsDirections(trips) {
  const out = [];
  for (const dir of [...new Set(trips.map((t) => t.dir))].sort()) {
    const byPattern = new Map();
    for (const t of trips.filter((x) => x.dir === dir)) {
      const keys = tripKeys(t);
      const id = keys.join(',');
      const p = byPattern.get(id) ?? { keys, trips: [] };
      p.trips.push(t);
      byPattern.set(id, p);
    }
    clusterPatterns([...byPattern.values()]).forEach((cluster, ci) => {
      const keyed = cluster.patterns.flatMap((p) => p.trips.map((t) => ({ t, keys: p.keys })));
      const order = mergeSequences(cluster.patterns.map((p) => [...p.keys]));
      const nameOf = new Map();
      const idOf = new Map();
      for (const { t, keys } of keyed) keys.forEach((k, i) => { nameOf.set(k, t.stops[i]); idOf.set(k, t.ids[i]); });
      const groups = new Map();
      for (const { t, keys } of keyed) {
        const times = order.map((k) => { const i = keys.indexOf(k); return i < 0 ? null : t.times[i]; });
        const id = times.join('|');
        const g = groups.get(id) ?? { times, days: new Set() };
        g.days.add(t.day);
        groups.set(id, g);
      }
      const tripsOut = [...groups.values()].map((g) => {
        const days = new Set(g.days);
        if (days.has('weekday_school') && days.has('weekday_holiday')) { days.delete('weekday_school'); days.delete('weekday_holiday'); days.add('weekday'); }
        return { days: [...days], times: g.times };
      }).sort((a, b) => sk(a.times.find(Boolean)) - sk(b.times.find(Boolean)));
      const heads = new Map();
      for (const { t } of keyed) heads.set(t.head, (heads.get(t.head) ?? 0) + 1);
      const head = [...heads.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const shapes = new Map();
      const longest = Math.max(...keyed.map((x) => x.keys.length));
      for (const { t, keys } of keyed) if (t.shape && keys.length === longest) shapes.set(t.shape, (shapes.get(t.shape) ?? 0) + 1);
      const shape = [...shapes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      out.push({ shape, variant: ci ? head || `variant ${ci + 1}` : null, from: nameOf.get(order[0]), to: head || nameOf.get(order[order.length - 1]), stops: order.map((k) => nameOf.get(k)), ids: order.map((k) => idOf.get(k)), trips: tripsOut });
    });
  }
  return out;
}
