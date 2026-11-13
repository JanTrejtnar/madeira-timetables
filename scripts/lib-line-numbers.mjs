// New line numbers (SIGA / Rodoeste renumbering) from data/line-number-overrides.json.
//
// SIGA's line index still lists some lines under the old number only (`Line.newNumber` is null), while the printed timetable already says
// "Nova numeração 380 381": one old line (80) became one number per direction. The old number stays the line's technical key (`Line.number`:
// GTFS lookup, note fixes, manual transcriptions, enrichment); the override only adds what the traveller sees and searches for:
//   Line.newNumbers   every new number of the line ("380", "381")
//   Direction.number  the new number of a direction, found by its printed terminals (`from` / `to`, optionally `variant`)
// The key of an entry is the SIGA line id (`Line.id`), which never changes, unlike the number.

/** @typedef {{ from?: string, to?: string, variant?: string, number: string }} DirectionNumber */
/** @typedef {{ newNumbers: string[], oldNumbers?: string[], directions?: DirectionNumber[], source?: string, note?: string }} LineNumberOverride oldNumbers: the old numbers whose new numbers these are, when more than the line's own (the CAM Santana line 56 also keeps the trips of old line 133) */

const NUMBER = /^\d{1,4}[A-Z]?$/;

/**
 * Checks the overrides against the lines without changing anything; returns the problems (empty = fine).
 * @param {{ id: number, number: string, newNumber?: string | null, directions: { from: string | null, to: string, variant?: string | null }[] }[]} lines
 * @param {Record<string, LineNumberOverride>} overrides
 */
export function lineNumberProblems(lines, overrides) {
  const problems = [];
  const byId = new Map(lines.map((l) => [String(l.id), l]));
  // numbers SIGA's index already gives to a line: a new number must not be one of them. Two overrides may share a new number: the renumbering
  // merges old lines (the CAM Santana lines 56, 103 and 138 all run as 850), so one new line has several old ones.
  const owner = new Map(); // number -> ids of the lines that have it in SIGA's index
  for (const l of lines) for (const n of [l.number, l.newNumber].filter(Boolean)) owner.set(n, (owner.get(n) ?? new Set()).add(l.id));
  for (const [id, o] of Object.entries(overrides)) {
    const line = byId.get(id);
    if (!line) {
      problems.push(`${id}: no line with this id`);
      continue;
    }
    const at = `${id} (${line.number})`;
    if (!Array.isArray(o.newNumbers) || !o.newNumbers.length) problems.push(`${at}: newNumbers is empty`);
    if (o.oldNumbers !== undefined && (!Array.isArray(o.oldNumbers) || !o.oldNumbers.every((x) => typeof x === 'string'))) problems.push(`${at}: oldNumbers is not a list of strings`);
    const seen = new Set();
    for (const n of o.newNumbers ?? []) {
      if (!NUMBER.test(n)) problems.push(`${at}: "${n}" is not a line number`);
      if (seen.has(n)) problems.push(`${at}: "${n}" listed twice`);
      seen.add(n);
      const taken = owner.get(n);
      if (taken && [...taken].some((x) => x !== line.id)) problems.push(`${at}: "${n}" is already the number of line ${[...taken].filter((x) => x !== line.id).join(', ')} in SIGA's index`);
    }
    for (const [i, d] of (o.directions ?? []).entries()) {
      if (!d.from && !d.to) problems.push(`${at}: directions[${i}] needs from and / or to`);
      if (!seen.has(d.number)) problems.push(`${at}: directions[${i}].number "${d.number}" is not in newNumbers`);
      if (matching(line, d).length === 0) problems.push(`${at}: directions[${i}] (${d.from ?? '*'} > ${d.to ?? '*'}) matches no direction of the line`);
    }
  }
  return problems;
}

const matching = (line, d) =>
  line.directions.flatMap((dir, i) => ((d.from === undefined || dir.from === d.from) && (d.to === undefined || dir.to === d.to) && (d.variant === undefined || (dir.variant ?? null) === d.variant) ? [i] : []));

/** Writes `newNumbers` / `direction.number` into the lines; throws when the overrides do not fit the data. Returns the number of lines changed. */
export function applyLineNumberOverrides(lines, overrides) {
  const problems = lineNumberProblems(lines, overrides);
  if (problems.length) throw new Error(`data/line-number-overrides.json:\n  ${problems.join('\n  ')}`);
  let n = 0;
  for (const l of lines) {
    const o = overrides[String(l.id)];
    if (!o) continue;
    l.newNumbers = [...o.newNumbers];
    for (const d of o.directions ?? []) for (const i of matching(l, d)) l.directions[i].number = d.number;
    n++;
  }
  return n;
}
