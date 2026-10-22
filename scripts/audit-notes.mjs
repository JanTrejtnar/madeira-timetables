// One-off audit of the legend notes parsed from the PDFs: lists notes that look cut off
// (ending in a dash, preposition, conjunction or a stub word) or too short to carry content.
// Notes already completed in data/note-fixes.json are checked after the fix is applied.
import { readFileSync } from 'node:fs';
import { loadNoteFixes, recodeNotes } from './lib-note-fixes.mjs';

const schedules = JSON.parse(readFileSync('data/schedules.json', 'utf8'));
const { fixes, recode } = loadNoteFixes();
const TAIL = /(?:^|\s)(?:paragem|até|a|à|ao|as|às|com|da|das|de|do|dos|e|em|na|nas|no|nos|o|os|ou|para|pela|pelo|por|só|sem|via|to|and|the|of|at|from|or|in|on|-|–|\/|,|\()$/i;
// reviewed by hand: the source cannot be read any better
const ACCEPTED = new Set();
const apply = process.argv.includes('--raw') ? false : true;

function problems(text) {
  const t = text.trim();
  const out = [];
  if (t.length < 4) out.push('shorter than 4 characters');
  if (/[-–/,(]$/.test(t)) out.push('ends with a dash or separator');
  else if (TAIL.test(t)) out.push('ends with a preposition / conjunction');
  if ((t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length) out.push('unbalanced parenthesis');
  if (/^(?!via )[a-zà-ž]/i.test(t) && /^[a-zà-ž]/.test(t) && t.length < 12) out.push('starts in lower case: probably a continuation');
  return out;
}

const byLine = new Map();
const add = (num, item) => {
  if (ACCEPTED.has(`${num}:${item.key}`)) return; if (!byLine.has(num)) byLine.set(num, []); byLine.get(num).push(item); };
// a trailing "/" is the separator before the English half of the bilingual legend; build-data strips it
const cleaned = (t) => String(t).replace(/\s*\/\s*$/, '');
let total = 0;
for (const l of schedules.lines) {
  if (apply) recodeNotes(l, recode[l.number]);
  const notes = { ...(l.notes || {}), ...(apply ? fixes[l.number] || {} : {}) };
  for (const [key, text] of Object.entries(notes)) {
    total++;
    const p = problems(cleaned(text));
    if (p.length) add(l.number, { key, text, why: p });
  }
  // codes that departures refer to but the legend does not define
  const known = new Set(Object.keys({ ...(l.notes || {}), ...(apply ? fixes[l.number] || {} : {}) }));
  const used = new Set();
  for (const d of l.directions || []) for (const day of Object.values(d.departures || {})) for (const dep of day) for (const c of dep.notes || []) used.add(c);
  for (const c of used) if (/^[A-Za-z*]{1,3}$/.test(c) && !known.has(c)) add(l.number, { key: c, text: '(missing)', why: ['code used by departures but not in the legend'] });
}
console.log(`${total} notes checked ${apply ? '(with data/note-fixes.json applied)' : '(raw parser output)'}`);
for (const [num, list] of byLine) {
  console.log(`\nline ${num}`);
  for (const n of list) console.log(`  ${n.key}: "${n.text}"  <- ${n.why.join('; ')}`);
}
console.log(`\n${byLine.size} lines with suspicious notes`);
if (byLine.size && process.argv.includes('--strict')) process.exit(1);
