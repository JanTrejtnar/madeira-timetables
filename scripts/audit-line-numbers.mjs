// Audit of the line renumbering: which lines SIGA's index still lists without a new number (`number` empty in data/lines.json), and what
// the printed timetable says ("Nova numeração 380 381" in the header). Reads the PDFs from data/raw (`npm run scrape`) or data/pdf-fallback
// with pdftotext and prints, per line, whether data/line-number-overrides.json has the number, a proposal for it, or why nothing was found.
//   node scripts/audit-line-numbers.mjs            report only
//   node scripts/audit-line-numbers.mjs --write    add the proposals the PDF states unambiguously to data/line-number-overrides.json
//   node scripts/audit-line-numbers.mjs --fetch    first download the PDFs that are missing from data/raw
// The official notice (data/sources/siga/renumbering-2026-03-09.json, old number -> new numbers) is compared with the overrides as well, and where
// a line is not in the overrides yet its numbers are proposed from it (not for an old number with several cells, e.g. 4, which two lines share).
// A proposal from a PDF is made only where the PDF headings name a number per direction ("380  FUNCHAL - PORTO MONIZ"); numbers printed per column of trips
// (the second page of line 139) or in an image are listed for a person to review, never guessed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm } from '../shared/geo.mjs';
import { applyLineNumberOverrides, lineNumberProblems } from './lib-line-numbers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OVERRIDES = path.join(ROOT, 'data', 'line-number-overrides.json');
const args = new Set(process.argv.slice(2));
const lines = JSON.parse(readFileSync(path.join(ROOT, 'data', 'lines.json'), 'utf8'));
const parsed = JSON.parse(readFileSync(path.join(ROOT, 'data', 'schedules.json'), 'utf8')).lines;
const overrides = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const notice = JSON.parse(readFileSync(path.join(ROOT, 'data', 'sources', 'siga', 'renumbering-2026-03-09.json'), 'utf8'));
/** the notice's cells for the old number of a line (Rodoeste lines have ids 2xxx, the others are CAM / SAM) */
const noticeCells = (l, olds = [l.oldNumber]) => (l.id >= 2000 && l.id < 3000 ? notice.operators.rodoeste : notice.operators.cam).filter((c) => olds.includes(c.old));
/** a number SIGA's index already gives to another line is that line's, even when the notice lists it under this old number too */
const ownedByOther = (n, l) => lines.some((x) => x.id !== l.id && x.number === n);

/** The SAM sheets embed their font with a shifted encoding: pdftotext returns "$WH" for "Até" (every character 29 below its code). */
const unshift = (t) => t.replace(/[!-a]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 29));
/** the text of every page of a PDF (plus the same text with the SAM font shift undone), or null when it cannot be read */
function pages(file) {
  try {
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 })
      .split('\f')
      .filter((p) => p.trim())
      .map((p) => `${p}\n${/Hor[aá]rio|Funchal|Carreira/i.test(p) ? '' : unshift(p)}`);
  } catch {
    return null;
  }
}
const pdfPath = (l) => [path.join(ROOT, 'data', 'raw', l.pdfFile), path.join(ROOT, 'data', 'pdf-fallback', path.basename(l.pdfFile))].find(existsSync);

const NOVA = /Nova\s+numera[cç][aã]o((?:[\s,]+\d{2,4}[A-Z]?)+)/gi;
const HEADING = /^\s*(\d{2,4}[A-Z]?)\s+(\S.*?\S)\s+-\s+(\S.*?\S)\s{2,}(\d{2,4}[A-Z]?)\s+(\S.*?\S)\s+-\s+(\S.*?\S)\s*$/;

/** numbers in the "Nova numeração" header of each page, and the numbered direction headings of the page */
function readPage(text) {
  const numbers = [...text.matchAll(NOVA)].flatMap((m) => m[1].match(/\d{2,4}[A-Z]?/g));
  const headings = [];
  for (const row of text.split('\n')) {
    const m = HEADING.exec(row);
    if (m) headings.push({ number: m[1], from: m[2], to: m[3] }, { number: m[4], from: m[5], to: m[6] });
  }
  return { numbers, headings };
}

/** the heading's terminals as the data prints them ("Funchal"), found by comparing normalised names */
const sameName = (a, b) => !!a && !!b && norm(a) === norm(b);

async function fetchMissing() {
  for (const l of lines.filter((x) => !x.number)) {
    const file = path.join(ROOT, 'data', 'raw', l.pdfFile);
    if (existsSync(file) || !l.pdf) continue;
    const res = await fetch(l.pdf);
    if (!res.ok) {
      console.log(`  download failed (${res.status}): ${l.pdf}`);
      continue;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
}
if (args.has('--fetch')) await fetchMissing();

const noNumber = lines.filter((l) => !l.number);
const report = [];
const proposals = {};
for (const l of noNumber) {
  const row = { id: l.id, old: l.oldNumber, name: l.name, status: '', detail: '' };
  report.push(row);
  const done = overrides.lines[String(l.id)];
  const file = pdfPath(l);
  const texts = file ? pages(file) : null;
  if (!texts) {
    row.status = done ? 'in overrides (PDF not available here)' : 'NO PDF';
    continue;
  }
  const found = texts.map(readPage);
  const numbers = [...new Set(found.flatMap((p) => p.numbers))];
  if (!numbers.length) {
    const readable = texts.join('').replace(/\s/g, '').length > 200;
    row.status = done ? `in overrides${readable ? '' : ' (image-only PDF, read by eye)'}` : readable ? 'none printed (old format)' : 'none in text (image-only or unreadable PDF: check by eye)';
    continue;
  }
  const sched = parsed.find((x) => x.id === l.id);
  const dirs = [];
  for (const h of found.flatMap((p) => p.headings)) {
    const hits = (sched?.directions ?? []).filter((d) => sameName(d.from, h.from) && sameName(d.to, h.to));
    if (hits.length === 1) dirs.push({ from: hits[0].from, to: hits[0].to, number: h.number });
  }
  const first = found[0];
  const stated = new Set(first.numbers);
  const clean = dirs.filter((d) => stated.has(d.number));
  row.detail = `printed ${numbers.join(' ')}; per direction: ${clean.map((d) => `${d.number} ${d.from} > ${d.to}`).join(', ') || '-'}`;
  if (done) {
    row.status = 'in overrides';
    const missing = numbers.filter((n) => !done.newNumbers.includes(n));
    if (missing.length) row.status += ` (printed but not assigned: ${missing.join(' ')})`;
    continue;
  }
  if (clean.length) {
    row.status = 'PROPOSAL';
    proposals[String(l.id)] = { newNumbers: [...new Set(clean.map((d) => d.number))], directions: clean, source: `SIGA timetable PDF "Nova numeração ${first.numbers.join(' ')}"` };
  } else row.status = 'numbers printed, no direction heading matched: REVIEW';
}

for (const r of report) {
  const l = noNumber.find((x) => x.id === r.id);
  const override = overrides.lines[String(l.id)];
  const cells = noticeCells(l, override?.oldNumbers ?? [l.oldNumber]);
  const have = override?.newNumbers;
  const want = [...new Set(cells.flatMap((c) => c.new))].filter((n) => !ownedByOther(n, l));
  // an old number with several cells (4, 7) is shared by several lines: which cell is whose is decided by hand
  const several = cells.length > 1 && !override?.oldNumbers;
  const extra = have?.filter((n) => !want.includes(n)) ?? [];
  r.notice = !cells.length
    ? 'not in the notice'
    : have
      ? extra.length
        ? `override has more than the notice: ${extra.join(' ')}`
        : several
          ? 'consistent with the notice (old number has several cells)'
          : want.every((n) => have.includes(n))
            ? 'matches the notice'
            : `override lacks ${want.filter((n) => !have.includes(n)).join(' ')}`
      : several
        ? `notice has ${cells.length} cells for old ${l.oldNumber}: decide by hand`
        : `notice: ${want.join(' ')}`;
  if (!have && !several && want.length && !proposals[String(l.id)]) proposals[String(l.id)] = { newNumbers: want, source: `SIGA notice ${notice.url} (in force from 2026-03-09)` };
}
console.log(`Lines without a new number in SIGA's index: ${noNumber.length}`);
for (const r of report) console.log(`  ${String(r.id).padEnd(5)} old ${String(r.old).padEnd(4)} ${r.name.slice(0, 34).padEnd(34)} ${r.status} | ${r.notice}${r.detail ? ` – ${r.detail}` : ''}`);
const count = (re) => report.filter((r) => re.test(r.status)).length;
console.log(`in overrides ${count(/^in overrides/)}, proposals ${count(/^PROPOSAL/)}, to review ${count(/REVIEW|check by eye/)}, nothing printed yet ${count(/old format/)}, no PDF ${count(/NO PDF/)}`);

const merged = { lines: { ...overrides.lines, ...proposals } };
const problems = lineNumberProblems(parsed, merged.lines);
if (problems.length) {
  console.log('Problems:\n  ' + problems.join('\n  '));
  process.exitCode = 1;
} else if (args.has('--write') && Object.keys(proposals).length) {
  writeFileSync(OVERRIDES, JSON.stringify(merged, null, 2) + '\n');
  console.log(`data/line-number-overrides.json: ${Object.keys(proposals).length} line(s) added`);
}
// the overrides must also apply cleanly to the parsed data
applyLineNumberOverrides(structuredClone(parsed), merged.lines);
