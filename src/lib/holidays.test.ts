import { describe, expect, it } from 'vitest';
import { easter, holidayOn, likelySchoolPeriod, serviceDay } from './holidays';

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

describe('likelySchoolPeriod', () => {
  it('guesses summer and Christmas as holidays', () => {
    expect(likelySchoolPeriod({ y: 2026, m: 10, d: 19 })).toBe(true);
    expect(likelySchoolPeriod({ y: 2026, m: 7, d: 15 })).toBe(false);
    expect(likelySchoolPeriod({ y: 2026, m: 12, d: 23 })).toBe(false);
    expect(likelySchoolPeriod({ y: 2026, m: 3, d: 30 })).toBe(false); // Easter 2026-04-05
  });
});
