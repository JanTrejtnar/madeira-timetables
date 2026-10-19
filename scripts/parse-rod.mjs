// Parser for the "rod" PDF family ("Horário da carreira regular de transporte colectivo de passageiros").
// Layout: one or more blocks, each with a row of "PARTIDA" headers (2 columns per day type), terminal
// names below them, then departure times written like "10h25 a)". No stop lists, times for terminals only.
import { pdfItems } from './lib-pdf.mjs';
import { norm } from './parse-siga-grid.mjs';

const TIME_RE = /(\d{1,2})[h:.](\d{2})/g;
const MARK_RE = /P\.\s?N\.\s?E\.|P\.\s?E\.|[a-zA-Z]\)|\*|\b[A-Z]{1,3}\b/g;
const DAYS = [
  ['weekday', /segunda a sexta|2ª a 6ª|dias [uú]teis/i],
  ['saturday', /s[aá]bado/i],
  ['sunday', /domingo/i],
];

export function isRod(items) {
  return items.filter((i) => i.str.trim() === 'PARTIDA').length >= 2 && items.some((i) => /Horário da carreira regular/i.test(i.str));
}

const clean = (m) => m.replace(')', '').replace(/\s+/g, '');

function tokens(it) {
  const ms = [...it.str.matchAll(TIME_RE)];
  return ms.map((m, k) => {
    const end = k + 1 < ms.length ? ms[k + 1].index : it.str.length;
    const marks = it.str.slice(m.index + m[0].length, end).match(MARK_RE) ?? [];
    return { t: `${m[1].padStart(2, '0')}:${m[2]}`, marks: marks.map(clean), cx: it.x + it.w / 2, y: it.y };
  });
}

export async function parseRod(file, warn) {
  const all = await pdfItems(file);
  const items = all.filter((i) => i.page === 1);
  if (all.some((i) => i.page > 1)) warn('multi-page PDF: only page 1 parsed');

  const obsY = Math.min(...items.filter((i) => /OBSERVA/i.test(i.str)).map((i) => i.y), Infinity);
  const partidas = items.filter((i) => i.str.trim() === 'PARTIDA');
  // group PARTIDA headers into blocks by y
  const blocks = [];
  for (const p of partidas.sort((a, b) => a.y - b.y)) {
    // the PARTIDA labels of one header can sit on different rows
    const b = blocks.find((k) => p.y - k.lastY < 25);
    if (b) { b.cols.push(p); b.lastY = p.y; } else blocks.push({ y: p.y, lastY: p.y, cols: [p] });
  }
  if (!blocks.length) return null;
  blocks.forEach((b, k) => { b.end = k + 1 < blocks.length ? blocks[k + 1].y - 4 : obsY - 2; });

  // day labels (above the first block)
  const labels = [];
  for (const it of items) {
    if (it.y >= blocks[0].y || !/Horário|2ª|Dias/i.test(it.str)) continue;
    for (const [key, re] of DAYS) if (re.test(it.str)) labels.push({ key, cx: it.x + it.w / 2 });
  }
  if (!labels.length) { warn('no day labels'); return null; }

  const dirs = new Map(); // key -> {from,to,departures}
  for (const b of blocks) {
    if (b.cols.length % 2 || b.cols.length > 6) { warn(`REJECT: unexpected PARTIDA column count ${b.cols.length}`); return null; }
    const cols = b.cols.sort((a, c) => a.x - c.x).map((p) => ({ cx: p.x + p.w / 2, words: [], times: [] }));
    const colFor = (cx) => cols.reduce((best, c) => (Math.abs(c.cx - cx) < Math.abs(best.cx - cx) ? c : best));
    const body = items.filter((i) => i.y > b.y + 2 && i.y < b.end);
    const timeItems = body.filter((i) => /^\s*\d{1,2}[h:.]\d{2}/.test(i.str));
    const firstY = Math.min(...timeItems.map((i) => i.y), b.end);
    for (const w of body) {
      if (w.y < firstY - 2 && !/^\d/.test(w.str) && !/^(PARTIDA|Departure)$/i.test(w.str.trim())) colFor(w.x + w.w / 2).words.push(w);
    }
    for (const it of timeItems) for (const t of tokens(it)) colFor(t.cx).times.push(t);
    // completeness: every time-looking string in the block must have ended up in a column
    const seen = body.reduce((n, i) => n + (i.str.match(/\b\d{1,2}[h:.]\d{2}\b/g)?.length ?? 0), 0);
    const got = cols.reduce((n, c) => n + c.times.length, 0);
    if (seen !== got) {
      warn(`REJECT: ${seen} time-like strings in block but ${got} parsed`);
      return null;
    }
    // dashes-only marker items are ignored. Marks floating in their own item:
    for (const it of body) {
      if (!/^(?:[a-zA-Z]\)|P\.E\.|P\.N\.E\.|\*)(\s*(?:[a-zA-Z]\)|P\.E\.|P\.N\.E\.|\*))*$/.test(it.str.trim()) || it.y < firstY - 2) continue;
      const cand = cols.flatMap((c) => c.times).filter((t) => Math.abs(t.y - it.y) < 3 && t.cx < it.x + it.w / 2 + 2);
      const tk = cand.sort((a, c) => Math.abs(a.cx - it.x) - Math.abs(c.cx - it.x))[0];
      if (tk) tk.marks.push(...(it.str.match(MARK_RE) ?? []).map(clean));
    }
    const nameOf = (c) => c.words.sort((a, d) => a.y - d.y || a.x - d.x).map((w) => w.str.trim()).join(' ').replace(/\s+/g, ' ');
    if (items.some((w) => /^(PASSAGEM|CHEGADA|ARRIVAL)$/i.test(w.str.trim()))) {
      warn('REJECT: layout with passage/arrival columns');
      return null;
    }
    // the same terminal position must carry the same name in every day band
    for (const pos of [0, 1]) {
      const names = new Set(cols.filter((_, i) => i % 2 === pos).map((c) => norm(nameOf(c))));
      if (names.size > 1) {
        warn(`REJECT: terminal names differ between day bands (${[...names].join(' | ')})`);
        return null;
      }
    }
    for (const c of cols) {
      const name =c.words.sort((a, d) => a.y - d.y || a.x - d.x).map((w) => w.str.trim()).join(' ').replace(/\s+/g, ' ');
      const day = labels.reduce((best, l) => (Math.abs(l.cx - c.cx) < Math.abs(best.cx - c.cx) ? l : best)).key;
      const m = name.split(/\s+destino\s+/i);
      const from = (m[0] || '').trim();
      const to = (m[1] ?? '').trim();
      const key = norm(from) + '>' + norm(to);
      if (!from) { warn('REJECT: column without terminal name'); return null; }
      const d = dirs.get(key) ?? { from, to, departures: {} };
      dirs.set(key, d);
      (d.departures[day] ??= []).push(...c.times.sort((a, z) => a.y - z.y).map((t) => ({ t: t.t, ...(t.marks.length ? { notes: [...new Set(t.marks)] } : {}) })));
    }
  }
  const directions = [...dirs.values()];
  // fill missing destination from the other direction's origin
  if (directions.length === 2) for (const [i, d] of directions.entries()) if (!d.to) d.to = directions[1 - i].from;

  // legend / observations
  const notes = {};
  const general = [];
  const rows = [];
  for (const it of items.filter((i) => i.y > obsY + 2).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const r = rows.find((r) => Math.abs(r.y - it.y) < 3);
    if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  let cur = null;
  for (const r of rows) {
    const its = r.items.sort((a, b) => a.x - b.x);
    const first = its[0].str.trim();
    const km = first.match(/^([a-zA-Z]\)|P\.\s?E\.|P\.\s?N\.\s?E\.)\s*(.*)$/) ?? first.match(/^([A-Z]{1,3})(?:\s+[-–]\s*(.*))?$/);
    if (km && !/^(n[ãa]o|nota)/i.test(first)) {
      cur = clean(km[1]);
      const rest = [km[2] ?? '', ...its.slice(1).map((i) => i.str.trim())].join(' ');
      notes[cur] = rest.replace(/^\s*[-–]\s*/, '').replace(/\s+/g, ' ').trim();
    } else if (/^(n[ãa]o se realizam|nota:|horário a realizar|eventualmente)/i.test(first)) {
      cur = null;
      general.push(its.map((i) => i.str.trim()).join(' '));
    } else if (cur && r.y - (rows[rows.indexOf(r) - 1]?.y ?? r.y) < 18) {
      notes[cur] += ' ' + its.map((i) => i.str.trim()).join(' ');
    }
  }
  return { notes, general, directions };
}
