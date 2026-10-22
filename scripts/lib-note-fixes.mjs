import { readFileSync } from 'node:fs';

/** data/note-fixes.json: { fixes: { line: { code: text } }, recode: { line: { sequences, map, drop } } } */
export function loadNoteFixes(file = 'data/note-fixes.json') {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return { fixes: j.fixes ?? {}, recode: j.recode ?? {} };
}

/**
 * Codes the parser read wrongly in the departure rows of one line (garbled font): `sequences` replace a run of
 * codes ("E","J" -> "b","g"), `map` renames a code, `drop` removes stray marks. Returns the number of changed notes.
 */
export function recodeNotes(line, rules) {
  if (!rules) return 0;
  const { sequences = [], map = {}, drop = [] } = rules;
  let changed = 0;
  const fix = (x) => {
    if (!x.notes?.length) return;
    let n = [...x.notes];
    for (const [from, to] of sequences) {
      for (let i = 0; i + from.length <= n.length; i++) {
        if (from.every((c, k) => n[i + k] === c)) {
          n.splice(i, from.length, ...to);
          i += to.length - 1;
        }
      }
    }
    n = n.filter((c) => !drop.includes(c)).map((c) => map[c] ?? c);
    n = n.filter((c, i) => n.indexOf(c) === i);
    if (n.join() !== x.notes.join()) changed++;
    x.notes = n;
  };
  for (const d of line.directions ?? []) {
    for (const list of Object.values(d.departures ?? {})) list.forEach(fix);
    (d.trips ?? []).forEach(fix);
  }
  return changed;
}
