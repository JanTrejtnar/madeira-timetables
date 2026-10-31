import { describe, expect, it } from 'vitest';
import type { Direction } from '../types';
import { dayTypesOf, timesOfDay } from './LineView';

const dir = (trips: { days: ('weekday' | 'weekday_school' | 'weekday_holiday' | 'saturday')[]; t: string }[]) =>
  ({ from: 'A', to: 'B', stops: [{ code: null, name: 'A' }, { code: null, name: 'B' }], departures: {}, trips: trips.map((x) => ({ days: x.days, times: [x.t, '23:59'] })) }) as unknown as Direction;

describe('weekday variants merged into one choice', () => {
  it('offers only weekdays, Saturdays, Sundays', () => {
    expect(dayTypesOf(['weekday_school', 'weekday_holiday', 'saturday', 'sunday'])).toEqual(['weekday', 'saturday', 'sunday']);
    expect(dayTypesOf(['weekday_school'])).toEqual(['weekday']);
  });

  it('picks the calendar in force and marks trips of one calendar only', () => {
    const d = dir([{ days: ['weekday'], t: '07:00' }, { days: ['weekday_school'], t: '08:00' }, { days: ['weekday_holiday'], t: '09:00' }]);
    const school = timesOfDay(d, 'weekday', 0, true, true);
    expect(school.map((x) => x.t)).toEqual(['07:00', '08:00']);
    expect(school[0].notes).toBeUndefined();
    expect(school[1].notes).toEqual(['Apenas no período escolar']);
    const holiday = timesOfDay(d, 'weekday', 0, false, true);
    expect(holiday.map((x) => x.t)).toEqual(['07:00', '09:00']);
    expect(holiday[1].notes).toEqual(['Apenas fora do período escolar']);
  });

  it('merges terminal departure lists of the plain weekday and the calendar in force', () => {
    const d = { departures: { weekday: [{ t: '07:00' }], weekday_school: [{ t: '06:30' }], weekday_holiday: [{ t: '10:00' }] } } as unknown as Direction;
    expect(timesOfDay(d, 'weekday', 0, true).map((x) => x.t)).toEqual(['06:30', '07:00']);
    expect(timesOfDay(d, 'weekday', 0, false).map((x) => x.t)).toEqual(['07:00', '10:00']);
  });
});
