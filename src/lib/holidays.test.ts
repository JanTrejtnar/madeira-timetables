import { describe, expect, it } from 'vitest';
import { easter, holidayOn, isMadeiraSchoolDay, likelySchoolPeriod, serviceDay } from './holidays';

describe('easter', () => {
  it('computes known dates', () => {
    expect(easter(2024)).toEqual({ y: 2024, m: 3, d: 31 });
    expect(easter(2025)).toEqual({ y: 2025, m: 4, d: 20 });
    expect(easter(2026)).toEqual({ y: 2026, m: 4, d: 5 });
  });
});

describe('serviceDay', () => {
  it('normal days', () => {
    expect(serviceDay({ y: 2026, m: 10, d: 19 }).type).toBe('weekday'); // Monday
    expect(serviceDay({ y: 2026, m: 10, d: 17 }).type).toBe('saturday');
    expect(serviceDay({ y: 2026, m: 10, d: 18 }).type).toBe('sunday');
  });
  it('Madeira holidays use the Sunday timetable', () => {
    expect(serviceDay({ y: 2026, m: 7, d: 1 })).toMatchObject({ type: 'sunday', reason: 'holiday' }); // Wednesday
    expect(serviceDay({ y: 2026, m: 12, d: 26 }).type).toBe('sunday');
  });
  it('21 August is a holiday only in Funchal', () => {
    expect(holidayOn({ y: 2026, m: 8, d: 21 }, ['Funchal'])?.name).toBe('Nossa Senhora do Monte');
    expect(holidayOn({ y: 2026, m: 8, d: 21 }, ['Machico'])).toBeNull();
    expect(serviceDay({ y: 2026, m: 8, d: 21 }, ['Machico']).type).toBe('weekday'); // Friday
  });
  it('25 December has no service', () => {
    expect(serviceDay({ y: 2026, m: 12, d: 25 }).type).toBeNull();
  });
  it('Saturday rule: 24/31 Dec, Carnival Tuesday, Holy Thursday', () => {
    expect(serviceDay({ y: 2026, m: 12, d: 24 })).toMatchObject({ type: 'saturday', reason: 'saturday-rule' }); // Thursday
    expect(serviceDay({ y: 2026, m: 12, d: 31 }).type).toBe('saturday');
    expect(serviceDay({ y: 2026, m: 2, d: 17 }).type).toBe('saturday'); // Carnival Tuesday 2026
    expect(serviceDay({ y: 2026, m: 4, d: 2 }).type).toBe('saturday'); // Holy Thursday 2026
    expect(serviceDay({ y: 2026, m: 4, d: 3 }).type).toBe('sunday'); // Good Friday
  });
  it('Saturday rule does not override Sunday', () => {
    expect(serviceDay({ y: 2025, m: 12, d: 28 }).type).toBe('sunday');
    expect(serviceDay({ y: 2023, m: 12, d: 31 }).type).toBe('sunday'); // Sunday
  });
});

describe('school period', () => {
  const p = (y: number, m: number, d: number) => likelySchoolPeriod({ y, m, d });
  it('summer, Christmas, Carnival and Easter are breaks', () => {
    expect(p(2026, 10, 19)).toBe(true);
    expect(p(2026, 6, 30)).toBe(true);
    expect(p(2026, 7, 1)).toBe(false);
    expect(p(2026, 9, 10)).toBe(false);
    expect(p(2026, 9, 11)).toBe(true);
    expect(p(2026, 12, 17)).toBe(true);
    expect(p(2026, 12, 18)).toBe(false);
    expect(p(2027, 1, 2)).toBe(false);
    expect(p(2027, 1, 3)).toBe(true);
    // Easter 2026-04-05, Shrove Tuesday 2026-02-17 (Monday 16 - Sunday 22)
    expect(p(2026, 2, 15)).toBe(true);
    expect(p(2026, 2, 16)).toBe(false);
    expect(p(2026, 2, 22)).toBe(false);
    expect(p(2026, 2, 23)).toBe(true);
    expect(p(2026, 3, 28)).toBe(true);
    expect(p(2026, 3, 29)).toBe(false);
    expect(p(2026, 4, 12)).toBe(false);
    expect(p(2026, 4, 13)).toBe(true);
  });
  it('isMadeiraSchoolDay: weekdays in term only, never on holidays', () => {
    expect(isMadeiraSchoolDay(new Date('2026-10-19T12:00:00Z'))).toBe(true); // Monday
    expect(isMadeiraSchoolDay(new Date('2026-10-17T12:00:00Z'))).toBe(false); // Saturday
    expect(isMadeiraSchoolDay(new Date('2026-11-02T12:00:00Z'))).toBe(true);
    expect(isMadeiraSchoolDay(new Date('2026-11-01T12:00:00Z'))).toBe(false); // Sunday, All Saints
    expect(isMadeiraSchoolDay(new Date('2026-12-08T12:00:00Z'))).toBe(false); // Immaculate Conception
    expect(isMadeiraSchoolDay(new Date('2026-07-15T12:00:00Z'))).toBe(false); // summer
  });
});
