// State of the planner form. It lives in App (not in PlannerTab), so opening a line and going back keeps it, and it is
// mirrored into the URL query (?from=…&to=…&date=…&time=…) so a reload or a shared link restores the same search.
import { OPERATORS, type OperatorId } from './operators';
import type { Ymd } from './holidays';

export interface Picked {
  text: string;
  key: string | null;
  /** point tapped on the map ("Pick on map"); dropped as soon as the text is edited */
  pt?: { lat: number; lon: number };
}

/** A field whose value is final: a suggestion or map point was picked, or the field is empty. Typed text is not settled until Enter. */
export const settled = (p: Picked) => p.key !== null || !!p.pt || !p.text.trim();

const fmtPt = (p: { lat: number; lon: number }) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
function parsePt(s: string | null): Picked['pt'] {
  const m = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(s ?? '');
  return m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180 ? { lat: +m[1], lon: +m[2] } : undefined;
}

export interface PlannerForm {
  from: Picked;
  to: Picked;
  /** "HH:MM" */
  time: string;
  /** "YYYY-MM-DD"; null = today (follows the clock) */
  date: string | null;
  /** operators to travel with; empty = all */
  ops: OperatorId[];
  directOnly: boolean;
}

export const ymdToIso = (v: Ymd) => `${v.y}-${String(v.m).padStart(2, '0')}-${String(v.d).padStart(2, '0')}`;
export function isoToYmd(s: string | null | undefined): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const v = { y: +m[1], m: +m[2], d: +m[3] };
  const dt = new Date(Date.UTC(v.y, v.m - 1, v.d));
  return dt.getUTCFullYear() === v.y && dt.getUTCMonth() === v.m - 1 && dt.getUTCDate() === v.d ? v : null;
}

const OP_IDS = OPERATORS.map((o) => o.id);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function emptyForm(nowMinutes: number): PlannerForm {
  const p = (n: number) => String(n).padStart(2, '0');
  return { from: { text: '', key: null }, to: { text: '', key: null }, time: `${p(Math.floor(nowMinutes / 60))}:${p(nowMinutes % 60)}`, date: null, ops: [], directOnly: false };
}

export function formFromQuery(search: string, nowMinutes: number): PlannerForm {
  const q = new URLSearchParams(search);
  const base = emptyForm(nowMinutes);
  const ops = (q.get('ops') ?? '').split(',').filter((x): x is OperatorId => (OP_IDS as string[]).includes(x));
  const time = q.get('time');
  const date = q.get('date');
  return {
    from: { text: q.get('from') ?? '', key: q.get('fk') || null, pt: parsePt(q.get('fp')) },
    to: { text: q.get('to') ?? '', key: q.get('tk') || null, pt: parsePt(q.get('tp')) },
    time: time && TIME.test(time) ? time : base.time,
    date: isoToYmd(date) ? date : null,
    ops,
    directOnly: q.get('direct') === '1',
  };
}

/** Query string (without "?") for the form; defaults are left out. */
export function formToQuery(f: PlannerForm): string {
  const q = new URLSearchParams();
  if (f.from.text) q.set('from', f.from.text);
  if (f.from.key) q.set('fk', f.from.key);
  if (f.from.pt) q.set('fp', fmtPt(f.from.pt));
  if (f.to.text) q.set('to', f.to.text);
  if (f.to.key) q.set('tk', f.to.key);
  if (f.to.pt) q.set('tp', fmtPt(f.to.pt));
  if (f.from.text || f.to.text) q.set('time', f.time);
  if (f.date) q.set('date', f.date);
  if (f.ops.length) q.set('ops', f.ops.join(','));
  if (f.directOnly) q.set('direct', '1');
  return q.toString();
}
