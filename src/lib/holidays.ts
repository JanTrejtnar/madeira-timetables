// Which timetable applies on a given date in Madeira (weekday / Saturday / Sunday & holidays).
// Fixed list of national and regional holidays, Funchal municipal holiday, and the timetable rules printed
// on the PDFs: no service on 25 Dec; 24 & 31 Dec, Carnival Tuesday and Holy Thursday run the Saturday timetable
// (unless they fall on a Sunday or holiday).

export interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

export type DayType = 'weekday' | 'saturday' | 'sunday';
export type HolidayScope = 'national' | 'regional' | 'municipal';

export interface Holiday {
  name: string;
  scope: HolidayScope;
  /** Only for municipal holidays: Portuguese name of the municipality. */
  municipality?: string;
}

const key = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const ymdKey = (v: Ymd) => key(v.y, v.m, v.d);

/** Easter Sunday (Gregorian), anonymous algorithm (Meeus/Jones/Butcher). */
export function easter(year: number): Ymd {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { y: year, m: month, d: day };
}

export function addDays(v: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(v: Ymd): number {
  return new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay();
}

/**
 * Holidays of a year, keyed by YYYY-MM-DD.
 * National: Portugal. Regional: Madeira (1 Jul Dia da Região, 26 Dec). Municipal: only Funchal (21 Aug,
 * Nossa Senhora do Monte) is included; other municipal holidays are not covered.
 */
export function holidaysOf(year: number): Map<string, Holiday> {
  const map = new Map<string, Holiday>();
  const add = (v: Ymd, h: Holiday) => map.set(ymdKey(v), h);
  const fixed = (m: number, d: number, name: string, scope: HolidayScope = 'national', municipality?: string) =>
    add({ y: year, m, d }, { name, scope, municipality });
  const e = easter(year);

  fixed(1, 1, 'Ano Novo');
  add(addDays(e, -2), { name: 'Sexta-feira Santa', scope: 'national' });
  add(e, { name: 'Páscoa', scope: 'national' });
  fixed(4, 25, 'Dia da Liberdade');
  fixed(5, 1, 'Dia do Trabalhador');
  add(addDays(e, 60), { name: 'Corpo de Deus', scope: 'national' });
  fixed(6, 10, 'Dia de Portugal');
  fixed(7, 1, 'Dia da Madeira', 'regional');
  fixed(8, 15, 'Assunção de Nossa Senhora');
  fixed(8, 21, 'Nossa Senhora do Monte', 'municipal', 'Funchal');
  fixed(10, 5, 'Implantação da República');
  fixed(11, 1, 'Todos os Santos');
  fixed(12, 1, 'Restauração da Independência');
  fixed(12, 8, 'Imaculada Conceição');
  fixed(12, 25, 'Natal');
  fixed(12, 26, 'Dia seguinte ao Natal', 'regional');
  return map;
}

/** Holiday on that date, ignoring municipal holidays of other municipalities than `municipalities`. */
export function holidayOn(v: Ymd, municipalities: readonly string[] = ['Funchal']): Holiday | null {
  const h = holidaysOf(v.y).get(ymdKey(v));
  if (!h) return null;
  if (h.scope === 'municipal' && !(h.municipality && municipalities.includes(h.municipality))) return null;
  return h;
}

export interface ServiceDay {
  /** null: no service at all (25 December). */
  type: DayType | null;
  reason: 'normal' | 'sunday' | 'holiday' | 'saturday-rule' | 'no-service';
  holiday?: Holiday;
  /** Name of the special day, e.g. "Terça-feira de Carnaval". */
  special?: string;
}

export function serviceDay(v: Ymd, municipalities: readonly string[] = ['Funchal']): ServiceDay {
  if (v.m === 12 && v.d === 25) return { type: null, reason: 'no-service', holiday: holidayOn(v, municipalities) ?? undefined };
  const wd = weekdayOf(v);
  const hol = holidayOn(v, municipalities);
  if (wd === 0) return { type: 'sunday', reason: 'sunday', holiday: hol ?? undefined };
  if (hol) return { type: 'sunday', reason: 'holiday', holiday: hol };

  const e = easter(v.y);
  const special =
    (v.m === 12 && v.d === 24) || (v.m === 12 && v.d === 31)
      ? v.d === 24 ? 'Véspera de Natal' : 'Passagem de ano'
      : ymdKey(v) === ymdKey(addDays(e, -47)) ? 'Terça-feira de Carnaval'
      : ymdKey(v) === ymdKey(addDays(e, -3)) ? 'Quinta-feira Santa'
      : undefined;
  if (special) return { type: 'saturday', reason: 'saturday-rule', special };
  return { type: wd === 6 ? 'saturday' : 'weekday', reason: 'normal' };
}

/**
 * Rough guess whether school timetables ("período escolar") apply. The real calendar changes every year, so
 * the app lets the user override this. Excludes summer, Christmas (20 Dec – 6 Jan) and Easter break.
 */
export function likelySchoolPeriod(v: Ymd): boolean {
  const md = v.m * 100 + v.d;
  if (md >= 611 && md <= 914) return false;
  if (md >= 1220 || md <= 106) return false;
  const e = easter(v.y);
  const t = Date.UTC(v.y, v.m - 1, v.d);
  const start = Date.UTC(e.y, e.m - 1, e.d - 9);
  const end = Date.UTC(e.y, e.m - 1, e.d + 1);
  return !(t >= start && t <= end);
}
