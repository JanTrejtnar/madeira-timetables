// Timetable of a line from the official GTFS feed (data/gtfs/lines.json, made by fetch-gtfs.mjs) in the shape parse.mjs `applyManual` produces.
// A direction_id is one direction; the stop patterns of its route variants are merged into one stop list, a trip that skips a stop has null there.

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

/** group the stop patterns of one direction_id into clusters whose stops can share one list; a pattern that visits stops in another order starts a new cluster */
function clusterPatterns(patterns) {
  const clusters = [];
  for (const p of [...patterns].sort((a, b) => b.trips.length - a.trips.length)) {
    const home = clusters.find((c) => {
      const order = mergeSequences([...c.patterns.map((x) => [...x.keys]), [...p.keys]]);
      return [...c.patterns, p].every((x) => isSubsequence(x.keys, order));
    });
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
      for (const { t, keys } of keyed) keys.forEach((k, i) => nameOf.set(k, t.stops[i]));
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
      out.push({ variant: ci ? head || `variant ${ci + 1}` : null, from: nameOf.get(order[0]), to: head || nameOf.get(order[order.length - 1]), stops: order.map((k) => nameOf.get(k)), trips: tripsOut });
    });
  }
  return out;
}
