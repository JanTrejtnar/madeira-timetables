import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Some PDFs (operator SAM) embed subset fonts without a ToUnicode map: pdf.js then returns glyph codes, which are
// the ASCII code minus 29 (space = 3, digits = 19..28, "A" = 36 ...). Such a font is recognised by control characters
// (< 32) in its text. Accented letters have arbitrary glyph codes, mapped below from the corpus.
const SHIFT = 29;
const ACCENTS = {
  100: 'Ç', 204: 'Ç', 105: 'á', 109: 'ã', 111: 'ç', 112: 'é', 125: 'õ', 126: 'ú', 141: '’', 158: 'º', 174: 'Ã', 175: 'Õ',
};

function decodeShifted(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 32) out += " "; // synthetic space inserted by pdf.js (a real "=" is rare)
    else if (c in ACCENTS) out += ACCENTS[c];
    else if (c >= 3 && c <= 96) out += String.fromCharCode(c + SHIFT);
    else out += ch;
  }
  return out;
}

/** Extract positioned text items from a PDF: [{str, x, y, w, h, page}], y grows downward. */
export async function pdfItems(file) {
  const data = new Uint8Array(await readFile(file));
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const shifted = new Set(
      tc.items.filter((it) => it.str && [...it.str].some((ch) => ch.charCodeAt(0) < 32 && ch !== '\n' && ch !== '\t')).map((it) => it.fontName),
    );
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const str = shifted.has(it.fontName) ? decodeShifted(it.str) : it.str;
      if (!str.trim()) continue;
      out.push({ str: str.normalize('NFC'), x: it.transform[4], y: vp.height - it.transform[5], w: it.width, h: it.height, page: p, decoded: shifted.has(it.fontName), font: it.fontName, order: out.length });
    }
  }
  return out;
}

/**
 * Only the text that is really visible. Some PDFs (SAM) paint several overlapping tables and hide the others
 * by clipping every cell to its own rectangle; the plain text layer contains all of them. Here the page operator
 * list is walked and a text run is kept when its origin lies inside the clip rectangle in force.
 */
export async function visibleItems(file) {
  const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile(file));
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const H = page.getViewport({ scale: 1 }).height;
    const ol = await page.getOperatorList();
    const runs = [];
    let clip = null;
    let pending = null;
    const stack = [];
    let tm = [1, 0, 0, 1, 0, 0];
    let font = null;
    let size = 1;
    let fillColor = null;
    let lastPath = null;
    const whites = [];
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i];
      const a = ol.argsArray[i];
      if (fn === OPS.save) stack.push(clip);
      else if (fn === OPS.restore) clip = stack.pop() ?? null;
      else if (fn === OPS.constructPath) {
        // [ops, coords, [minX, minY, maxX, maxY]]
        pending = a[2] ? { x0: a[2][0], y0: a[2][1], x1: a[2][2], y1: a[2][3] } : null;
        lastPath = pending;
      } else if (fn === OPS.clip) {
        if (pending) {
          clip = clip
            ? { x0: Math.max(clip.x0, pending.x0), y0: Math.max(clip.y0, pending.y0), x1: Math.min(clip.x1, pending.x1), y1: Math.min(clip.y1, pending.y1) }
            : pending;
        }
      } else if (fn === OPS.endPath) pending = null;
      else if (fn === OPS.setFillRGBColor) fillColor = a;
      else if (fn === OPS.fill) {
        if (lastPath && fillColor && fillColor[0] > 250 && fillColor[1] > 250 && fillColor[2] > 250) {
          const r = clip ? { x0: Math.max(clip.x0, lastPath.x0), y0: Math.max(clip.y0, lastPath.y0), x1: Math.min(clip.x1, lastPath.x1), y1: Math.min(clip.y1, lastPath.y1) } : lastPath;
          if (r.x1 > r.x0 && r.y1 > r.y0) whites.push({ after: runs.length, ...r });
        }
      }
      else if (fn === OPS.beginText) tm = [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.setTextMatrix) tm = [...a];
      else if (fn === OPS.moveText) tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + a[0] * tm[0] + a[1] * tm[2], tm[5] + a[0] * tm[1] + a[1] * tm[3]];
      else if (fn === OPS.setFont) { font = a[0]; size = a[1] || 1; }
      else if (fn === OPS.showText) {
        // One text run can hold several table cells; a large negative adjustment (> 1 em) is the gap between them.
        const unit = (size * Math.abs(tm[0])) / 1000;
        const y = tm[5];
        let dx = 0;
        let cur = { str: '', x: tm[4], w: 0 };
        const pieces = [];
        const flush = () => {
          if (cur.str) pieces.push(cur);
        };
        for (const g of a[0]) {
          if (typeof g === 'number') {
            if (g <= -300) {
              flush();
              dx += -g * unit;
              cur = { str: '', x: tm[4] + dx, w: 0 };
            } else dx += -g * unit;
          } else {
            cur.str += g.unicode ?? '';
            cur.w += (g.width ?? 0) * unit;
            dx += (g.width ?? 0) * unit;
          }
        }
        flush();
        // letters of one word can arrive as separate pieces; rejoin pieces that touch
        const merged = [];
        for (const pc of pieces) {
          const last = merged[merged.length - 1];
          if (last && pc.x - (last.x + last.w) < 1.6) {
            last.str += pc.str;
            last.w = pc.x + pc.w - last.x;
          } else merged.push({ ...pc });
        }
        for (const pc of merged) {
          const visible = !clip || (pc.x >= clip.x0 - 0.6 && pc.x <= clip.x1 + 0.6 && y >= clip.y0 - 1.5 && y <= clip.y1 + 1.5);
          runs.push({ str: pc.str, font, x: pc.x, y: H - y, w: pc.w, h: size * Math.abs(tm[3]), visible, rawY: y });
        }
      }
    }
    const shifted = new Set(runs.filter((r) => [...r.str].some((ch) => ch.charCodeAt(0) < 32 && ch !== '\n' && ch !== '\t')).map((r) => r.font));
    const plus = plusFonts(runs, shifted);
    // text painted earlier and covered by a later white fill is not visible either
    runs.forEach((r, k) => {
      if (!r.visible) return;
      for (const w of whites) {
        if (w.after > k && r.x + 1 >= w.x0 && r.x + 1 <= w.x1 && r.rawY + 2 >= w.y0 && r.rawY + 2 <= w.y1) {
          r.visible = false;
          return;
        }
      }
    });
    for (const r of runs) {
      if (!r.visible) continue;
      const str = shifted.has(r.font) && !looksPlain(r.str) ? decodeShifted(r.str) : plus.has(r.font) ? decodePlus(r.str) : r.str;
      if (!str.trim()) continue;
      out.push({ str: str.normalize('NFC'), x: r.x, y: r.y, w: r.w, h: r.h, page: p, decoded: shifted.has(r.font) || plus.has(r.font), font: r.font, order: out.length });
    }
  }
  return out;
}

// A second kind of broken font: glyph code = ASCII + 29 ("MTWOR" is "07:25", "J" is "-"). It has no control characters
// to give it away, so a font qualifies when most of its texts decode to times or dashes.
function decodePlus(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out += c >= 61 && c <= 151 ? String.fromCharCode(c - 29) : ch;
  }
  return out;
}

function plusFonts(runs, shifted) {
  const stats = new Map();
  for (const r of runs) {
    if (shifted.has(r.font) || !r.str.trim()) continue;
    const s = stats.get(r.font) ?? { n: 0, hit: 0 };
    s.n++;
    if (/^\s*\d{1,2}[:.]\d{2}|^\s*-\s*$/.test(decodePlus(r.str))) s.hit++;
    stats.set(r.font, s);
  }
  return new Set([...stats].filter(([, s]) => s.n >= 3 && s.hit / s.n >= 0.6).map(([f]) => f));
}

/**
 * Some PDFs mix plain and shifted text in one font. A run without control characters that is a time, a dash or a
 * short mark ("07:25", "----", "PE") is plain text and must not be shifted.
 */
function looksPlain(str) {
  if ([...str].some((ch) => ch.charCodeAt(0) < 32)) return false;
  // a lowercase letter that is no accent glyph code cannot be shifted text (its codes end at 96): "Fazenda" is plain
  if ([...str].some((ch) => ch.charCodeAt(0) >= 97 && ch.charCodeAt(0) <= 122 && !(ch.charCodeAt(0) in ACCENTS))) return true;
  return /^\s*\d{1,2}[:.]\d{2}(\s*[A-Za-z]{0,3})*\s*$/.test(str) || /^\s*-+\s*$/.test(str) || /^[A-Za-z]{1,2}$/.test(str.trim());
}
