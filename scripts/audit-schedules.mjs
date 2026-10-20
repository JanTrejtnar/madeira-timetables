// Audits data/schedules.json: time logic, structure (what the app expects), and a cross-check of the number of
// times against the text layer of the source PDF. Writes data/audit-report.json. Usage: node scripts/audit-schedules.mjs
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pdfItems, visibleItems } from './lib-pdf.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PDF_TIME_RE = /\b\d{1,2}[:h.]\d{2}\b/g;
const DAY_KEYS = ['weekday', 'saturday', 'sunday', 'weekday_school', 'weekday_holiday'];
const TOLERANCE = 0.1;
// legend keys are short letters; longer notes are inline free text
const KEY_RE = /^[A-Za-z]{1,2}$/;

const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
// service day: 00:00-02:59 belongs to the end of the previous day
const sk = (t) => (mins(t) < 180 ? mins(t) + 1440 : mins(t));
// along a trip a clock wrap past midnight is legal
const tripMin = (t, prev) => (mins(t) < prev && prev >= 1200 && mins(t) < 300 ? mins(t) + 1440 : mins(t));

const data = JSON.parse(await readFile(path.join(ROOT, 'data', 'schedules.json'), 'utf8'));
const report = [];

function auditLine(line) {
  const errors = [];
  const warnings = [];
  const info = [];
  const where = (d, extra = '') => `${d.from ?? '?'} > ${d.to}${extra}`;
  const isManual = line.family === 'manual';

  // ---- structure the app relies on (LineView / router / network) ----
  if (typeof line.id !== 'number' || !line.number) errors.push('missing id/number');
  if (!['urbano', 'interurbano'].includes(line.type)) errors.push(`bad type "${line.type}"`);
  if (typeof line.notes !== 'object' || line.notes === null) errors.push('notes is not an object');
  if (!Array.isArray(line.directions)) { errors.push('directions is not an array'); return { errors, warnings, info: [] }; }
  if (isManual && !line.manualSource) errors.push('manual line without manualSource');
  if (line.hasParsedSchedule && !line.directions.length) errors.push('hasParsedSchedule but no directions');

  const noteKeys = new Set(Object.keys(line.notes ?? {}));
  let dayKeysSeen = new Set();

  for (const d of line.directions) {
    if (typeof d.to !== 'string' || !d.to) errors.push(`${where(d)}: direction without "to"`);
    if (d.from !== null && typeof d.from !== 'string') errors.push(`${where(d)}: bad "from"`);
    if (!Array.isArray(d.stops)) { errors.push(`${where(d)}: stops is not an array`); continue; }
    if (d.stops.some((s) => !s || typeof s.name !== 'string' || !s.name.trim())) errors.push(`${where(d)}: stop without name`);
    if (typeof d.departures !== 'object' || d.departures === null) { errors.push(`${where(d)}: departures missing`); continue; }
    if (isManual && d.stopSource !== 'pdf') errors.push(`${where(d)}: manual direction with stopSource ${d.stopSource}`);

    // ---- departures: format, order, empty arrays ----
    for (const [day, list] of Object.entries(d.departures)) {
      if (!DAY_KEYS.includes(day)) errors.push(`${where(d)}: unknown day key "${day}"`);
      if (!Array.isArray(list)) { errors.push(`${where(d, ` [${day}]`)}: not an array`); continue; }
      if (!list.length) { errors.push(`${where(d, ` [${day}]`)}: empty array`); continue; }
      dayKeysSeen.add(day);
      let prev = -1;
      for (const x of list) {
        if (!x || typeof x.t !== 'string' || !TIME_RE.test(x.t)) { errors.push(`${where(d, ` [${day}]`)}: bad time "${x?.t}"`); continue; }
        if (sk(x.t) < prev) errors.push(`${where(d, ` [${day}]`)}: ${x.t} after ${String(Math.floor(prev / 60) % 24).padStart(2, '0')}:${String(prev % 60).padStart(2, '0')} (not ascending)`);
        prev = Math.max(prev, sk(x.t));
        for (const n of x.notes ?? []) if (KEY_RE.test(n) && !noteKeys.has(n)) warnings.push(`${where(d, ` [${day}]`)}: note "${n}" at ${x.t} has no legend entry`);
      }
    }
    const dk = Object.keys(d.departures);
    if (line.hasParsedSchedule && dk.length) {
      const hasWeekday = dk.some((k) => k.startsWith('weekday'));
      if (!hasWeekday) info.push(`${where(d)}: no weekday departures (only ${dk.join(', ')})`);
      if (!dk.includes('saturday') && !dk.includes('sunday')) info.push(`${where(d)}: no weekend departures (only ${dk.join(', ')})`);
    }

    // ---- trips: per-stop times ----
    if (d.trips) {
      d.trips.forEach((t, i) => {
        const tag = `${where(d)} trip #${i + 1}`;
        if (!Array.isArray(t.days) || !t.days.length || t.days.some((x) => !DAY_KEYS.includes(x))) errors.push(`${tag}: bad days ${JSON.stringify(t.days)}`);
        if (!Array.isArray(t.times)) { errors.push(`${tag}: times missing`); return; }
        if (d.stops.length && t.times.length !== d.stops.length) errors.push(`${tag}: ${t.times.length} times for ${d.stops.length} stops`);
        let prev = -1;
        for (const x of t.times) {
          if (x === null) continue;
          if (typeof x !== 'string' || !TIME_RE.test(x)) { errors.push(`${tag}: bad time "${x}"`); continue; }
          const m = tripMin(x, prev);
          if (m < prev) errors.push(`${tag}: ${x} goes back in time`);
          prev = Math.max(prev, m);
        }
        for (const n of t.notes ?? []) if (KEY_RE.test(n) && !noteKeys.has(n)) warnings.push(`${tag}: note "${n}" has no legend entry`);
        // first-stop time should be listed in departures for each of its days
        const first = t.times[0];
        if (first) for (const day of t.days) if (!(d.departures[day] ?? []).some((x) => x.t === first)) warnings.push(`${tag}: ${first} missing from departures[${day}]`);
      });
    }
    if (d.isEstimated && (!Array.isArray(d.stopOffsets) || d.stopOffsets.length !== d.stops.length)) errors.push(`${where(d)}: isEstimated without matching stopOffsets`);
  }

  if (line.hasParsedSchedule) {
    const total = countStored(line);
    if (!total) errors.push('hasParsedSchedule but zero times');
  }
  return { errors, warnings, info };
}

/** Times stored for the line: all per-stop times where trips exist, otherwise the first-stop departures. */
function countDepartures(line) {
  return line.directions.reduce((n, d) => n + Object.values(d.departures ?? {}).reduce((a, l) => a + l.length, 0), 0);
}
function countStored(line) {
  let n = 0;
  for (const d of line.directions) {
    if (d.trips?.length) n += d.trips.reduce((a, t) => a + t.times.filter(Boolean).length, 0);
    else n += Object.values(d.departures ?? {}).reduce((a, l) => a + l.length, 0);
  }
  // a printed holiday table has no day key of its own (the planner treats holidays as Sundays): its times are kept in a general note
  for (const g of line.generalNotes ?? []) if (/^Feriados:/.test(g)) n += (g.match(/\b\d{1,2}:\d{2}\b/g) ?? []).length;
  return n;
}

async function pdfTimeCount(line) {
  const file = path.join(RAW, line.pdfFile ?? '');
  let items;
  try { items = line.family === 'sam' ? await visibleItems(file) : await pdfItems(file); } catch { return null; }
  if (!items.length) return null; // scan: no text layer
  // not departures: footer revision dates ("DE/HF - 13.02.2023") and "CL-20:30" cut-off notes
  const text = items.map((i) => i.str).join(' ').replace(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g, ' ').replace(/\bCL-\d{1,2}:\d{2}/g, ' ').replace(/(?<=^|\s)[àa]s\s+\d{1,2}[:h]\d{2}/gi, ' '); // "passagem no Camacha Shopping às 14:15" in a legend text
  return (text.match(PDF_TIME_RE) ?? []).length;
}

for (const line of data.lines) {
  const { errors, warnings, info } = auditLine(line);
  const row = { number: line.number, id: line.id, type: line.type, family: line.family, parsed: line.hasParsedSchedule, errors, warnings, info };
  if (line.hasParsedSchedule) {
    row.stored = countStored(line);
    row.storedDepartures = countDepartures(line);
    row.pdfTimes = await pdfTimeCount(line);
    if (row.pdfTimes) {
      // trips print a time per stop, departure-only tables just the first stop: use whichever matches the PDF better
      if (Math.abs(row.storedDepartures - row.pdfTimes) < Math.abs(row.stored - row.pdfTimes)) row.stored = row.storedDepartures;
      row.diff = row.stored - row.pdfTimes;
      row.ratio = +(Math.abs(row.diff) / row.pdfTimes).toFixed(3);
      row.suspicious = row.ratio > TOLERANCE;
    } else row.pdfTimes = null;
  }
  report.push(row);
}

const parsed = report.filter((r) => r.parsed);
const manual = report.filter((r) => r.family === 'manual');
const clean = parsed.filter((r) => !r.errors.length && !r.warnings.length && !r.suspicious);
const flagged = parsed.filter((r) => r.errors.length || r.warnings.length || r.suspicious);

await writeFile(path.join(ROOT, 'data', 'audit-report.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), tolerance: TOLERANCE,
  summary: { lines: report.length, parsed: parsed.length, clean: clean.length, flagged: flagged.length, unparsed: report.length - parsed.length },
  suspicious: report.filter((r) => r.suspicious),
  lines: report,
}, null, 1));

const line = (s) => console.log(s);
line(`\nAudit of ${report.length} lines (${parsed.length} with times, ${report.length - parsed.length} PDF-only)`);
line(`  clean (no findings):      ${clean.length}`);
line(`  with findings:            ${flagged.length}  (errors: ${flagged.filter((r) => r.errors.length).length}, only warnings/count diff: ${flagged.filter((r) => !r.errors.length).length})`);
line(`  PDF count cross-check:    ${parsed.filter((r) => r.pdfTimes !== null).length} text PDFs compared, ${report.filter((r) => r.suspicious).length} differ by >${TOLERANCE * 100}%`);
line(`\nManual transcriptions (${manual.length}):`);
for (const r of manual) {
  const state = r.errors.length ? 'ERROR' : r.warnings.length ? 'warn' : 'ok';
  line(`  ${String(r.number).padEnd(11)} ${state.padEnd(5)} stored ${String(r.stored).padStart(4)}${r.pdfTimes !== null ? `  pdf ${String(r.pdfTimes).padStart(4)}` : '  (scan)'}`);
}
if (flagged.length) {
  line('\nLines with findings:');
  for (const r of flagged) {
    const cmp = r.pdfTimes !== null ? `stored ${r.stored} vs pdf ${r.pdfTimes} (${r.diff >= 0 ? '+' : ''}${r.diff}, ${(r.ratio * 100).toFixed(0)} %)` : '';
    line(`\n  ${r.number} [${r.family}, ${r.type}] ${r.suspicious ? 'SUSPICIOUS COUNT ' : ''}${cmp}`);
    for (const e of r.errors.slice(0, 6)) line(`     ERROR ${e}`);
    if (r.errors.length > 6) line(`     ... ${r.errors.length - 6} more errors`);
    for (const w of r.warnings.slice(0, 4)) line(`     warn  ${w}`);
    if (r.warnings.length > 4) line(`     ... ${r.warnings.length - 4} more warnings`);
  }
}
line('\nFull report: data/audit-report.json');
process.exit(flagged.some((r) => r.errors.length) ? 1 : 0);
