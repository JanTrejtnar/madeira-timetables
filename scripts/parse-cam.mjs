// Parser for the clean "Companhia de Autocarros da Madeira" PDFs (C*.pdf): day labels, a row of "Partida"
// headers (2 columns per day type), times as "06:40" and marks ("a)") as separate items to the right.
import { pdfItems } from './lib-pdf.mjs';
import { norm } from './parse-siga-grid.mjs';

const DAYS = [
  ['weekday', /2ª a 6ª|segunda a sexta|dias [uú]teis/i],
  ['saturday', /^s[aá]bados?$/i],
  ['sunday', /^domingos?/i],
];
const KEY_RE = /^[a-zA-Z]\)$/;

export function isCam(items) {
  return items.some((i) => /COMPANHIA DE AUTOCARROS DA MADEIRA/i.test(i.str)) && items.filter((i) => i.str.trim() === 'Partida').length >= 2;
}

export async function parseCam(file, warn) {
  const all = await pdfItems(file);
  const items = all.filter((i) => i.page === 1 && i.y < 740);
  if (all.some((i) => i.page > 1)) warn('multi-page PDF: only page 1 parsed');

  const partidas = items.filter((i) => i.str.trim() === 'Partida').sort((a, b) => a.x - b.x);
  const hdrY = Math.min(...partidas.map((p) => p.y));
  if (partidas.length < 1 || partidas.length > 8) { warn(`REJECT: unexpected Partida column count ${partidas.length}`); return null; }
  const cols = partidas.map((p) => ({ cx: p.x + p.w / 2, words: [], times: [] }));
  const colFor = (cx) => cols.reduce((b, c) => (Math.abs(c.cx - cx) < Math.abs(b.cx - cx) ? c : b));

  const labels = [];
  for (const it of items) {
    if (it.y >= hdrY) continue;
    for (const [key, re] of DAYS) if (re.test(it.str.trim())) labels.push({ key, cx: it.x + it.w / 2, y: it.y });
  }
  if (!labels.length) { warn('REJECT: no day labels'); return null; }
  const labelY = Math.max(...labels.map((l) => l.y));

  const timeItems = items.filter((i) => /^\d{1,2}[:.]\d{2}$/.test(i.str.trim()) && i.y > hdrY);
  if (!timeItems.length) { warn('REJECT: no times'); return null; }
  const lastY = Math.max(...timeItems.map((i) => i.y));

  for (const w of items) {
    if (w.y > labelY + 3 && w.y < hdrY - 2 && w.x > Math.min(...cols.map((c) => c.cx)) - 60) colFor(w.x + w.w / 2).words.push(w);
  }
  for (const it of timeItems) {
    const [h, m] = it.str.trim().split(/[:.]/);
    colFor(it.x + it.w / 2).times.push({ t: `${h.padStart(2, '0')}:${m}`, marks: [], x: it.x, y: it.y, w: it.w });
  }
  const seen = items.filter((i) => i.y > hdrY && i.y <= lastY + 3).reduce((n, i) => n + (i.str.match(/\b\d{1,2}[:.]\d{2}\b/g)?.length ?? 0), 0);
  if (seen !== timeItems.length) { warn(`REJECT: ${seen} time-like strings but ${timeItems.length} parsed`); return null; }

  // marks sitting to the right of a time in the same row
  for (const it of items) {
    if (!/^([a-zA-Z]\)\s*)+$/.test(it.str.trim()) || it.y <= hdrY || it.y > lastY + 3) continue;
    const tk = cols.flatMap((c) => c.times).filter((t) => Math.abs(t.y - it.y) < 3 && t.x + t.w - 3 <= it.x).sort((a, b) => b.x - a.x)[0];
    if (tk) tk.marks.push(...[...it.str.matchAll(/([a-zA-Z])\)/g)].map((m) => m[1]));
  }

  // names per column and the consistency check between day bands
  const nameOf = (c) => c.words.sort((a, b) => a.y - b.y || a.x - b.x).map((w) => w.str.trim()).join(' ').replace(/\s+/g, ' ');
  // one direction per distinct column name (a day band can have fewer columns than another)
  const byName = new Map();
  for (const c of cols) {
    const name = nameOf(c);
    if (!norm(name)) { warn('REJECT: terminal names unclear (a column has no name)'); return null; }
    const day = labels.reduce((best, l) => (Math.abs(l.cx - c.cx) < Math.abs(best.cx - c.cx) ? l : best)).key;
    const d = byName.get(norm(name)) ?? { from: name, to: '', departures: {} };
    byName.set(norm(name), d);
    (d.departures[day] ??= []).push(...c.times.sort((p, q) => p.y - q.y).map((t) => ({ t: t.t, ...(t.marks.length ? { notes: [...new Set(t.marks)] } : {}) })));
  }
  const dirs = [...byName.values()];
  if (dirs.length === 2) {
    dirs[0].to = dirs[1].from;
    dirs[1].to = dirs[0].from;
  }

  // legend: "a)" followed by text, several pairs per row
  const notes = {};
  const general = [];
  let schoolOnly = false;
  const rows = [];
  for (const it of items.filter((i) => i.y > lastY + 5).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const r = rows.find((r) => Math.abs(r.y - it.y) < 3);
    if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  for (const r of rows) {
    const its = r.items.sort((a, b) => a.x - b.x);
    if (/^não se efectuam|^nao se efectuam/i.test(its[0].str.trim())) { general.push(its.map((i) => i.str.trim()).join(' ')); continue; }
    if (/per[ií]odo escolar/i.test(its.map((i) => i.str).join(' '))) { general.push(its.map((i) => i.str.trim()).join(' ')); schoolOnly = true; continue; }
    // "a) Via Garajau b) Via Rua da Alternativa", or "a)" and its text as separate items
    const line = its.map((i) => i.str.trim()).join(' ');
    for (const m of line.matchAll(/([a-zA-Z])\)\s*(.*?)(?=\s+[a-zA-Z]\)\s|$)/g)) notes[m[1]] = m[2].trim();
  }
  // "only during the school period": the weekday list is the school-period one
  if (schoolOnly) for (const d of dirs) if (d.departures.weekday) { d.departures.weekday_school = d.departures.weekday; delete d.departures.weekday; }
  return { notes, general, directions: dirs.map((d) => ({ variant: null, stopSource: 'none', stops: [], shapeId: null, ...d })) };
}
