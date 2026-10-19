// Parser for the "Locais Passagem" PDFs: two tables side by side (one per direction); rows are stops, columns are
// trips, cells are times at that stop ("11h25", "13.30" or "----" = not served). Gives real intermediate times.
import { pdfItems } from './lib-pdf.mjs';

const TIME = /^(\d{1,2})[h.:](\d{2})$/;
const MARKONLY = /^([a-z]\)|[A-Z])$/;
const DASH = /^-{3,}$/;
const ENGLISH = /^(Monday|Only|Saturdays?|Sundays?|Every|Everyday|Weekends?|Weekdays?|School|Working|Holidays?|and|to|on|Fridays?|days?|Days?)\b/;

export function isPassage(items) {
  return items.some((i) => i.str.trim() === 'Locais Passagem');
}

/** Header text of a trip column -> list of day keys, plus an optional footnote mark. */
function resolveDays(text) {
  let s = text
    .replace(/\b(Weekdays?|Weekends?|Every\s?day|Mondays?|Fridays?|Saturdays?|Sundays?|Holidays?|School|Only|and|to|on)\b/gi, ' ')
    .replace(/[-–/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let mark = null;
  const m = s.match(/\s([a-z]\)|[A-Z])$/);
  if (m) {
    mark = m[1].replace(')', '');
    s = s.slice(0, m.index).trim();
  }
  const school = /P\.?\s?Escolar/i.test(s);
  s = s.replace(/P\.?\s?Escolar/i, '').trim();
  s = s.replace(/(Domingo|S[aá]bado)\s+s\b/i, '$1s'); // a final "s" painted as a separate piece
  // "2ª a Sábado" = Monday to Saturday
  if (/2ª\s*a\s*s[aá]bado/i.test(s)) s = s.replace(/2ª\s*a\s*s[aá]bado/i, '2ª a 6ª Sábados');
  const weekday = /2ª\s*a\s*6ª|segunda a sexta|dias [uú]teis/i.test(s);
  const sat = /s[aá]b/i.test(s);
  const sun = /dom|feriado/i.test(s);
  const all = /todos\s*os\s*dias/i.test(s);
  const rest = s
    .replace(/2ª\s*a\s*6ª|segunda a sexta|dias [uú]teis|feira|todos\s*os\s*dias|s[aá]b\w*\.?|dom\w*\.?|e\s*feriados?|feriados?|aos|\.|,|e\b/gi, '')
    .replace(/\s+/g, '')
    .trim();
  if (rest) return null;
  if (all) return { days: ['weekday', 'saturday', 'sunday'], mark };
  const days = [];
  if (weekday) days.push(school ? 'weekday_school' : 'weekday');
  if (sat) days.push('saturday');
  if (sun) days.push('sunday');
  return days.length ? { days, mark } : null;
}

const mins = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export async function parsePassage(file, warn) {
  const all = await pdfItems(file);
  const items = all.filter((i) => i.page === 1);
  if (all.some((i) => i.page > 1)) warn('multi-page PDF: only page 1 parsed');

  const obsY = Math.min(...items.filter((i) => /OBSERVA/i.test(i.str)).map((i) => i.y), Infinity);
  const lps = items.filter((i) => i.str.trim() === 'Locais Passagem').sort((a, b) => a.x - b.x);
  const notes = {};
  let usedVia = false;
  const directions = [];

  for (let k = 0; k < lps.length; k++) {
    const lp = lps[k];
    const x0 = k === 0 ? -Infinity : lp.x - 25;
    const x1 = k + 1 < lps.length ? lps[k + 1].x - 25 : Infinity;
    // stop names of a later table can start left of its "Locais Passagem" label
    const nameX0 = k === 0 ? -Infinity : lp.x - 60;
    const region = items.filter((i) => i.x >= x0 && i.x < x1 && i.y < obsY - 2);

    const timeIt = region.filter((i) => TIME.test(i.str.trim()));
    if (timeIt.length < 2) { warn(`REJECT: table ${k + 1} has no times`); return null; }
    const minCellX = Math.min(...region.filter((i) => TIME.test(i.str.trim()) || DASH.test(i.str.trim())).map((i) => i.x));
    const cellRaw = region.filter((i) => (TIME.test(i.str.trim()) || DASH.test(i.str.trim())) && i.y > lp.y);

    // cells, merging a note that follows the time in the same row ("18h20 Carreira nº 139")
    const cells = cellRaw.map((i) => {
      const str = i.str.trim();
      const note = region.find((o) => o !== i && Math.abs(o.y - i.y) < 3 && o.x >= i.x + i.w - 1 && o.x - (i.x + i.w) < 14 && !TIME.test(o.str.trim()) && !DASH.test(o.str.trim()) && !/^(VIA|RÁPIDA)$/i.test(o.str.trim()));
      const right = note ? note.x + note.w : i.x + i.w;
      return { str, y: i.y, cx: (i.x + right) / 2, note: note?.str.trim() };
    });

    // rows by y of cells
    const rowsY = [];
    for (const y of cells.map((c) => c.y).sort((a, b) => a - b)) if (!rowsY.length || y - rowsY[rowsY.length - 1] > 4) rowsY.push(y);
    const rowOf = (y) => rowsY.reduce((b, v, idx) => (Math.abs(v - y) < Math.abs(rowsY[b] - y) ? idx : b), 0);

    // columns by x
    const cxs = cells.map((c) => c.cx).sort((a, b) => a - b);
    const colsX = [];
    for (const x of cxs) {
      const last = colsX[colsX.length - 1];
      if (last && x - last.max <= 14) { last.max = x; last.xs.push(x); } else colsX.push({ max: x, xs: [x] });
    }
    const cols = colsX.map((c) => ({ cx: c.xs.reduce((a, b) => a + b, 0) / c.xs.length, header: [], times: new Array(rowsY.length).fill(null), seen: new Array(rowsY.length).fill(false), rowNotes: {}, via: false }));
    const colOf = (cx) => cols.reduce((b, c) => (Math.abs(c.cx - cx) < Math.abs(b.cx - cx) ? c : b));
    for (const c of cells) {
      const col = colOf(c.cx);
      const r = rowOf(c.y);
      if (col.seen[r]) { warn('REJECT: two cells in the same table position'); return null; }
      col.seen[r] = true;
      const m = c.str.match(TIME);
      if (m) col.times[r] = `${m[1].padStart(2, '0')}:${m[2]}`;
      if (c.note) col.rowNotes[r] = c.note;
    }

    // stop names
    const names = rowsY.map((y) =>
      items
        .filter((i) => i.y < obsY - 2 && Math.abs(i.y - y) < 5 && i.x + i.w <= minCellX - 2 && i.x > nameX0 && !TIME.test(i.str.trim()) && !DASH.test(i.str.trim()) && !/^(VIA|RÁPIDA)$/i.test(i.str.trim()) && i !== lp)
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str.trim())
        .join(' '),
    );
    if (names.some((n) => !n)) { warn('REJECT: stop row without a name'); return null; }

    // header text: items between the table title and the first row, grouped by x; each column takes the nearest group
    const firstY = rowsY[0];
    // the table title ("FUNCHAL - PORTO MONIZ", "HORÁRIO de PASSAGEM APROXIMADA") ends where the day headers begin
    const titles = region.filter((i) => i.y < lp.y - 2 && (/^\S.*\s-\s\S/.test(i.str.trim()) || /PASSAGEM APROXIMADA/i.test(i.str)) && /^[A-ZÁÂÃÇÉÊÍÓÔÕÚ]/.test(i.str.trim()));
    const titleY = titles.length ? Math.max(...titles.map((i) => i.y)) : lp.y - 14;
    const hdr = region
      .filter((i) => i.y > titleY + 3 && i.y < firstY - 4 && i !== lp && !ENGLISH.test(i.str.trim()) && !/^(VIA|RÁPIDA)$/i.test(i.str.trim()) && i.x + i.w > minCellX - 2 && !/^Carrei|^ra n.|^º$/.test(i.str.trim()) && !MARKONLY.test(i.str.trim()))
      .sort((p, q) => p.x + p.w / 2 - (q.x + q.w / 2));
    const groups = [];
    for (const i of hdr) {
      const cx = i.x + i.w / 2;
      const g = groups.find((g) => Math.abs(g.cx - cx) <= 18);
      if (g) { g.items.push(i); g.cx = g.items.reduce((n, o) => n + o.x + o.w / 2, 0) / g.items.length; } else groups.push({ cx, items: [i] });
    }
    if (process.env.PASSAGE_DEBUG) {
      console.log('table', k + 1, 'cols', cols.map((c) => Math.round(c.cx)).join(','));
      for (const g of groups) console.log('  hdr', Math.round(Math.min(...g.items.map((o) => o.x))) + '-' + Math.round(Math.max(...g.items.map((o) => o.x + o.w))), JSON.stringify(g.items.sort((p, q) => p.y - q.y).map((o) => o.str.trim()).join(' | ')));
    }
    // Columns take the day header whose block they fall in: blocks are bounded by the gaps between neighbouring header
    // texts, so one wide header ("2ª a 6ª Feira" x3) covers all columns up to the next header. Columns far outside every
    // header stay unresolved.
    groups.sort((a, b) => a.cx - b.cx);
    const ext = groups.map((g) => ({ g, x0: Math.min(...g.items.map((o) => o.x)), x1: Math.max(...g.items.map((o) => o.x + o.w)) }));
    for (const c of cols) {
      if (!ext.length) break;
      if (c.cx < ext[0].x0 - 80 || c.cx > ext[ext.length - 1].x1 + 80) continue;
      let pick = ext[0];
      for (let n = 1; n < ext.length; n++) {
        const boundary = (ext[n - 1].x1 + ext[n].x0) / 2;
        if (c.cx >= boundary) pick = ext[n];
      }
      c.header = pick.g.items;
    }
    for (const i of region) {
      if (i.y > titleY + 3 && i.y < firstY - 4 && MARKONLY.test(i.str.trim())) {
        const c = colOf(i.x + i.w / 2);
        c.mark = i.str.trim().replace(')', '');
      }
    }
    // VIA RÁPIDA labels inside the table body mark a column as express
    for (const i of region) {
      if (/^(VIA|RÁPIDA)$/i.test(i.str.trim()) && i.y > firstY - 2 && i.x > minCellX - 20) { colOf(i.x + i.w / 2).via = true; usedVia = true; }
    }

    const trips = [];
    for (const c of cols) {
      const text = c.header.sort((a, b) => a.y - b.y || a.x - b.x).map((i) => i.str.trim()).join(' ');
      const r = resolveDays(text);
      if (!r) { warn(`REJECT: unresolved day header "${text}"`); return null; }
      // monotonic down the column (wrap only after 20:00 into the early morning)
      // A small step back (<= 10 min) is an inconsistency of the printed timetable (stop order vs. times): the time is
      // levelled to the previous one and reported; a larger one means a misread column and rejects the line.
      let prev = -1;
      for (let i = 0; i < c.times.length; i++) {
        const t = c.times[i];
        if (!t) continue;
        let m = mins(t);
        if (m < prev && prev >= 1200 && m < 300) m += 1440;
        if (m < prev) {
          if (prev - m > 10) { warn(`REJECT: times not increasing in a trip column (${text}): ${c.times.filter(Boolean).join(' ')}`); return null; }
          warn(`levelled a time that goes back in the printed column (${text}): ${t} after ${fmt(prev)}`);
          c.times[i] = fmt(prev);
          m = prev;
        }
        prev = m;
      }
      if (c.times.filter(Boolean).length < 2) { warn('REJECT: trip with fewer than two times'); return null; }
      const tripNotes = [...new Set([...(r.mark ? [r.mark] : []), ...(c.mark ? [c.mark] : [])]), ...(c.via ? ['VR'] : [])];
      trips.push({ days: r.days, times: c.times, ...(tripNotes.length ? { notes: tripNotes } : {}), ...(Object.keys(c.rowNotes).length ? { rowNotes: c.rowNotes } : {}) });
    }

    // completeness: every time-like string of the table was placed
    const placed = trips.reduce((n, t) => n + t.times.filter(Boolean).length, 0);
    if (placed !== timeIt.filter((i) => i.y > lp.y).length) { warn(`REJECT: ${timeIt.length} time strings but ${placed} placed`); return null; }

    // terminal departures per day from the first stop
    const departures = {};
    for (const t of trips) {
      if (!t.times[0]) continue;
      for (const d of t.days) (departures[d] ??= []).push({ t: t.times[0], ...(t.notes ? { notes: t.notes } : {}) });
    }
    const sortKey = (t) => (mins(t) < 180 ? mins(t) + 1440 : mins(t));
    for (const d of Object.keys(departures)) departures[d].sort((a, b) => sortKey(a.t) - sortKey(b.t));

    directions.push({
      variant: null,
      from: names[0],
      to: names[names.length - 1],
      shapeId: null,
      stopSource: 'pdf',
      stops: names.map((name) => ({ code: null, name })),
      departures,
      trips,
    });
  }

  // legend
  const rows = [];
  for (const it of items.filter((i) => i.y > obsY + 2).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const r = rows.find((r) => Math.abs(r.y - it.y) < 3);
    if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  const general = [];
  let cur = null;
  for (const r of rows) {
    const its = r.items.sort((a, b) => a.x - b.x);
    const first = its[0].str.trim();
    const km = first.match(/^([a-z]\)|[A-Z]{1,3})(?:\s*[-–]\s*(.*))?$/);
    if (km && !/^(n[ãa]o|nota)/i.test(first)) {
      cur = km[1].replace(')', '');
      notes[cur] = [km[2] ?? '', ...its.slice(1).map((i) => i.str.trim())].join(' ').replace(/^\s*[-–]\s*/, '').replace(/\s+/g, ' ').trim();
    } else if (/^(n[ãa]o se realizam|nota:)/i.test(first)) {
      cur = null;
      general.push(its.map((i) => i.str.trim()).join(' '));
    } else if (cur) notes[cur] += ' ' + its.map((i) => i.str.trim()).join(' ');
  }
  if (usedVia) notes.VR ??= 'VIA RÁPIDA';
  return { notes, general, directions };
}

function fmt(m) {
  const x = m % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
}
