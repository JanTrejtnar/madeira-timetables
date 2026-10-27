// Text clean-up for the data: HTML entities left in the scraped PDFs / pages ("Baía D&#039;Abra") and names printed in
// capitals ("CANIÇAL", "BAÇA D'ABRA") -> "Caniçal", "Baía d'Abra". Applied by build:data to every line, direction and stop.
import { expandName } from './lib-abbrev.mjs';
import { normName } from './lib-coords.mjs';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decodes numeric (&#039; &#x27;) and the common named HTML entities. */
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// lower-case in Portuguese names (except at the start)
const SMALL = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'ao', 'aos', 'as', 'na', 'nas', 'no', 'nos', 'em']);
// abbreviations of the timetables / operators that stay in capitals
const KEEP = new Set([
  'SAM', 'HF', 'CAM', 'ESCL', 'ESTR', 'RTP', 'CTT', 'EDF', 'ER', 'ISAL', 'STA', 'QTA', 'STO', 'APS', 'DR', 'AV', 'ENT', 'LEV', 'TV', 'RIB', 'LMB', 'BC', 'ENG',
  'CMDT', 'REST', 'ROT', 'TRAV', 'CMF', 'BP', 'PAV', 'COR', 'VISC', 'BMW', 'ZN', 'PSP', 'PTE', 'VW', 'RMP', 'LG', 'ESC', 'EEM', 'JRD', 'BR', 'SEC', 'CC', 'CEM',
  'PQ', 'CRSS', 'RG', 'CGD',
]);
// spellings that differ between the PDFs and the map
const FIXES = { "Baça d'Abra": "Baía d'Abra", 'Canical': 'Caniçal' };

const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w);

function titleWord(w, first) {
  if (/\d/.test(w) || KEEP.has(w)) return w;
  const ap = /^([DdLl])'(.+)$/.exec(w); // D'ABRA -> d'Abra
  if (ap) return (first ? ap[1].toUpperCase() : ap[1].toLowerCase()) + "'" + cap(ap[2]);
  if (w.length <= 2 && !SMALL.has(w.toLowerCase())) return w; // initials ("G N R"), "II"
  if (SMALL.has(w.toLowerCase())) return first ? cap(w) : w.toLowerCase();
  return cap(w);
}

/** True for a name with letters but none in lower case. */
const allCaps = (s) => /[A-ZÀ-Ý]/.test(s) && !/[a-zà-ÿ]/.test(s);

/** Entities decoded, spaces collapsed, ALL CAPS names in Title Case ("d'" and de/da/do/dos/das/e/ao/as/na/no/em in lower case, abbreviations kept). */
export function cleanName(raw) {
  let s = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  if (allCaps(s)) {
    let first = true;
    s = s.replace(/[^\s\-/,()]+/g, (w) => {
      const out = titleWord(w, first);
      first = false;
      return out;
    });
  }
  // "Baía D'Abra" -> "Baía d'Abra" (a French-style elision in the middle of a name)
  s = s.replace(/(?<=\S )D'(?=[A-ZÀ-Ý])/g, "d'");
  return expandName(FIXES[s] ?? s, normName);
}

const NAME_KEYS = new Set(['name', 'route', 'from', 'to']);
const SKIP_KEYS = /(url|file|local)$/i;

/** Cleans every string of a parsed line in place: entities everywhere, capitals in the name fields. Returns the number of changed strings. */
export function cleanTexts(node, key = '') {
  let changed = 0;
  if (Array.isArray(node)) {
    node.forEach((v, i) => {
      if (typeof v === 'string') {
        const c = decodeEntities(v);
        if (c !== v) { node[i] = c; changed++; }
      } else changed += cleanTexts(v, key);
    });
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') {
        if (SKIP_KEYS.test(k)) continue;
        const c = NAME_KEYS.has(k) ? cleanName(v) : decodeEntities(v);
        if (c !== v) { node[k] = c; changed++; }
      } else changed += cleanTexts(v, k);
    }
  }
  return changed;
}
