// Parser for the "siga-grid" PDF family (SERVIÇO URBANO/INTERURBANO, "Partidas de: / Departures from:").
// Layout: two stop lists on the left (one per direction), then 3 day bands (Dias úteis / Sábados /
// Domingos e Feriados), each with one time column per terminal. Times exist for terminals only.
import { pdfItems } from './lib-pdf.mjs';

export const norm = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const STOP_RE = /^(.*?)\s*\(([A-Z]?\d+[A-Z]?)\)\s*$/;
const TIME_G = /(\d{1,2}):(\d{2})/g;
const MARK_RE = /[a-z]\)|\*/g;
const DAY_LABELS = [
  ['weekday', /^dias\s+[uú]teis(\s+\S+)?$/i],
  ['saturday', /^s[aá]bados?$/i],
  ['sunday', /^domingos(\s+e\s+feriados)?$/i],
];
export const codeKey = (c) => String(c).replace(/^C/, '');

export function isSigaGrid(items) {
  return items.some((i) => /Partidas (?:Centro )?de:/.test(i.str));
}

/** Split a text item that may contain several times into [{t, marks, x}] with approximate x. */
function timeTokens(it) {
  const out = [];
  const matches = [...it.str.matchAll(TIME_G)];
  matches.forEach((m, k) => {
    const end = k + 1 < matches.length ? matches[k + 1].index : it.str.length;
    const rest = it.str.slice(m.index + m[0].length, end);
    out.push({
      t: `${m[1].padStart(2, '0')}:${m[2]}`,
      marks: rest.match(MARK_RE) ?? [],
      x: it.x + (it.w * m.index) / it.str.length,
      y: it.y,
      w: (it.w * m[0].length) / it.str.length,
    });
  });
  return out;
}

export async function parseSigaGrid(file, shapes, warn) {
  const all = await pdfItems(file);
  const pages = [...new Set(all.map((i) => i.page))].sort((a, b) => a - b);
  const merged = { notes: {}, directions: [], method: null, dayLabels: {} };
  for (const p of pages) {
    const pageWarn = pages.length > 1 ? (m) => warn(`p${p}: ${m}`) : warn;
    const r = parsePage(all.filter((i) => i.page === p), shapes, pageWarn, pages.length > 1);
    if (!r) continue;
    Object.assign(merged.notes, r.notes);
    Object.assign(merged.dayLabels, r.dayLabels);
    merged.directions.push(...r.directions);
    merged.method ??= r.method;
  }
  return merged.directions.length ? merged : null;
}

function parsePage(items, shapes /* [{shapeId,name,poly,stops}] */, warn, multi) {

  // ---- time cells (everything that looks like a time and is not part of a stop name)
  const timeItems = items.filter((i) => /^\d{1,2}:\d{2}/.test(i.str.trim()) && !STOP_RE.test(i.str));
  const times = timeItems.flatMap(timeTokens);
  if (!times.length) return null;
  const firstY = Math.min(...times.map((t) => t.y));
  const lastY = Math.max(...times.map((t) => t.y));
  const minX = Math.min(...times.map((t) => t.x));

  // marks that sit in their own text item, right of a time
  for (const it of items) {
    if (!/^(?:[a-z]\)|\*)+$/.test(it.str.trim()) || it.y < firstY - 2 || it.y > lastY + 2) continue;
    const left = times.filter((t) => Math.abs(t.y - it.y) < 3 && t.x + t.w - 4 <= it.x).sort((a, b) => b.x - a.x)[0];
    if (left) left.marks.push(...(it.str.match(MARK_RE) ?? []));
  }

  // ---- legend: "a) Via Transval"
  const notes = {};
  for (const it of items) {
    const m = it.str.trim().match(/^([a-z])\)\s+(\S.*)$/);
    if (!m) continue;
    let text = m[2].trim();
    // a long note continues on the following lines at the same x ("… (não passa na paragem Monte PQ" / "Corujeira (1557))")
    let prev = it;
    for (;;) {
      const next = items.find((j) => j !== prev && Math.abs(j.x - it.x) < 4 && j.y - prev.y > 3 && j.y - prev.y <= 9.6 && !/^[A-Za-z]{1,2}\s*\)/.test(j.str.trim()) && !/Início|Starting|Término|Terminus|Ligação|Direct/.test(j.str) && !/^(and|or|to|from|the|at|on)\b/i.test(j.str.trim()));
      if (!next) break;
      text += ' ' + next.str.trim();
      prev = next;
    }
    notes[m[1]] = text.replace(/\s+[A-Za-z]\s*\)\s*$/, '').trim();
  }
  for (const it of items) {
    const m = it.str.trim().match(/^([a-z])\)$/);
    if (m && it.y > lastY + 4 && !notes[m[1]]) {
      const next = items.filter((j) => j !== it && Math.abs(j.y - it.y) < 3 && j.x > it.x).sort((a, b) => a.x - b.x)[0];
      if (next) notes[m[1]] = next.str.trim();
    }
  }

  // ---- time columns
  const xs = [...new Set(times.map((t) => Math.round(t.x)))].sort((a, b) => a - b);
  const cols = [];
  for (const x of xs) {
    const last = cols[cols.length - 1];
    if (last && x - last.x <= 4) continue;
    cols.push({ x });
  }
  const colOf = (t) => cols.reduce((best, c) => (Math.abs(c.x - t.x) < Math.abs(best.x - t.x) ? c : best));
  for (const t of times) t.col = colOf(t);

  // ---- day headers
  const dayHeads = [];
  for (const it of items) {
    for (const [key, re] of DAY_LABELS) if (re.test(it.str.trim()) && it.y < firstY) dayHeads.push({ key, cx: it.x + it.w / 2, y: it.y, label: it.str.trim() });
  }
  if (!dayHeads.length) { warn('no day headers found'); return null; }
  for (const c of cols) {
    const cx = c.x + 9;
    c.day = dayHeads.reduce((b, h) => (Math.abs(h.cx - cx) < Math.abs(b.cx - cx) ? h : b)).key;
  }

  // ---- column header names (terminals), the rows between "Departures from" and the first time
  const depRow = items.find((i) => /Departures from/.test(i.str));
  const hy0 = (depRow?.y ?? Math.max(...dayHeads.map((h) => h.y))) + 3;
  const headWords = items.filter((i) => i.y > hy0 && i.y < firstY - 2 && i.x > minX - 30 && !/\d{1,2}:\d{2}/.test(i.str));
  for (const c of cols) c.words = [];
  for (const w of headWords) {
    const cx = w.x + w.w / 2;
    const c = cols.reduce((b, k) => (Math.abs(k.x + 9 - cx) < Math.abs(b.x + 9 - cx) ? k : b));
    c.words.push(w);
  }
  for (const c of cols) c.name = c.words.sort((a, b) => a.y - b.y || a.x - b.x).map((w) => w.str.trim()).join(' ').replace(/\s+/g, ' ');

  const dayCols = {};
  for (const c of cols) (dayCols[c.day] ??= []).push(c);
  const widths = Object.values(dayCols).map((a) => a.length);
  const nDir = Math.max(...widths);
  if (nDir > 2) { warn(`more than 2 time columns per day (${nDir})`); return null; }
  for (const [d, a] of Object.entries(dayCols)) {
    if (a.length !== nDir) warn(`day ${d} has ${a.length} time columns, expected ${nDir}`);
  }
  // terminal names by position: use the most common name per position
  const posName = [0, 1].slice(0, nDir).map((p) => {
    const names = Object.values(dayCols).filter((a) => a.length === nDir).map((a) => a[p].name).filter(Boolean);
    const cnt = new Map();
    names.forEach((n) => cnt.set(n, (cnt.get(n) ?? 0) + 1));
    const best = [...cnt].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    if (cnt.size > 1) warn(`terminal name differs between day bands at column ${p + 1}: ${[...cnt.keys()].join(' | ')}`);
    return best;
  });
  if (posName.some((n) => !n)) warn('missing terminal name in header');

  // ---- departures per column position and day
  const deps = {}; // pos -> day -> [{t,notes}]
  for (const [day, arr] of Object.entries(dayCols)) {
    arr.forEach((c, pos) => {
      if (arr.length !== nDir) return;
      const list = times.filter((t) => t.col === c).sort((a, b) => a.y - b.y || a.x - b.x);
      ((deps[pos] ??= {})[day] ??= []).push(...list.map((t) => ({ t: t.t, ...(t.marks.length ? { notes: [...new Set(t.marks.map((m) => m.replace(')', ''))) ] } : {}) })));
    });
  }

  // ---- stop lists
  const stopItems = items
    .filter((i) => STOP_RE.test(i.str.trim()) && i.x + i.w < minX + 2)
    .map((i) => {
      const m = i.str.trim().match(STOP_RE);
      return { name: m[1].replace(/^\d\s+(?=\D)/, '').trim(), code: m[2], x: i.x, cx: i.x + i.w / 2, y: i.y };
    });
  if (!stopItems.length) {
    // some lines list stop names without codes
    const skip = /Início|Starting|Término|Terminus|Paragem|Bus stop|Código|Dia 2|On 2|Dias|Working|Sábados|Saturdays|Domingos|Sundays|Partidas|Departures|SERVI|URBAN|^\|$/;
    const legendY = Math.min(...items.filter((i) => /Início|Starting/.test(i.str)).map((i) => i.y), Infinity);
    for (const i of items) {
      if (i.x + i.w < minX - 2 && i.y > 40 && i.y < legendY - 2 && !skip.test(i.str)) {
        stopItems.push({ name: i.str.trim(), code: null, x: i.x, cx: i.x + i.w / 2, y: i.y });
      }
    }
    if (stopItems.length) warn('stops have no codes (names only)');
  }
  const sortedCx = stopItems.map((s) => s.cx).sort((a, b) => a - b);
  let split = null;
  let gap = 0;
  for (let k = 1; k < sortedCx.length; k++) {
    if (sortedCx[k] - sortedCx[k - 1] > gap) { gap = sortedCx[k] - sortedCx[k - 1]; split = (sortedCx[k] + sortedCx[k - 1]) / 2; }
  }
  let left = stopItems, right = [];
  if (nDir === 2 && gap > 25) {
    left = stopItems.filter((s) => s.cx < split);
    right = stopItems.filter((s) => s.cx >= split);
  } else if (nDir === 2) warn('could not split two stop lists');
  left.sort((a, b) => a.y - b.y);
  right.sort((a, b) => a.y - b.y);
  // candidate ordered lists: left top->bottom, right bottom->top
  const lists = nDir === 2 ? [{ side: 'left', stops: left }, { side: 'right', stops: [...right].reverse() }] : [{ side: 'left', stops: left }];

  // ---- directions: pair lists with shapes (by stop-code overlap), else by rule
  const shapeCodes = shapes.map((s) => new Set(s.stops.map((x) => codeKey(x.stop_code))));
  const score = (li, si) => {
    const L = lists[li].stops;
    return L.length ? L.filter((s) => shapeCodes[si].has(codeKey(s.code))).length / L.length : 0;
  };
  const assign = new Array(lists.length).fill(null); // list index -> shape index
  if (shapes.length) {
    if (lists.length === 2 && shapes.length === 2) {
      const a = score(0, 0) + score(1, 1), b = score(0, 1) + score(1, 0);
      assign.splice(0, 2, ...(a >= b ? [0, 1] : [1, 0]));
    } else if (lists.length === 1 && shapes.length >= 1) {
      assign[0] = shapes.map((_, si) => score(0, si)).reduce((bi, v, si, arr) => (v > arr[bi] ? si : bi), 0);
    } else {
      warn(`lists(${lists.length}) vs shapes(${shapes.length}) mismatch`);
    }
  }

  // time column position -> list index. Rule R: first header column departs from the *right* list's origin.
  // With shapes we can check names: origin of a direction = destination name of the other direction.
  const ruleMap = nDir === 2 ? { 0: 1, 1: 0 } : { 0: 0 }; // pos -> list idx
  let posToList = { ...ruleMap };
  let method = 'rule';
  if (nDir === 2 && shapes.length === 2 && assign[0] !== null && assign[1] !== null) {
    const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !['via', 'de', 'do', 'da'].includes(w)));
    const sim = (a, b) => { const A = tokens(a), B = tokens(b); const i = [...A].filter((x) => B.has(x)).length; return i / Math.max(1, Math.min(A.size, B.size)); };
    // list li has shape assign[li] whose name is the destination, so its origin is named like the other shape's name
    const originName = (li) => shapes[1 - assign[li]].name;
    const s0 = sim(posName[0], originName(0)) + sim(posName[1], originName(1)); // pos0->list0, pos1->list1
    const s1 = sim(posName[0], originName(1)) + sim(posName[1], originName(0));
    if (Math.abs(s0 - s1) > 0.25) {
      posToList = s0 > s1 ? { 0: 0, 1: 1 } : { 0: 1, 1: 0 };
      method = 'names';
      if (posToList[0] !== ruleMap[0]) warn('terminal names contradict layout rule (names used)');
    }
  }

  const headY = Math.min(...dayHeads.map((h) => h.y));
  const variant = multi
    ? items
        .filter((i) => i.y < headY - 2 && !STOP_RE.test(i.str.trim()) && !/SERVI|URBAN|^\|$/.test(i.str))
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((i) => i.str.trim())
        .slice(1)
        .join(' ')
    : null;
  const directions = [];
  for (let pos = 0; pos < nDir; pos++) {
    const li = posToList[pos];
    const si = assign[li];
    const sh = si !== null && si !== undefined ? shapes[si] : null;
    const pdfStops = lists[li].stops.map((s) => ({ code: s.code, name: s.name }));
    let stops = pdfStops;
    let stopSource = 'pdf';
    if (sh) {
      const pdfName = new Map(pdfStops.map((p) => [codeKey(p.code), p.name]));
      const shStops = sh.stops.map((s) => ({ code: s.stop_code, name: pdfName.get(codeKey(s.stop_code)) ?? s.stop_name, lat: Number(s.stop_lat), lon: Number(s.stop_lon) }));
      const common = pdfStops.filter((p) => shStops.some((s) => codeKey(s.code) === codeKey(p.code))).length;
      if (common / Math.max(1, pdfStops.length) >= 0.6) { stops = shStops; stopSource = 'shapedata'; }
      else warn(`shapedata ${sh.shapeId} overlaps only ${common}/${pdfStops.length} PDF stops; using PDF stops`);
    }
    directions.push({
      variant,
      from: posName[pos],
      to: nDir === 2 ? posName[1 - pos] : sh?.name ?? '',
      shapeId: sh?.shapeId ?? null,
      stopSource,
      stops,
      departures: deps[pos] ?? {},
    });
  }
  const plain = /^(dias\s+[uú]teis|s[aá]bados|domingos e feriados)$/i;
  const dayLabels = Object.fromEntries(dayHeads.filter((h) => !plain.test(h.label)).map((h) => [h.key, h.label]));
  return { notes, directions, method, dayLabels };
}
