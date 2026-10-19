// Builds data/schedules.json from data/lines.json + data/raw. Usage: node scripts/parse.mjs [--only <number|id>]
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pdfItems } from './lib-pdf.mjs';
import { isSigaGrid, parseSigaGrid, norm } from './parse-siga-grid.mjs';
import { isRod, parseRod } from './parse-rod.mjs';
import { isCam, parseCam } from './parse-cam.mjs';
import { isSchool, parseSchool } from './parse-school.mjs';
import { isPassage, parsePassage } from './parse-passage.mjs';
import { isSam, parseSam } from './parse-sam.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > -1 ? process.argv[onlyArg + 1] : null;

const exists = (p) => access(p).then(() => true, () => false);

async function loadShapes(line) {
  const out = [];
  for (const d of line.directions ?? []) {
    const f = path.join(RAW, 'shape', `${d.shapeId}.json`);
    if (!(await exists(f))) continue;
    const [poly, stops] = JSON.parse(await readFile(f, 'utf8'));
    const seen = new Set();
    const ordered = stops
      .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence))
      .filter((s) => (seen.has(s.stop_id) ? false : seen.add(s.stop_id)));
    out.push({ shapeId: d.shapeId, name: d.name, poly, stops: ordered });
  }
  return out;
}

const tokens = (t) => new Set(norm(t).split(' ').filter((w) => w.length > 2 && !['via', 'de', 'do', 'da', 'dos', 'das'].includes(w)));
const sim = (a, b) => { const A = tokens(a), B = tokens(b); const i = [...A].filter((x) => B.has(x)).length; return i / Math.max(1, Math.min(A.size, B.size)); };

/** Attach shapedata (stops + geometry) to parsed directions when destination names clearly match. */
function attachShapes(dirs, shapes) {
  const used = new Set();
  for (const d of dirs) {
    const scored = shapes.map((s) => ({ s, v: sim(d.to, s.name) })).filter((x) => x.v >= 0.5 && !used.has(x.s.shapeId)).sort((a, b) => b.v - a.v);
    const best = scored[0];
    if (!best || (scored[1] && scored[1].v === best.v)) continue;
    used.add(best.s.shapeId);
    d.shapeId = best.s.shapeId;
    d.stopSource = 'shapedata';
    d.stops = best.s.stops.map((x) => ({ code: x.stop_code, name: x.stop_name, lat: Number(x.stop_lat), lon: Number(x.stop_lon) }));
  }
}

const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
/** Shared validation for the simple (terminal-only) families. */
function finishSimple(out, warn) {
  if (out.directions.length === 2) for (const [i, d] of out.directions.entries()) if (!d.to) d.to = out.directions[1 - i].from;
  let n = 0;
  for (const d of out.directions) {
    for (const [k, list] of Object.entries(d.departures)) {
      n += list.length;
      let wraps = 0;
      for (let i = 1; i < list.length; i++) if (mins(list[i].t) < mins(list[i - 1].t)) wraps++;
      if (wraps > 0 || list.some((x) => +x.t.slice(0, 2) > 29 || +x.t.slice(3) > 59)) {
        warn(`non-monotonic or invalid times in ${d.from} (${k}); schedule rejected`);
        out.rejected = true;
      }
    }
  }
  if (!n) warn('no departure times found');
  const used = new Set(Object.values(out.notes));
  out.hasParsedSchedule = n > 0 && !out.rejected;
  if (out.rejected) for (const d of out.directions) d.departures = {};
  const marks = new Set(out.directions.flatMap((d) => Object.values(d.departures).flat().flatMap((x) => x.notes ?? [])));
  for (const m of marks) if (!(m in out.notes) && m !== '*') warn(`note "${m}" has no legend text`);
}

const lines = JSON.parse(await readFile(path.join(ROOT, 'data', 'lines.json'), 'utf8'));
const result = [];
const report = [];
await mkdir(path.join(ROOT, 'data', 'shapes'), { recursive: true });

for (const line of lines) {
  if (ONLY && ![String(line.id), line.number, line.oldNumber].includes(ONLY)) continue;
  const warnings = [];
  const warn = (m) => warnings.push(m);
  const out = {
    id: line.id, number: line.number || line.oldNumber, newNumber: line.number || null, oldNumber: line.oldNumber,
    name: line.name, route: line.route, municipality: line.municipality, type: line.type,
    pdfUrl: line.pdf, jpgUrl: line.jpg, pdfFile: line.pdfFile,
    family: 'unknown', hasParsedSchedule: false, notes: {}, directions: [], warnings,
  };
  try {
    const file = path.join(RAW, line.pdfFile);
    const items = await pdfItems(file);
    const shapes = await loadShapes(line);
    if (!items.length) { out.family = 'image-only'; warn('PDF has no text layer'); }
    else if (isSigaGrid(items)) {
      out.family = 'siga-grid';
      const r = await parseSigaGrid(file, shapes, warn);
      if (r) {
        out.notes = r.notes;
        out.directions = r.directions;
        out.method = r.method;
        if (Object.keys(r.dayLabels).length) out.dayLabels = r.dayLabels;
        const n = r.directions.reduce((a, d) => a + Object.values(d.departures).reduce((x, l) => x + l.length, 0), 0);
        out.hasParsedSchedule = n > 0;
        if (!n) warn('no departure times found');
      }
    } else if (isSam(items)) {
      out.family = 'sam';
      const r = await parseSam(path.join(RAW, line.pdfFile), line, warn);
      if (r && r.directions.length) {
        out.notes = r.notes;
        out.directions = r.directions;
        finishSimple(out, warn);
      }
    } else if (isPassage(items)) {
      out.family = 'passage';
      const r = await parsePassage(path.join(RAW, line.pdfFile), warn);
      if (r && r.directions.length) {
        out.notes = r.notes;
        if (r.general.length) out.generalNotes = r.general;
        out.directions = r.directions;
        attachShapes(out.directions, shapes);
        finishSimple(out, warn);
      }
    } else if (isRod(items)) {
      out.family = 'rod';
      const r = await parseRod(path.join(RAW, line.pdfFile), warn);
      if (r && r.directions.length) {
        out.notes = r.notes;
        if (r.general.length) out.generalNotes = r.general;
        out.directions = r.directions.map((d) => ({ variant: null, stopSource: 'none', stops: [], shapeId: null, ...d }));
        attachShapes(out.directions, shapes);
        finishSimple(out, warn);
      }
    } else if (isCam(items)) {
      out.family = 'cam';
      const r = await parseCam(path.join(RAW, line.pdfFile), warn);
      if (r && r.directions.length) {
        out.notes = r.notes;
        if (r.general.length) out.generalNotes = r.general;
        out.directions = r.directions;
        attachShapes(out.directions, shapes);
        finishSimple(out, warn);
      }
    } else if (isSchool(items)) {
      out.family = 'cam-school';
      const r = await parseSchool(path.join(RAW, line.pdfFile), warn);
      if (r) {
        out.notes = r.notes;
        out.dayLabels = r.dayLabels;
        out.directions = r.directions;
        finishSimple(out, warn);
      }
    } else {
      out.family = 'unsupported';
      warn(items.some((i) => /^[0-9]{1,2}[A-Za-z]{3,}/.test(i.str) && !/[aeiou]/.test(i.str)) || items.some((i) => /DOMINGOS|RIBEIRA|EDGRV|DWXUGD/.test(i.str)) ? 'unsupported layout (garbled font encoding)' : 'unsupported PDF layout');
    }
    // fallback: stops/geometry from shapedata when no schedule was parsed
    if (!out.directions.length && shapes.length) {
      out.directions = shapes.map((s) => ({
        from: null, to: s.name, shapeId: s.shapeId, stopSource: 'shapedata', departures: {},
        stops: s.stops.map((x) => ({ code: x.stop_code, name: x.stop_name, lat: Number(x.stop_lat), lon: Number(x.stop_lon) })),
      }));
    }
    for (const s of shapes) await writeFile(path.join(ROOT, 'data', 'shapes', `${s.shapeId}.json`), JSON.stringify(s.poly.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)])));
  } catch (e) {
    warn(`parser crashed: ${e.message}`);
  }
  result.push(out);
  report.push({ number: out.number, id: out.id, family: out.family, ok: out.hasParsedSchedule, warnings });
}

if (!ONLY) {
  await writeFile(path.join(ROOT, 'data', 'schedules.json'), JSON.stringify({ generatedAt: new Date().toISOString(), source: 'https://siga.madeira.gov.pt/horarios', lines: result }));
  await writeFile(path.join(ROOT, 'data', 'parse-report.json'), JSON.stringify(report, null, 2));
  const by = {};
  for (const r of report) { const k = `${r.family}:${r.ok ? 'ok' : 'FAIL'}`; by[k] = (by[k] ?? 0) + 1; }
  console.log(by);
  console.log('lines with warnings:', report.filter((r) => r.warnings.length).length);
} else console.log(JSON.stringify(result, null, 1).slice(0, 7000));
