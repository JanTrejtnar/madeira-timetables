import type { Ymd } from './holidays';

export interface MadeiraNow extends Ymd {
  /** minutes since local midnight */
  minutes: number;
}

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Atlantic/Madeira',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

export function nowInMadeira(date: Date = new Date()): MadeiraNow {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, minutes: +p.hour * 60 + +p.minute };
}

export const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export const fmtMinutes = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
