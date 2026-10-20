// "Transbordo" supplement (page 2+ of some siga-grid PDFs, e.g. line 181): small tables where a shuttle connects the
// main bus with outlying places. Columns are stops, rows are runs, "Partidas/From:" marks the terminal column.
// Returns directions with per-stop trips (printed times are approximate passing times, as the PDF states).
import { pdfItems } from './lib-pdf.mjs';

const TIME = /^\d{1,2}:\d{2}$/;
const cx = (i) => i.x + i.w / 2;

export async function parseTransbordo(file, warn) {
  const all = await pdfItems(file);
  const pages = [...new Set(all.map((i) => i.page))].filter((p) => p > 1);
  const trips = []; // {stops, times, day, notes}
  const general = [];
  for (const p of pages) {
    const items = all.filter((i) => i.page === p);
    if (!items.some((i) => /^Transbordo/i.test(i.str.trim()))) continue;
    const day = items.some((i) => /^Dias [uú]teis/i.test(i.str.trim())) ? 'weekday' : null;
    if (!day) { warn(`transbordo page ${p}: day type not recognised`); continue; }
    // legend: "a) Transbordo junto ..."
    const legend = {};
    for (const i of items) {
      const m = i.str.trim().match(/^([a-z])\)\s+(\S.*)$/);
      if (m && i.y > 200) legend[m[1]] = m[2].trim();
      if (/^O hor[aá]rio indica/i.test(i.str.trim())) general.push(i.str.trim());
    }
    // tables start at each "Partidas/" header; a table ends where the next one starts (or at the legend)
    const heads = items.filter((i) => /^Partidas\/?$/.test(i.str.trim())).sort((a, b) => a.y - b.y);
    const legendY = Math.min(...items.filter((i) => /^[a-z]\)\s+\S/.test(i.str.trim())).map((i) => i.y), Infinity);
    for (const [ti, head] of heads.entries()) {
      const top = head.y - 2;
      const bottom = Math.min(heads[ti + 1] ? heads[ti + 1].y - 12 : Infinity, legendY - 2);
      const region = items.filter((i) => i.y >= top && i.y < bottom);
      const times = region.filter((i) => TIME.test(i.str.trim()));
      if (!times.length) continue;
      const firstRow = Math.min(...times.map((i) => i.y));
      // header: every non-time text above the first time row (names wrap over lines; "a)" / "b)" are marks)
      const hdr = region.filter((i) => i.y < firstRow - 3 && !/^(Partidas\/?|From:)$/.test(i.str.trim()) && !/^Dias|Working/.test(i.str));
      const cols = [];
      for (const h of hdr.sort((a, b) => cx(a) - cx(b))) {
        const c = cols.find((k) => Math.abs(k.x - cx(h)) < 28);
        if (c) { c.parts.push(h); c.x = c.parts.reduce((a, q) => a + cx(q), 0) / c.parts.length; } else cols.push({ x: cx(h), parts: [h] });
      }
      // terminal column: the "Partidas/From:" label sits over it (name on the line below, or the first column)
      const termLabel = region.find((i) => /^From:$/.test(i.str.trim()));
      const termX = termLabel ? cx(termLabel) - 8 : head.x + 20;
      const termName = region.filter((i) => i.y > head.y + 3 && i.y < firstRow - 1 && Math.abs(cx(i) - termX) < 40 && !TIME.test(i.str.trim()) && !/^[a-z]\)$/.test(i.str.trim()))
        .sort((a, b) => a.y - b.y).map((i) => i.str.trim()).join(' ');
      const columns = cols.map((c) => {
        const marks = c.parts.filter((q) => /^[a-z]\)$/.test(q.str.trim())).map((q) => q.str.trim()[0]);
        const name = c.parts.filter((q) => !/^[a-z]\)$/.test(q.str.trim())).sort((a, b) => a.y - b.y || a.x - b.x).map((q) => q.str.trim()).join(' ');
        return { x: c.x, name, marks };
      }).filter((c) => c.name && !(Math.abs(c.x - termX) < 25 && c.name === termName));
      for (const c of columns) c.name = c.name.replace(/^LMB /, 'Lombo '); // printed abbreviation of Lombo Chão
      const termLabelName = termName.replace(/^LMB /, 'Lombo ');
      if (termName) columns.push({ x: termX, name: termLabelName, marks: [], terminal: true });
      columns.sort((a, b) => a.x - b.x);
      const rows = new Map();
      for (const t of times) {
        const k = [...rows.keys()].find((y) => Math.abs(y - t.y) < 3) ?? t.y;
        const col = columns.reduce((b, c) => (Math.abs(c.x - cx(t)) < Math.abs(b.x - cx(t)) ? c : b), columns[0]);
        if (Math.abs(col.x - cx(t)) > 30) { warn(`transbordo: time ${t.str} outside any column`); continue; }
        (rows.get(k) ?? rows.set(k, []).get(k)).push({ col, t: t.str.trim().padStart(5, '0') });
      }
      for (const [, cells] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
        // a run leaves the terminal first when it is on the left (Funchal), and arrives there when it is on the right
        const leftTerminal = columns[0].terminal;
        cells.sort((a, b) => a.col.x - b.col.x);
        // column order of the run: terminal-left tables read left to right; terminal-right tables read the shuttle
        // legs in time order (the terminal is the last, connecting bus)
        cells.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : (a.col.terminal ? 1 : -1) * (leftTerminal ? -1 : 1)));
        const marks = [...new Set(cells.flatMap((c) => c.col.marks))];
        trips.push({
          day,
          stops: cells.map((c) => c.col.name),
          times: cells.map((c) => c.t),
          notes: marks.map((m) => legend[m]).filter(Boolean),
        });
      }
    }
  }
  if (!trips.length) return null;
  // group runs with the same stop sequence into one direction
  const dirs = new Map();
  for (const t of trips) {
    const key = t.stops.join('>');
    const d = dirs.get(key) ?? { variant: 'transbordo', from: t.stops[0], to: t.stops[t.stops.length - 1], stops: t.stops, trips: [] };
    d.trips.push({ days: [t.day], times: t.times, ...(t.notes.length ? { notes: t.notes } : {}) });
    dirs.set(key, d);
  }
  return { directions: [...dirs.values()], general };
}
