import { addDays, serviceDay, type DayType } from './holidays';
import { toMinutes, type MadeiraNow } from './time';
import type { DayKey, Departure, Direction, Line, Trip } from '../types';

export interface Timed extends Departure {
  /** Minutes since midnight of the service day; > 1439 means after midnight (next calendar day). */
  minutes: number;
}

export interface Ctx {
  now: MadeiraNow;
  /** true = "período escolar", false = "férias escolares" (only matters for lines that print both). */
  school: boolean;
  municipalities: readonly string[];
}

/** Day keys whose lists apply to a day type. */
export function keysFor(type: DayType, school: boolean): DayKey[] {
  return type === 'weekday' ? ['weekday', school ? 'weekday_school' : 'weekday_holiday'] : [type];
}

/** Departure list that applies to a day type; school-dependent weekday lists are selected by `school`. */
export function listFor(dir: Direction, type: DayType, school: boolean): Departure[] {
  const d = dir.departures;
  if (type === 'weekday') return d.weekday ?? (school ? d.weekday_school : d.weekday_holiday) ?? [];
  return d[type] ?? [];
}

/** Adds an absolute minute value; a time earlier than its predecessor rolls over to the next day. */
export function withMinutes(list: Departure[]): Timed[] {
  let offset = 0;
  let prev = -1;
  return list.map((dep) => {
    let m = toMinutes(dep.t) + offset;
    if (m < prev) {
      offset += 1440;
      m += 1440;
    }
    prev = m;
    return { ...dep, minutes: m };
  });
}

/** Trips of a direction that run on a day key (plain weekday trips also apply to the active school variant). */
export function tripsOn(dir: Direction, day: DayKey, school?: boolean): Trip[] {
  const keys: DayKey[] = day === 'weekday' && school !== undefined ? keysFor('weekday', school) : [day];
  return (dir.trips ?? []).filter((t) => t.days.some((d) => keys.includes(d)));
}

/**
 * Times at one stop (by index) over the trips of a day, sorted. A time earlier than the trip's first time is after
 * midnight.
 */
export function timesAtStop(dir: Direction, stopIdx: number, trips: Trip[]): Timed[] {
  const out: Timed[] = [];
  for (const trip of trips) {
    const t = trip.times[stopIdx];
    if (!t) continue;
    const first = trip.times.find(Boolean) as string;
    let minutes = toMinutes(t);
    if (minutes < toMinutes(first)) minutes += 1440;
    out.push({ t, minutes, ...(trip.notes ? { notes: trip.notes } : {}) });
  }
  void dir;
  return out.sort((a, b) => a.minutes - b.minutes);
}

export interface Upcoming extends Departure {
  /** minutes from now */
  inMin: number;
  /** 0 today, 1 tomorrow */
  dayOffset: number;
}

/** Shared "what's next" logic: late trips of yesterday, rest of today, and (if needed) the start of tomorrow. */
function upcoming(timesFor: (type: DayType) => Timed[], ctx: Ctx, limit: number): Upcoming[] {
  const out: Upcoming[] = [];
  const nowMin = ctx.now.minutes;
  const today = { y: ctx.now.y, m: ctx.now.m, d: ctx.now.d };
  const typeOf = (offset: number) => serviceDay(addDays(today, offset), ctx.municipalities).type;

  const yType = typeOf(-1);
  if (yType) {
    for (const t of timesFor(yType)) {
      if (t.minutes >= 1440 && t.minutes - 1440 >= nowMin) out.push({ ...t, inMin: t.minutes - 1440 - nowMin, dayOffset: 0 });
    }
  }
  const tType = typeOf(0);
  if (tType) {
    for (const t of timesFor(tType)) {
      if (t.minutes >= nowMin) out.push({ ...t, inMin: t.minutes - nowMin, dayOffset: 0 });
    }
  }
  if (out.length < limit) {
    const nType = typeOf(1);
    if (nType) {
      for (const t of timesFor(nType)) {
        if (t.minutes < 1440) out.push({ ...t, inMin: t.minutes + 1440 - nowMin, dayOffset: 1 });
      }
    }
  }
  return out.sort((a, b) => a.inMin - b.inMin).slice(0, limit);
}

/** Next departures of one direction from its terminal. */
export function nextDepartures(dir: Direction, ctx: Ctx, limit = 3): Upcoming[] {
  return upcoming((type) => withMinutes(listFor(dir, type, ctx.school)), ctx, limit);
}

/** Next real departures from a chosen stop; only for directions that have per-stop times (`trips`). */
export function nextAtStop(dir: Direction, stopIdx: number, ctx: Ctx, limit = 3): Upcoming[] {
  return upcoming(
    (type) => {
      const keys = keysFor(type, ctx.school);
      return timesAtStop(dir, stopIdx, (dir.trips ?? []).filter((t) => t.days.some((d) => keys.includes(d))));
    },
    ctx,
    limit,
  );
}

export interface BoardEntry {
  line: Line;
  dirIndex: number;
  dir: Direction;
  next: Upcoming[];
}

/** One row per (line, direction) with its next departures, soonest first. */
export function board(
  lines: Line[],
  ctx: Ctx,
  accept: (line: Line, dir: Direction) => boolean = () => true,
  limit = 3,
): BoardEntry[] {
  const rows: BoardEntry[] = [];
  for (const line of lines) {
    if (!line.hasParsedSchedule) continue;
    line.directions.forEach((dir, dirIndex) => {
      if (!accept(line, dir)) return;
      const next = nextDepartures(dir, ctx, limit);
      if (next.length) rows.push({ line, dirIndex, dir, next });
    });
  }
  return rows.sort((a, b) => a.next[0].inMin - b.next[0].inMin);
}

/** Day columns to show for a line, in display order. */
export function dayKeysOf(line: Line): DayKey[] {
  const keys = new Set<DayKey>();
  for (const d of line.directions) {
    for (const k of Object.keys(d.departures) as DayKey[]) if (d.departures[k]?.length) keys.add(k);
    for (const trip of d.trips ?? []) if (trip.times.some(Boolean)) for (const k of trip.days) keys.add(k);
  }
  const order: DayKey[] = ['weekday', 'weekday_school', 'weekday_holiday', 'saturday', 'sunday'];
  return order.filter((k) => keys.has(k));
}
