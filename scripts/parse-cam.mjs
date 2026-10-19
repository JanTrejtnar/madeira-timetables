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
  if (partidas.length % 2 || partidas.length > 6) { warn(`REJECT: unexpected Partida column count ${partidas.length}`); return null; }
  const cols = partidas.map((p) => ({ cx: p.x + p.w / 2, words: [], times: [] }));
  const colFor = (cx) => cols.reduce((b, c) => (Math.abs(c.cx - cx) < Math.abs(b.cx - cx) ? c : b));

  const labels = [];
  for (const it of items) {
    if (it.y >= hdrY) continue;
    for (const [key, re] of DAYS) if (re.test(it.str.trim())) labels.push({ key, cx: it.x + it.w / 2, y: it.y });
  }
  if (!labels.length) { warn('REJECT: no day labels'); return null; }
  const labelY = Math.max(...labels.map((l) => l.y));

  const timeItems = items.filter((i) => /^\d{1,2}:\d{2}$/.test(i.str.trim()) && i.y > hdrY);
  if (!timeItems.length) { warn('REJECT: no times'); return null; }
  const lastY = Math.max(...timeItems.map((i) => i.y));

  for (const w of items) {
    if (w.y > labelY + 3 && w.y < hdrY - 2 && w.x > Math.min(...cols.map((c) => c.cx)) - 60) colFor(w.x + w.w / 2).words.push(w);
  }
  for (const it of timeItems) {
    const [h, m] = it.str.trim().split(':');
    colFor(it.x + it.w / 2).times.push({ t: `${h.padStart(2, '0')}:${m}`, marks: [], x: it.x, y: it.y, w: it.w });
  }
  const seen = items.filter((i) => i.y > hdrY && i.y <= lastY + 3).reduce((n, i) => n + (i.str.match(/\b\d{1,2}:\d{2}\b/g)?.length ?? 0), 0);
  if (seen !== timeItems.length) { warn(`REJECT: ${seen} time-like strings but ${timeItems.length} parsed`); return null; }

  // marks sitting to the right of a time in the same row
  for (const it of items) {
    if (!KEY_RE.test(it.str.trim()) || it.y <= hdrY || it.y > lastY + 3) continue;
    const tk = cols.flatMap((c) => c.times).filter((t) => Math.abs(t.y - it.y) < 3 && t.x + t.w - 3 <= it.x).sort((a, b) => b.x - a.x)[0];
    if (tk) tk.marks.push(it.str.trim().replace(')', ''));
  }

  // names per column and the consistency check between day bands
  const nameOf = (c) => c.words.sort((a, b) => a.y - b.y || a.x - b.x).map((w) => w.str.trim()).join(' ').replace(/\s+/g, ' ');
  for (const pos of [0, 1]) {
    const names = new Set(cols.filter((_, i) => i % 2 === pos).map((c) => norm(nameOf(c))));
    if (names.size > 1 || names.has('')) { warn(`REJECT: terminal names unclear (${[...names].join(' | ')})`); return null; }
  }
  const dirs = [0, 1].map((pos) => ({ from: nameOf(cols[pos]), to: '', departures: {} }));
  dirs[0].to = dirs[1].from;
  dirs[1].to = dirs[0].from;
  cols.forEach((c, i) => {
    const day = labels.reduce((b, l) => (Math.abs(l.cx - c.cx) < Math.abs(b.cx - c.cx) ? l : b)).key;
    (dirs[i % 2].departures[day] ??= []).push(
      ...c.times.sort((a, b) => a.y - b.y).map((t) => ({ t: t.t, ...(t.marks.length ? { notes: [...new Set(t.marks)] } : {}) })),
    );
  });

  // legend: "a)" followed by text, several pairs per row
  const notes = {};
  const general = [];
  const rows = [];
  for (const it of items.filter((i) => i.y > lastY + 5).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const r = rows.find((r) => Math.abs(r.y - it.y) < 3);
    if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  for (const r of rows) {
    const its = r.items.sort((a, b) => a.x - b.x);
    if (/^não se efectuam|^nao se efectuam/i.test(its[0].str.trim())) { general.push(its.map((i) => i.str.trim()).join(' ')); continue; }
    let key = null;
    for (const it of its) {
      const s = it.str.trim();
      if (KEY_RE.test(s)) { key = s.replace(')', ''); notes[key] = ''; }
      else if (key) notes[key] = (notes[key] + ' ' + s).trim();
    }
  }
  return { notes, general, directions: dirs.map((d) => ({ variant: null, stopSource: 'none', stops: [], shapeId: null, ...d })) };
}
