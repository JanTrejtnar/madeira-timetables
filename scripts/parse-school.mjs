// Parser for the CAM "PERIODO ESCOLAR / FERIAS ESCOLARES / SÁBADOS / DOMINGOS E FERIADOS" PDFs.
// Four half-blocks (two per row), each headed "PARTIDA / DEPARTURES", with one time column per origin terminal.
import { pdfItems } from './lib-pdf.mjs';
import { norm } from './parse-siga-grid.mjs';

const LABELS = [
  ['weekday_school', /PERIODO ESCOLAR|PER[ÍI]ODO ESCOLAR/i],
  ['weekday_holiday', /F[ÉE]RIAS ESCOLARES|FERIAS ESCOLARES/i],
  ['saturday', /^S[ÁA]BADOS$/i],
  ['sunday', /^DOMINGOS/i],
];
const MARK_RE = /[a-z]\)/g;

export function isSchool(items) {
  return items.filter((i) => /^PARTIDA \/ DEPARTURES$/.test(i.str.trim())).length >= 2;
}

export async function parseSchool(file, warn) {
  const all = await pdfItems(file);
  const items = all.filter((i) => i.page === 1 && i.y < 790);
  if (all.some((i) => i.page > 1)) warn('multi-page PDF: only page 1 parsed');

  const heads = items.filter((i) => /^PARTIDA \/ DEPARTURES$/.test(i.str.trim())).map((i) => ({ ...i, cx: i.x + i.w / 2 }));
  const labelItems = items.flatMap((i) => LABELS.filter(([, re]) => re.test(i.str.trim())).map(([key]) => ({ key, cx: i.x + i.w / 2, y: i.y })));
  if (heads.length < 2) return null;

  // legend
  const notes = {};
  for (const it of items) {
    const m = it.str.trim().match(/^([a-z])\)\s+(\S.*)$/);
    if (m) notes[m[1]] = m[2].trim();
  }

  // x split between the two halves of a row
  const dirs = new Map();
  const sorted = [...heads].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const h of sorted) {
    const label = labelItems.filter((l) => l.y < h.y).sort((a, b) => Math.hypot(a.cx - h.cx, (a.y - h.y) * 0.5) - Math.hypot(b.cx - h.cx, (b.y - h.y) * 0.5))[0];
    if (!label) { warn('REJECT: block without day label'); return null; }
    const sameRow = heads.filter((o) => Math.abs(o.y - h.y) < 4 && o !== h);
    const mid = sameRow.length ? (h.cx + sameRow[0].cx) / 2 : null;
    const lo = mid !== null && sameRow[0].cx < h.cx ? mid : -Infinity;
    const hi = mid !== null && sameRow[0].cx > h.cx ? mid : Infinity;
    const nextY = Math.min(...heads.filter((o) => o.y > h.y + 20 && o.cx > lo && o.cx < hi).map((o) => o.y), Infinity);
    const region = items.filter((i) => i.y > h.y + 3 && i.y < nextY - 22 && i.x + i.w / 2 > lo && i.x + i.w / 2 < hi && !/^[a-z]\)\s+\S/.test(i.str.trim()));
    const timeItems = region.filter((i) => /^\d{1,2}:\d{2}/.test(i.str.trim()));
    if (!timeItems.length) continue;
    const firstY = Math.min(...timeItems.map((i) => i.y));
    // time columns by left edge
    const xs = [...new Set(timeItems.map((i) => Math.round(i.x)))].sort((a, b) => a - b);
    const cols = [];
    for (const x of xs) if (!cols.length || x - cols[cols.length - 1].x > 8) cols.push({ x, cx: 0, words: [], times: [] });
    const colFor = (cx) => cols.reduce((b, c) => (Math.abs(c.cx - cx) < Math.abs(b.cx - cx) ? c : b));
    for (const c of cols) {
      const w = timeItems.filter((i) => Math.abs(i.x - c.x) <= 8).map((i) => i.w);
      c.cx = c.x + 9; // time text is ~18pt wide; names are centred over it
    }
    for (const w of region) if (w.y < firstY - 2) colFor(w.x + w.w / 2).words.push(w);
    for (const it of timeItems) {
      const m = it.str.trim().match(/^(\d{1,2}):(\d{2})\s*(.*)$/);
      colFor(it.x + 9).times.push({ t: `${m[1].padStart(2, '0')}:${m[2]}`, marks: (m[3].match(MARK_RE) ?? []).map((x) => x.replace(')', '')), y: it.y });
    }
    const seen = region.reduce((n, i) => n + (i.str.match(/\b\d{1,2}:\d{2}\b/g)?.length ?? 0), 0);
    if (seen !== cols.reduce((n, c) => n + c.times.length, 0)) { warn(`REJECT: time count mismatch in ${label.key}`); return null; }
    for (const c of cols) {
      const name = c.words.sort((a, b) => a.y - b.y || a.x - b.x).map((w) => w.str.trim()).join(' ').replace(/\s+/g, ' ');
      if (!name) { warn(`REJECT: column without terminal name in ${label.key}`); return null; }
      const key = norm(name);
      const d = dirs.get(key) ?? { variant: null, stopSource: 'none', stops: [], shapeId: null, from: name, to: '', departures: {} };
      dirs.set(key, d);
      (d.departures[label.key] ??= []).push(...c.times.sort((a, b) => a.y - b.y).map((t) => ({ t: t.t, ...(t.marks.length ? { notes: [...new Set(t.marks)] } : {}) })));
    }
  }
  const directions = [...dirs.values()];
  if (!directions.length) return null;
  const dayLabels = { weekday_school: 'Período escolar', weekday_holiday: 'Férias escolares' };
  return { notes, general: [], directions, dayLabels };
}
