// 24-hour time picker and month calendar of the planner: replace the native <input type="time"|"date"> (AM/PM switch on some devices, no holidays).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { addDays, holidayOn, weekdayOf, type Ymd } from '../lib/holidays';
import { isoToYmd, ymdToIso } from '../lib/plannerForm';
import { Icon } from './Icons';

const PANEL_W = 288;

/** Trigger + popover: a bottom sheet on a phone, a dropdown (flipped to stay on screen) elsewhere. */
function Popover({ trigger, label, testid, children }: { trigger: (p: { open: boolean; toggle: () => void; id: string }) => ReactNode; label: string; testid: string; children: (close: () => void) => ReactNode }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    setAlignRight(root.current.getBoundingClientRect().left + PANEL_W > window.innerWidth - 8);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div ref={root} className="relative" data-testid={testid}>
      {trigger({ open, toggle: () => setOpen((o) => !o), id })}
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-slate-950/40 sm:hidden" aria-hidden />
          <div
            id={id}
            role="dialog"
            aria-label={label}
            className={`fixed inset-x-4 bottom-4 z-50 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2 sm:w-72 ${alignRight ? 'sm:right-0' : 'sm:left-0'}`}
          >
            {children(() => setOpen(false))}
            <button onClick={() => setOpen(false)} className="mt-3 h-10 w-full rounded-xl bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 sm:hidden">
              {t('pickerDone')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const triggerCls = (open: boolean) =>
  `flex h-9 items-center gap-1.5 rounded-full border bg-slate-50 pl-3 pr-3 text-sm font-semibold tabular-nums transition-colors hover:bg-white dark:bg-slate-800/60 dark:hover:bg-slate-800 ${
    open ? 'border-sky-500 ring-4 ring-sky-500/15' : 'border-slate-200 dark:border-slate-700'
  }`;
const cellCls = (on: boolean) =>
  `h-9 rounded-lg text-sm font-medium tabular-nums transition-colors ${on ? 'bg-sky-600 text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`;

const pad = (n: number) => String(n).padStart(2, '0');

/** "830", "8:30", "8.30", "08:30" -> "08:30"; null when it is not a 24-hour time. */
export function parseTime(raw: string): string | null {
  const s = raw.trim();
  const m = /^(\d{1,2})\s*[:.h]\s*(\d{2})$/.exec(s) ?? /^(\d{1,2})(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null;
}

export function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useT();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const [h, m] = value.split(':').map(Number);
  const valid = parseTime(draft) !== null;
  const commit = () => {
    const v = parseTime(draft);
    if (v) onChange(v);
    else setDraft(value);
  };
  return (
    <Popover
      label={t('departAt')}
      testid="time-picker"
      trigger={({ open, toggle, id }) => (
        <button type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} aria-label={`${t('departAt')}: ${value}`} data-testid="time-trigger" data-value={value} className={triggerCls(open)}>
          <Icon name="clock" className="size-4 text-slate-400" />
          {value}
        </button>
      )}
    >
      {() => (
        <div className="flex flex-col gap-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            inputMode="numeric"
            autoComplete="off"
            aria-label={t('pickerTimeHint')}
            aria-invalid={!valid}
            placeholder="HH:MM"
            data-testid="time-input"
            className={`h-11 w-full rounded-xl border bg-slate-50 px-3 text-center text-2xl font-semibold tabular-nums outline-none focus:ring-4 dark:bg-slate-800 ${valid ? 'border-slate-200 focus:border-sky-500 focus:ring-sky-500/15 dark:border-slate-700' : 'border-rose-400 focus:ring-rose-500/20'}`}
          />
          <div>
            <p className="mb-1 px-1 text-xs font-medium text-slate-500 dark:text-slate-400">{t('pickerHour')}</p>
            <div className="grid grid-cols-6 gap-1" role="group" aria-label={t('pickerHour')}>
              {Array.from({ length: 24 }, (_, i) => (
                <button key={i} type="button" aria-pressed={i === h} onClick={() => onChange(`${pad(i)}:${pad(m || 0)}`)} data-testid={`hour-${i}`} className={cellCls(i === h)}>
                  {pad(i)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 px-1 text-xs font-medium text-slate-500 dark:text-slate-400">{t('pickerMinute')}</p>
            <div className="grid grid-cols-6 gap-1" role="group" aria-label={t('pickerMinute')}>
              {Array.from({ length: 12 }, (_, i) => i * 5).map((i) => (
                <button key={i} type="button" aria-pressed={i === m} onClick={() => onChange(`${pad(h || 0)}:${pad(i)}`)} data-testid={`minute-${i}`} className={cellCls(i === m)}>
                  {pad(i)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Popover>
  );
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function DatePicker({ value, today, municipalities, onChange }: { value: string; today: Ymd; municipalities: readonly string[]; onChange: (iso: string) => void }) {
  const { t, lang } = useT();
  const cur = isoToYmd(value) ?? today;
  const [view, setView] = useState({ y: cur.y, m: cur.m });
  useEffect(() => setView({ y: cur.y, m: cur.m }), [cur.y, cur.m]);
  const fmt = useMemo(() => new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }), [lang]);
  const monthFmt = useMemo(() => new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }), [lang]);
  const weekdayFmt = useMemo(() => new Intl.DateTimeFormat(lang, { weekday: 'narrow', timeZone: 'UTC' }), [lang]);
  const asDate = (v: Ymd) => new Date(Date.UTC(v.y, v.m - 1, v.d));
  // Monday first: 2024-01-01 was a Monday
  const heads = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
  const lead = (weekdayOf({ y: view.y, m: view.m, d: 1 }) + 6) % 7;
  const cells: Ymd[] = Array.from({ length: 42 }, (_, i) => addDays({ y: view.y, m: view.m, d: 1 }, i - lead));
  const rows = Math.ceil((lead + daysIn(view.y, view.m)) / 7);
  const shift = (n: number) => setView((v) => ({ y: v.y + Math.floor((v.m - 1 + n) / 12), m: (((v.m - 1 + n) % 12) + 12) % 12 + 1 }));
  const holiday = holidayOn(cur, municipalities);
  const nav = 'grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800';
  return (
    <Popover
      label={t('dateLabel')}
      testid="date-picker"
      trigger={({ open, toggle, id }) => (
        <button type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} aria-label={`${t('dateLabel')}: ${value}`} data-testid="date-trigger" data-value={value} className={triggerCls(open)}>
          <Icon name="calendar" className="size-4 text-slate-400" />
          {fmt.format(asDate(cur))}
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => shift(-1)} aria-label={t('pickerPrevMonth')} className={nav}>
              <Icon name="chevron" className="size-4 rotate-180" />
            </button>
            <p className="text-sm font-semibold capitalize" aria-live="polite">
              {monthFmt.format(asDate({ ...view, d: 1 }))}
            </p>
            <button type="button" onClick={() => shift(1)} aria-label={t('pickerNextMonth')} className={nav}>
              <Icon name="chevron" className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center" role="grid">
            {heads.map((h, i) => (
              <span key={i} className={`py-1 text-xs font-medium ${i === 5 ? 'text-amber-600 dark:text-amber-400' : i === 6 ? 'text-rose-500 dark:text-rose-400' : 'text-slate-400'}`}>
                {h}
              </span>
            ))}
            {cells.slice(0, rows * 7).map((c, i) => {
              const iso = ymdToIso(c);
              const inMonth = c.m === view.m;
              const on = iso === ymdToIso(cur);
              const hol = holidayOn(c, municipalities);
              const col = i % 7;
              const isToday = iso === ymdToIso(today);
              const tone = on ? 'bg-sky-600 text-white' : hol || col === 6 ? 'text-rose-500 dark:text-rose-400' : col === 5 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200';
              return (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  aria-selected={on}
                  aria-current={isToday ? 'date' : undefined}
                  title={hol ? hol.name : undefined}
                  data-date={iso}
                  data-holiday={hol ? '1' : undefined}
                  onClick={() => {
                    onChange(iso);
                    close();
                  }}
                  className={`relative h-9 rounded-lg text-sm font-medium tabular-nums transition-colors ${on ? '' : 'hover:bg-slate-100 dark:hover:bg-slate-800'} ${inMonth ? '' : 'opacity-35'} ${isToday && !on ? 'ring-1 ring-sky-500' : ''} ${tone}`}
                >
                  {c.d}
                  {hol && <span className={`absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full ${on ? 'bg-white' : 'bg-rose-500'}`} />}
                </button>
              );
            })}
          </div>
          <p className="min-h-5 px-1 text-xs text-slate-500 dark:text-slate-400" data-testid="date-holiday">
            {holiday ? `${t('pickerHoliday')}: ${holiday.name}` : ''}
          </p>
        </div>
      )}
    </Popover>
  );
}
