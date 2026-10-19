// Parser for two SIGA Rodoeste PDFs whose tables list one trip per row with its final destination:
//   Carreira 96  (Funchal - Corticeiras, Jardim Serra e Corrida): outbound table + inbound table side by side
//   Carreira 137 (Funchal - Covão): outbound page and inbound ("Origem") page, three day tables each.
// The column positions are fixed per file/page (measured on the PDFs) and every result is validated.
import { pdfItems } from './lib-pdf.mjs';

const TIME = /^\s*(?:(T)\s*-\s*)?(\d{1,2}):(\d{2})\s*(.*)$/;
const DASH = /^-{2,}$/;
const MARK = /(VR\*?|PE\.?|[a-z]\)|T|\*)/g;
const CAMARA = 'Estreito de Câmara de Lobos';

/** Column boundaries: cell i is [b[i], b[i+1]) */
const SPECS = {
  96: {
    pages: {
      1: { left: [0, 85, 120, 170, 290], right: [290, 330, 368, 405, 450, 510, 999] },
      2: { left: [0, 100, 135, 180, 290], right: [290, 330, 368, 405, 450, 497, 999] },
    },
  },
  137: {
    pages: {
      1: { left: [0, 100, 150, 290], right: [290, 340, 385, 999] },
      2: { left: [0, 100, 280], right: [280, 330, 999] },
    },
  },
};
const DAY_LABELS = [
  ['weekday', /Segunda a Sexta/i],
  ['saturday', /S[áa]bados?(\s+[úu]t(eis|il))?\s*$/i],
  ['sunday', /Domingos?\s+e\s+Feriados?/i],
];

const cluster = (vals, gap) => {
  const s = [...vals].sort((a, b) => a - b);
  const out = [];
  for (const v of s) {
    const l = out[out.length - 1];
    if (l && v - l.max <= gap) {
      l.max = v;
      l.vals.push(v);
    } else out.push({ max: v, vals: [v] });
  }
  return out.map((c) => c.vals.reduce((a, b) => a + b, 0) / c.vals.length);
};

const MARKTOK = /^(VR\*?|PE\.?|[a-z]\)|T|\*)$/;
/**
 * One table cell -> null (dash/empty), {t, marks} or undefined (text that is not a time).
 * Marks may stand before or after the time ("VR 07:45", "06:50 T", "T - 08:00", "(só aos Domingos) - 06h35").
 */
function cellTime(text) {
  let s = text.trim();
  if (!s || DASH.test(s)) return null;
  const extra = [];
  const d = s.match(/^\((só aos? Domingos?)\)\s*-?\s*(.*)$/i);
  if (d) {
    extra.push('só aos Domingos');
    s = d[2];
    if (!s) return null;
  }
  const m = s.match(/(\d{1,2})[:.h](\d{2})/);
  if (!m) return undefined;
  const rest = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/[-–]/g, ' ');
  const toks = rest.match(/VR\*?|PE\.?|[a-z]\)|T|\*/g) ?? [];
  if (rest.replace(/VR\*?|PE\.?|[a-z]\)|T|\*/g, '').trim()) return undefined;
  return { t: m[1].padStart(2, '0') + ':' + m[2], marks: [...new Set([...toks.map((t) => t.replace(')', '').replace('.', '')), ...extra])] };
}

/** rows of one table region: [{y, cells: string[]}] */
function rowsOf(items, bounds, y0, y1) {
  const inRegion = items.filter((i) => i.y > y0 && i.y < y1 && i.x >= bounds[0] && i.x < bounds[bounds.length - 1]);
  const ys = cluster(inRegion.map((i) => i.y), 3.5);
  return ys.map((y) => {
    const row = inRegion.filter((i) => Math.abs(i.y - y) <= 3.5).sort((a, b) => a.x - b.x);
    const cells = bounds.slice(0, -1).map((b, k) => row.filter((i) => i.x >= b && i.x < bounds[k + 1]).map((i) => i.str.trim()).join(' ').trim());
    return { y, cells };
  });
}

export function isRowTables(items, lineNumber) {
  return (lineNumber === '96' || lineNumber === '137') && items.some((i) => /DESTINO FINAL|Destino Final|Origem/i.test(i.str));
}

export async function parseRowTables(file, lineNumber, warn) {
  const spec = SPECS[lineNumber];
  const all = await pdfItems(file);
  const dirs = new Map(); // key -> {from, to, stops, trips}
  const add = (from, to, stops, times, day, marks, variant) => {
    const key = `${from}>${to}>${stops.join('|')}>${variant ?? ''}`;
    const d = dirs.get(key) ?? { variant: variant ?? null, from, to, stops, trips: [] };
    dirs.set(key, d);
    d.trips.push({ days: [day], times, ...(marks.length ? { notes: marks } : {}) });
  };
  let skipped = 0;
  let rowsSeen = 0;
  let rowsUsed = 0;
  const general = [];

  for (const page of [...new Set(all.map((i) => i.page))]) {
    const pg = spec.pages[Math.min(page, Object.keys(spec.pages).length)];
    const items = all.filter((i) => i.page === page);
    const labels = items
      .flatMap((i) => DAY_LABELS.filter(([, re]) => re.test(i.str.trim())).map(([key]) => ({ key, y: i.y, x: i.x })))
      .filter((l) => l.y < 700)
      .sort((a, b) => a.y - b.y);
    const obsY = Math.min(...items.filter((i) => /^Observa[çc][õo]es:$/.test(i.str.trim())).map((i) => i.y), Infinity);

    // a day label that has another label to its right on the same row (137, Saturday) belongs to the right table
    for (const side of ['left', 'right']) {
      const bounds = pg[side];
      const mine = labels.filter((l) => (side === 'left' ? l.x < bounds[bounds.length - 1] - 0 : l.x >= bounds[0] - 30));
      // 137 page 1 and 2 keep Saturday/Sunday on the right; 96 has full-width labels (centre) for both tables
      const own = lineNumber === '96' ? labels : mine;
      for (let b = 0; b < own.length; b++) {
        const y0 = own[b].y;
        const y1 = Math.min(own[b + 1]?.y ?? Infinity, obsY - 2);
        const rows = rowsOf(items, bounds, y0 + 4, y1);
        for (const r of rows) {
          const c = r.cells;
          const t0 = cellTime(c[0]);
          if (!c.some((x) => /\d{1,2}:\d{2}|^-{2,}$/.test(x))) continue; // headers and free text
          rowsSeen++;
          let ok = true;
          if (lineNumber === '137' && page === 1) {
            const t1 = cellTime(c[1]);
            const dest = c[2];
            if (t0 === undefined || t1 === undefined || !dest) ok = false;
            else if (t0 || t1) add('Funchal', dest, ['Funchal', 'Câmara de Lobos', dest], [t0?.t ?? null, t1?.t ?? null, null], own[b].key, [...(t0?.marks ?? []), ...(t1?.marks ?? [])]);
            else ok = false;
          } else if (lineNumber === '137') {
            const origin = c[1];
            if (!t0 || !origin) ok = false;
            else add(origin, 'Funchal', [origin, 'Funchal'], [t0.t, null], own[b].key, t0.marks);
          } else if (side === 'left') {
            const t1 = cellTime(c[1]);
            const dest = c[2];
            const via = c[3];
            if (t0 === undefined || t1 === undefined || !dest || (!t0 && !t1)) ok = false;
            else add('Funchal', dest, ['Funchal', CAMARA, dest], [t0?.t ?? null, t1?.t ?? null, null], own[b].key, [...(t0?.marks ?? []), ...(t1?.marks ?? []), ...(via ? [via] : [])]);
          } else {
            let o0 = cellTime(c[0]);
            const note0 = o0 === undefined && c[0].length < 90 ? c[0] : null;
            if (note0) o0 = null; // "Saída do Estreito às 13h15, Fontes, Corticeiras e Fôro": a remark, not a time
            const [o1, o2] = [cellTime(c[1]), cellTime(c[2])];
            const e = cellTime(c[4]);
            const f = cellTime(c[5]);
            if ([o1, o2, e, f].includes(undefined)) ok = false;
            else {
              const origin = o0 ? 'Corrida' : o1 ? 'Jardim Serra' : o2 ? 'Corticeiras' : null;
              const first = o0 ?? o1 ?? o2;
              const marks = [...(first?.marks ?? []), ...(e?.marks ?? []), ...(f?.marks ?? []), ...(c[3] ? [c[3]] : []), ...(note0 ? [note0] : [])];
              if (!e && !f && !first) ok = false;
              else if (origin) add(origin, 'Funchal', [origin, CAMARA, 'Funchal'], [first.t, e?.t ?? null, f?.t ?? null], own[b].key, marks);
              else add(CAMARA, 'Funchal', [CAMARA, 'Funchal'], [e?.t ?? null, f?.t ?? null], own[b].key, marks);
            }
          }
          if (ok) rowsUsed++;
          else {
            skipped++;
            if (process.env.ROW_DEBUG) console.log('skipped', page, side, JSON.stringify(c));
          }
        }
      }
    }
    // free text lines inside the tables ("(08:10 - Partida LEVADA NOVA …)")
    for (const i of items) if (/^\(?\d{1,2}:\d{2}\s*-\s*Partida|Sa[ií]da do Estreito|P\.Escolar \d|Termina na Escola/.test(i.str)) general.push(i.str.trim());
  }

  // legend: "a) Partida do Marco e Fonte da Pedra", "VR - VIA RÁPIDA" ...
  const notes = {};
  for (const page of [...new Set(all.map((i) => i.page))]) {
    const items = all.filter((i) => i.page === page);
    const obs = items.find((i) => /^Observa[çc][õo]es:$/.test(i.str.trim()));
    if (!obs) continue;
    const rows = cluster(items.filter((i) => i.y > obs.y).map((i) => i.y), 3.5);
    for (const y of rows) {
      const line = items.filter((i) => Math.abs(i.y - y) <= 3.5).sort((a, b) => a.x - b.x).map((i) => i.str.trim()).join(' ');
      const m = line.match(/^(?:([a-z])\)|(VR|PE\.?|T\)?|\*))\s*-?\s*(.+)$/);
      if (m) notes[(m[1] ?? m[2]).replace(/[.)]/g, '')] = m[3].trim();
      else if (/^Não se realizam|^Nota:/i.test(line)) general.push(line);
    }
  }

  if (!rowsUsed) {
    warn('REJECT: no rows parsed');
    return null;
  }
  if (skipped > Math.max(2, rowsSeen * 0.05)) {
    warn(`REJECT: ${skipped} of ${rowsSeen} rows could not be read`);
    return null;
  }
  if (skipped) warn(`${skipped} of ${rowsSeen} rows skipped`);
  // Times along a trip must rise. A small step back (<= 10 min) is levelled, a large one is a typo in the source
  // (e.g. 19:15 -> 13:45): that single time is dropped. Both are reported.
  const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
  const fmt = (m) => String(Math.floor((m % 1440) / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  for (const d of dirs.values()) {
    for (const t of d.trips) {
      let prev = -1;
      t.times = t.times.map((x, i) => {
        if (!x) return x;
        let m = mins(x);
        if (m < prev && prev >= 1200 && m < 300) m += 1440;
        if (m < prev) {
          if (prev - m <= 10) {
            warn('levelled ' + x + ' after ' + fmt(prev) + ' (' + d.from + ' > ' + d.to + ')');
            m = prev;
            prev = m;
            return fmt(prev);
          }
          warn('dropped ' + x + ' after ' + fmt(prev) + ' in the printed table (' + d.from + ' > ' + d.to + ')');
          return null;
        }
        prev = m;
        return x;
      });
    }
  }
  return { notes, general: [...new Set(general)], directions: [...dirs.values()].map((d) => ({ ...d, shapeId: null })) };
}
