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
import { parseTransbordo } from './parse-transbordo.mjs';
import { isRowTables, parseRowTables } from './parse-rowtables.mjs';

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
/** sort key of a service day: 00:00-02:59 belongs to the end of the previous day */
const sk = (t) => (mins(t) < 180 ? mins(t) + 1440 : mins(t));
/** Shared validation for the simple (terminal-only) families. */
function finishSimple(out, warn) {
  if (out.directions.length === 2) for (const [i, d] of out.directions.entries()) if (!d.to) d.to = out.directions[1 - i].from;
  let n = 0;
  for (const d of out.directions) {
    for (const [k, list] of Object.entries(d.departures)) {
      n += list.length;
      let wraps = 0;
      for (let i = 1; i < list.length; i++) if (sk(list[i].t) < sk(list[i - 1].t)) wraps++;
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

/**
 * Lines whose PDF is a scan (or too irregular to parse) can have a hand-made transcription in data/manual/<lineId>.json.
 * It replaces the parsed result and is marked (family "manual", manualSource) so the app and the report can tell.
 */
async function applyManual(out, warn) {
  const file = path.join(ROOT, 'data', 'manual', `${out.id}.json`);
  if (!(await exists(file))) return;
  const m = JSON.parse(await readFile(file, 'utf8'));
  out.family = 'manual';
  out.manualSource = m.source;
  out.notes = m.notes ?? {};
  if (m.generalNotes?.length) out.generalNotes = m.generalNotes;
  out.directions = m.directions.map((d) => {
    const departures = d.departures ? JSON.parse(JSON.stringify(d.departures)) : {};
    for (const t of d.departures ? [] : d.trips) {
      if (!t.times[0]) continue;
      for (const day of t.days) (departures[day] ??= []).push({ t: t.times[0], ...(t.notes ? { notes: t.notes } : {}) });
    }
    for (const k of Object.keys(departures)) departures[k].sort((x, y) => sk(x.t) - sk(y.t));
    for (const t of d.trips) if (t.times.length !== d.stops.length) throw new Error(`manual ${out.id}: trip length differs from stops`);
    return { variant: d.variant ?? null, from: d.from, to: d.to, shapeId: null, stopSource: 'pdf', stops: d.stops.map((name) => ({ code: null, name })), departures, trips: d.trips };
  });
  out.hasParsedSchedule = out.directions.some((d) => d.trips.length || Object.values(d.departures).some((l) => l.length));
  out.warnings.length = 0;
  warn('manual transcription');
}

/** Source quirks the app should not see: terminal stops without a name, directions without a destination, empty day lists. */
function tidyDirections(out, warn) {
  for (const d of out.directions) {
    if (!d.to) {
      d.to = out.directions.length === 1 ? d.from ?? out.route : out.route;
      warn(`direction from ${d.from} has no printed destination; using "${d.to}"`);
    }
    if (d.stops?.length) {
      if (!d.stops[0].name?.trim() && d.from) d.stops[0].name = d.from;
      const last = d.stops[d.stops.length - 1];
      if (!last.name?.trim() && d.to) last.name = d.to;
    }
    for (const [k, list] of Object.entries(d.departures ?? {})) if (!list.length) delete d.departures[k];
  }
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
        // supplementary shuttle tables on later pages ("Transbordo")
        const tr = out.hasParsedSchedule ? await parseTransbordo(file, warn) : null;
        if (tr) {
          for (const d of tr.directions) {
            const departures = {};
            for (const t of d.trips) for (const day of t.days) (departures[day] ??= []).push({ t: t.times[0], ...(t.notes?.length ? { notes: t.notes } : {}) });
            out.directions.push({ ...d, shapeId: null, stopSource: 'pdf', stops: d.stops.map((name) => ({ code: null, name })), departures });
          }
          out.generalNotes = [...(out.generalNotes ?? []), ...tr.general];
        }
      }
    } else if (isRowTables(items, line.oldNumber)) {
      out.family = 'rowtables';
      const r = await parseRowTables(file, line.oldNumber, warn);
      if (r && r.directions.length) {
        out.notes = r.notes;
        if (r.general.length) out.generalNotes = r.general;
        out.directions = r.directions.map((d) => {
          const departures = {};
          for (const t of d.trips) {
            const first = t.times.find(Boolean);
            if (first) for (const day of t.days) (departures[day] ??= []).push({ t: first, ...(t.notes?.length ? { notes: t.notes } : {}) });
          }
          for (const l of Object.values(departures)) l.sort((x, y) => sk(x.t) - sk(y.t));
          return { ...d, stopSource: 'pdf', stops: d.stops.map((name) => ({ code: null, name })), departures };
        });
        finishSimple(out, warn);
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
  tidyDirections(out, warn);
  await applyManual(out, warn);
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
