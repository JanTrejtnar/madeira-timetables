// Parser for the SAM / "Companhia de Autocarros da Madeira" master-sheet PDFs (east of the island).
// Each PDF is an Excel export: one table per line with day blocks ("Dias úteis", "Sábados", "Domingos e Feriados").
// Rows are trips, columns are stops with the time of passage. A table can hold two halves (outbound and return) that
// meet at the terminal, and a day block can stack several small tables with their own header. Text of other tables
// is hidden by clipping, see visibleItems().
import { visibleItems } from './lib-pdf.mjs';
import { norm } from './parse-siga-grid.mjs';

const DAY_RES = [
  ['weekday', /Weekdays|^Dias [uú]teis/i],
  ['saturday', /Saturdays|^S[aá]bados/i],
  ['sunday', /Sundays|^Domingos/i],
];
const TIME_RE = /^\s*(\d{1,2})[:.](\d{2})\s*(.*)$/;
const SUBLABEL = /^(Partida|P.ssagem|Passagem|Chegada)$/; // "P<ssagem" occurs: a glyph without mapping

export function isSam(items) {
  return items.some((i) => i.decoded) && items.some((i) => /Weekdays|Saturdays|Sundays and holidays/.test(i.str));
}

/** Rejoin letters of one word that were painted by separate text operations. */
function mergeTouching(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    const gap = last ? it.x - (last.x + last.w) : 0;
    if (last && Math.abs(last.y - it.y) < 0.8 && gap < 1.6 && gap > -1.5) {
      last.str += it.str;
      last.w = it.x + it.w - last.x;
    } else out.push({ ...it });
  }
  return out;
}

/** Marks after a time ("ga", "PNE", "Tsc", "b g") -> legend keys, longest key first; unknown parts are kept raw. */
function parseMarks(rest, keys) {
  const s = rest.replace(/\s+/g, '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const key = keys.find((k) => s.startsWith(k, i));
    if (key) {
      out.push(key);
      i += key.length;
    } else {
      out.push(s.slice(i));
      break;
    }
  }
  return [...new Set(out)];
}

const cluster = (values, gap) => {
  const sorted = [...values].sort((a, b) => a - b);
  const out = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (last && v - last.max <= gap) {
      last.max = v;
      last.vals.push(v);
    } else out.push({ max: v, vals: [v] });
  }
  return out.map((c) => c.vals.reduce((a, b) => a + b, 0) / c.vals.length);
};

const mins = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const cx = (i) => i.x + i.w / 2;

/** One header + its rows. Returns { names, grid, halves } or { reject }. */
function analyzeSegment(part, day, keys) {
  const cells = part.filter((i) => TIME_RE.test(i.str) || i.str.trim() === '-');
  if (!cells.length) return { reject: `no cells in a ${day} segment` };
  const firstY = Math.min(...cells.map((i) => i.y));

  // column anchors: the sub-header labels are centred over their column; times are sometimes left-aligned
  const subs = part.filter((i) => i.y < firstY - 1 && SUBLABEL.test(i.str.trim()));
  const subCols = cluster(subs.map(cx), 10);
  const cellCols = cluster(cells.map(cx), 25); // columns are at least ~30 apart; left-aligned times sit up to ~18 off
  const colsX = subCols.length >= 2 && subCols.length >= cellCols.length ? subCols : cellCols;
  if (process.env.SAM_DEBUG) console.log(day, 'subCols', subCols.map(Math.round).join(','), '| cellCols', cellCols.map(Math.round).join(','));
  const colOf = (c) => colsX.reduce((best, v, idx) => (Math.abs(v - c) < Math.abs(colsX[best] - c) ? idx : best), 0);

  // header names: each column takes the header cell covering it; a merged terminal cell ("BOQUEIRÃO" over Chegada and
  // Partida) is centred between two columns and covers neither, so unnamed columns take the header between them
  const head = part.filter((i) => i.y < firstY - 1 && !SUBLABEL.test(i.str.trim()) && i.str.trim() !== '');
  const names = colsX.map((c) => {
    const cover = head.filter((h) => c >= h.x - 3 && c <= h.x + h.w + 3).sort((p, q) => Math.abs(cx(p) - c) - Math.abs(cx(q) - c))[0];
    return cover ? { text: cover.str.trim(), id: head.indexOf(cover) } : { text: '', id: -1 };
  });
  names.forEach((n, k) => {
    if (n.text) return;
    const between = head
      .map((h, id) => ({ h, id }))
      .filter(({ h }) => (k + 1 < colsX.length && cx(h) > colsX[k] && cx(h) < colsX[k + 1]) || (k > 0 && cx(h) < colsX[k] && cx(h) > colsX[k - 1]))
      .sort((p, q) => Math.abs(cx(p.h) - colsX[k]) - Math.abs(cx(q.h) - colsX[k]))[0];
    if (between) names[k] = { text: between.h.str.trim(), id: between.id };
  });
  const headerless = names.every((n) => !n.text);
  if (!headerless && names.some((n) => !n.text)) return { reject: `unnamed column in a ${day} segment (${names.map((n) => n.text || '?').join(' | ')})` };

  // rows
  const rowsY = cluster(cells.map((c) => c.y), 3.5);
  const rowOf = (y) => rowsY.reduce((best, v, idx) => (Math.abs(v - y) < Math.abs(rowsY[best] - y) ? idx : best), 0);
  const grid = rowsY.map(() => colsX.map(() => null));
  let dups = 0;
  for (const c of cells) {
    const r = rowOf(c.y);
    const k = colOf(cx(c));
    // the same text painted twice in one cell is an artefact, anything else is a conflict
    if (grid[r][k] && !(grid[r][k].t && grid[r][k].t === (c.str.match(TIME_RE) ? `${c.str.match(TIME_RE)[1].padStart(2, '0')}:${c.str.match(TIME_RE)[2]}` : null))) {
      if (!(grid[r][k].dash && c.str.trim() === '-')) return { reject: `two different cells in one position (${day}): ${c.str.trim()}` };
    }
    if (grid[r][k]) {
      if (TIME_RE.test(c.str)) dups++;
      continue;
    }
    if (c.str.trim() === '-') grid[r][k] = { dash: true };
    else {
      const m = c.str.match(TIME_RE);
      grid[r][k] = { t: `${m[1].padStart(2, '0')}:${m[2]}`, marks: parseMarks(m[3], keys) };
    }
  }
  // place notes ("Até St. Cruz") sitting in a cell without a time
  for (const t of part.filter((i) => i.y >= firstY - 1 && !TIME_RE.test(i.str) && i.str.trim() !== '-' && !SUBLABEL.test(i.str.trim()) && !/^[A-Z]{4,}$/.test(i.str.trim()))) {
    const r = rowOf(t.y);
    if (Math.abs(rowsY[r] - t.y) > 3.5) continue;
    const k = colOf(cx(t));
    if (grid[r][k]?.t) grid[r][k].marks.push(t.str.trim());
    else if (!grid[r][k]) grid[r][k] = { dash: true, text: t.str.trim() };
  }

  // a lone centred label between rows ("Via Misericordia") marks the variant of the rows below it
  function rowLabelsOf() {
    const lone = part.filter((i) => i.y > firstY + 1 && !TIME_RE.test(i.str) && i.str.trim() !== '-' && !SUBLABEL.test(i.str.trim()) && rowsY.every((r) => Math.abs(r - i.y) > 3.5));
    const labels = cluster(lone.map((i) => i.y), 9).map((y) => ({ y, items: lone.filter((i) => Math.abs(i.y - y) < 9) })).filter((l) => l.items.length === 1);
    return rowsY.map((ry) => labels.filter((l) => l.y < ry).sort((a, b) => b.y - a.y)[0]?.items[0].str.trim() ?? null);
  }

  // halves: split where one terminal header covers two neighbouring columns, or - for a round trip that starts and ends
  // at the same place - in the middle
  if (headerless) return { names: null, ncols: colsX.length, grid, rowLabels: rowLabelsOf(), dups };
  let split = -1;
  let shared = false;
  for (let k = 1; k < names.length; k++) {
    if (names[k].id === names[k - 1].id) {
      split = k;
      break;
    }
  }
  if (split < 0 && names.length >= 4 && names.length % 2 === 0 && norm(names[0].text) === norm(names[names.length - 1].text)) {
    // same first and last stop: either two directions side by side, or one circular trip. A circular trip has times that
    // keep rising across the whole row.
    const half = names.length / 2;
    // the last column of the left half can be the shared terminal, so it does not count as "left" here
    const rowsBoth = grid.filter((row) => row.slice(0, half - 1).some((c) => c?.t) && row.slice(half).some((c) => c?.t));
    const rising = (row) => {
      let prev = -1;
      for (const c of row) {
        if (!c?.t) continue;
        let m = mins(c.t);
        if (m < prev && prev >= 1200 && m < 360) m += 1440;
        if (m < prev) return false;
        prev = m;
      }
      return true;
    };
    const circular = rowsBoth.length >= 1 && rowsBoth.filter(rising).length / rowsBoth.length >= 0.5;
    if (!circular) {
      split = half;
      // a terminal that has only one column ("ST. SERRA") is the last stop of the outbound and the first of the return trip
      if (norm(names[half - 1].text) !== norm(names[half].text)) shared = true;
    }
  }
  const halves = split < 0 ? [[0, names.length]] : shared ? [[0, split, true], [split - 1, names.length, true]] : [[0, split], [split, names.length]];
  return { names, ncols: colsX.length, grid, halves, rowLabels: rowLabelsOf(), dups };
}

/** Some PDFs hold several tables (e.g. a line and its variant); each is parsed on its own and the directions are joined. */
export async function parseSam(file, line, warn) {
  const all = mergeTouching(await visibleItems(file));
  const heads = all.filter((i) => /^Nºs?d+w*$/.test(i.str.trim()) && i.x < 140);
  const n = Math.max(1, heads.length);
  const parts = [];
  for (let k = 0; k < n; k++) {
    const r = await parseSamTable(file, line, warn, k);
    if (!r) return null;
    parts.push(r);
  }
  if (parts.length === 1) return parts[0];
  return { notes: Object.assign({}, ...parts.map((p) => p.notes)), general: [], directions: parts.flatMap((p) => p.directions) };
}

async function parseSamTable(file, line, warn, tableIdx) {
  const all = mergeTouching(await visibleItems(file));
  const obs = all.find((i) => /OBSERVA/i.test(i.str));
  const legendX = obs ? obs.x - 3 : Infinity;
  const inLegend = (i) => obs && i.x >= legendX && i.y >= obs.y - 2;
  const info = all.find((i) => /^Informa/.test(i.str.trim()));
  const infoY = info ? info.y - 2 : Infinity;

  // legend: "a - Via Aeroporto"
  const notes = {};
  for (const i of all) {
    if (!inLegend(i) || i === obs) continue;
    const m = i.str.trim().match(/^([A-Za-z]{1,3})\s+-\s+(.+)$/);
    if (m) notes[m[1]] = m[2].trim();
  }
  const keys = Object.keys(notes).sort((a, b) => b.length - a.length);

  const items = all.filter((i) => !inLegend(i) && i.y < infoY);
  const anchors = items.filter((i) => /^Nº\s?\d+\w*$/.test(i.str.trim()) && i.x < 140).sort((a, b) => a.y - b.y);
  if (!anchors.length) {
    warn('REJECT: no table header (Nº …) found');
    return null;
  }
  const anchor = anchors[tableIdx];
  const table = items.filter((i) => i.y >= anchor.y - 1 && i.y < (anchors[tableIdx + 1]?.y ?? Infinity) - 1);

  const labels = table
    .flatMap((i) => DAY_RES.filter(([, re]) => re.test(i.str.trim())).map(([key]) => ({ key, y: i.y })))
    .sort((a, b) => a.y - b.y);
  if (!labels.length) {
    // some tables name the day in the title: "PORTO DA CRUZ - Via Achada (Dias úteis)"
    const title = table.filter((i) => Math.abs(i.y - anchor.y) < 3).map((i) => i.str).join(' ');
    const inParens = title.match(/\(([^)]*)\)/)?.[1] ?? '';
    const d = DAY_RES.find(([, re]) => re.test(inParens.trim()));
    if (!d) {
      warn('REJECT: no day labels');
      return null;
    }
    labels.push({ key: d[0], y: anchor.y });
  }

  // blocks -> segments (a header row between two rows of cells starts a new small table)
  const segments = [];
  let dupTimes = 0;
  for (let b = 0; b < labels.length; b++) {
    const y0 = labels[b].y + 2;
    const y1 = b + 1 < labels.length ? labels[b + 1].y - 2 : Infinity;
    const part = table.filter((i) => i.y > y0 && i.y < y1 && !DAY_RES.some(([, re]) => re.test(i.str.trim())));
    const cellRows = cluster(part.filter((i) => TIME_RE.test(i.str) || i.str.trim() === '-').map((i) => i.y), 3.5);
    if (!cellRows.length) {
      warn(`REJECT: no cells in the ${labels[b].key} block`);
      return null;
    }
    const lone = part.filter(
      (i) => i.y > cellRows[0] + 1 && !TIME_RE.test(i.str) && i.str.trim() !== '-' && !SUBLABEL.test(i.str.trim()) && cellRows.every((r) => Math.abs(r - i.y) > 3.5),
    );
    // a header cluster only starts a new table when rows of cells follow it
    const cuts = cluster(lone.map((i) => i.y), 9)
      .filter((y) => lone.filter((i) => Math.abs(i.y - y) < 12).length >= 2)
      .map((y) => Math.min(...lone.filter((i) => Math.abs(i.y - y) < 12).map((i) => i.y)) - 1)
      .filter((y) => cellRows.some((r) => r > y));
    const bounds = [-Infinity, ...cuts, Infinity];
    for (let s = 0; s < bounds.length - 1; s++) {
      const seg = part.filter((i) => i.y > bounds[s] && i.y <= bounds[s + 1]);
      const r = analyzeSegment(seg, labels[b].key, keys);
      if (r.reject) {
        warn(`REJECT: ${r.reject}`);
        return null;
      }
      if (process.env.SAM_DEBUG) console.log(labels[b].key, r.names.map((n) => n.text).join(' | '), JSON.stringify(r.halves));
      dupTimes += r.dups;
      if (!r.names) {
        const prev = [...segments].reverse().find((sg) => sg.ncols === r.ncols);
        if (!prev) {
          warn(`REJECT: a ${labels[b].key} segment has no header and no earlier one to copy`);
          return null;
        }
        r.names = prev.names;
        r.halves = prev.halves;
      }
      segments.push({ day: labels[b].key, ...r });
    }
  }

  // halves -> directions: halves with the same ends and compatible stop names share one direction
  const halves = [];
  for (const seg of segments) {
    for (const [a, z, sharedTerminal] of seg.halves) {
      halves.push({ shared: !!sharedTerminal, day: seg.day, names: seg.names.slice(a, z).map((n) => n.text), rows: seg.grid.map((r) => r.slice(a, z)), labels: seg.rowLabels });
    }
  }
  halves.sort((p, q) => q.names.length - p.names.length);
  const mapInto = (master, names) => {
    const mk = master.map(norm);
    const map = [];
    let from = 0;
    for (let i = 0; i < names.length; i++) {
      let at = mk.indexOf(norm(names[i]), from);
      if (at < 0 && i === 0) at = 0; // terminals may be spelled differently in different blocks
      if (at < 0 && i === names.length - 1) at = master.length - 1;
      if (at < 0 || at < from) return null;
      map.push(at);
      from = at + 1;
    }
    return map;
  };
  const groups = [];
  for (const h of halves) {
    let placed = false;
    for (const g of groups) {
      const map = mapInto(g.master, h.names);
      const sameStart = norm(h.names[0]) === norm(g.master[0]);
      const sameEnd = norm(h.names[h.names.length - 1]) === norm(g.master[g.master.length - 1]);
      // all stop names found in order, and at least one end shared (e.g. a Sunday return trip that starts at Lombo Faias)
      if (map && (sameStart || sameEnd) && (map.length >= 2 || h.names.length <= 2)) {
        g.parts.push({ ...h, map });
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ master: h.names, parts: [{ ...h, map: h.names.map((_, i) => i) }] });
  }

  const directions = [];
  let dropped = 0;
  let droppedTimes = 0;
  let total = 0;
  for (const g of groups) {
    const trips = [];
    for (const p of g.parts) {
      for (const [ri, row] of p.rows.entries()) {
        const times = new Array(g.master.length).fill(null);
        const tripNotes = [];
        row.forEach((c, idx) => {
          if (!c) return;
          if (c.t) {
            times[p.map[idx]] = c.t;
            tripNotes.push(...c.marks);
          } else if (c.text) tripNotes.push(c.text);
        });
        if (!times.some(Boolean)) continue;
        // with a shared terminal column a lone time belongs to the other direction
        if (p.shared && times.filter(Boolean).length < 2) continue;
        if (p.labels?.[ri]) tripNotes.push(p.labels[ri]);
        let prev = -1;
        let bad = false;
        for (const t of times) {
          if (!t) continue;
          let m = mins(t);
          if (m < prev && prev >= 1200 && m < 360) m += 1440;
          if (m < prev) bad = true;
          prev = m;
        }
        total++;
        if (bad) {
          dropped++;
          droppedTimes += times.filter(Boolean).length;
          warn(`dropped a ${p.day} trip whose times go backwards (${times.filter(Boolean).join(' ')})`);
          continue;
        }
        trips.push({ days: [p.day], times, ...(tripNotes.length ? { notes: [...new Set(tripNotes)] } : {}) });
      }
    }
    directions.push({ master: g.master, trips });
  }

  // completeness: every time-like string of the visible table is in a trip
  const seen = table.reduce((n, i) => n + (TIME_RE.test(i.str) && !/^Informa/.test(i.str) ? 1 : 0), 0);
  const got = directions.reduce((n, d) => n + d.trips.reduce((a, t) => a + t.times.filter(Boolean).length, 0), 0);
  if (dropped > Math.max(1, total * 0.15)) {
    warn(`REJECT: ${dropped} of ${total} trips have inconsistent times`);
    return null;
  }
  if (seen !== got + droppedTimes + dupTimes) {
    warn(`REJECT: ${seen} time cells but ${got} placed`);
    return null;
  }

  const sameEnds = (a, b) => norm(a.master[0]) === norm(b.master[0]) && norm(a.master[a.master.length - 1]) === norm(b.master[b.master.length - 1]);
  const out = directions.filter((d) => d.trips.length).map((d, idx) => {
    const departures = {};
    for (const t of d.trips) {
      if (!t.times[0]) continue;
      for (const day of t.days) (departures[day] ??= []).push({ t: t.times[0], ...(t.notes ? { notes: t.notes } : {}) });
    }
    const sk = (t) => (mins(t) < 180 ? mins(t) + 1440 : mins(t));
    for (const k of Object.keys(departures)) departures[k].sort((a, b) => sk(a.t) - sk(b.t));
    const twin = directions.some((o, j) => j !== idx && sameEnds(o, d));
    return {
      variant: twin ? `via ${d.master.slice(1, -1).join(', ') || '—'}` : null,
      from: d.master[0],
      to: d.master[d.master.length - 1],
      shapeId: null,
      stopSource: 'pdf',
      stops: d.master.map((name) => ({ code: null, name })),
      departures,
      trips: d.trips,
    };
  });
  void line;
  return { notes, general: [], directions: out };
}
