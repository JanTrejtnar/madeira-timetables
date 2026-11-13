// A timetable that prints one place ("Fazenda") where the bus really calls at several stops one after the other: the operator named
// the stops in order (data/stop-expansions.json), and this replaces the one printed stop by them in every direction of the line.
// Only one time is printed (at the place), so the others are ESTIMATES: the printed time belongs to the `anchor` stop and the
// neighbours get it plus the driving time between the stops at `speedKmh`, rounded to minutes and kept between the neighbouring printed times.
// A trip that prints no time at the place (it does not go there) gets no time at any of the stops.
import { haversineM } from '../shared/geo.mjs';
import { norm } from '../shared/geo.mjs';

const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
const fmt = (m) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;

/** the stops of `rule` in the order the direction `d` drives them */
export const orderFor = (rule, d) => (norm(d.from ?? '') === norm(rule.forwardFrom) ? rule.stops : [...rule.stops].reverse());

/** offsets (minutes, relative to the anchor stop) of the stops in driving order */
export function offsets(stops, anchorCode, speedKmh) {
  const a = stops.findIndex((s) => s.code === anchorCode);
  if (a < 0) throw new Error(`stop expansion: anchor ${anchorCode} is not one of the stops`);
  const cum = [0];
  for (let i = 1; i < stops.length; i++) cum.push(cum[i - 1] + haversineM([stops[i - 1].lat, stops[i - 1].lon], [stops[i].lat, stops[i].lon]));
  return cum.map((c) => Math.round(((c - cum[a]) / 1000 / speedKmh) * 60));
}

/** applies the rules to the parsed line in place; returns the number of directions changed */
export function applyStopExpansions(line, rules) {
  let changed = 0;
  for (const rule of rules.filter((r) => r.line === line.id)) {
    for (const d of line.directions) {
      const i = d.stops.findIndex((s) => norm(s.name) === norm(rule.stop));
      if (i < 0) continue;
      const seq = orderFor(rule, d).map((s) => ({ ...s }));
      const off = offsets(seq, rule.anchor, rule.speedKmh ?? 20);
      d.stops.splice(i, 1, ...seq);
      for (const t of d.trips) {
        const at = t.times[i];
        let fill = seq.map(() => null);
        if (at) {
          const base = toMin(at);
          const lo = i > 0 && t.times[i - 1] ? toMin(t.times[i - 1]) : -Infinity;
          const hi = t.times[i + 1] ? toMin(t.times[i + 1]) : Infinity;
          let last = lo;
          fill = off.map((o) => {
            const m = Math.min(hi, Math.max(last, base + o));
            last = m;
            return fmt(m);
          });
        }
        t.times.splice(i, 1, ...fill);
      }
      changed++;
    }
  }
  return changed;
}
