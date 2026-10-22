// Departure picker of the planner (IDOS style): "Leave now" by default, a popover with drop-downs for the date, the hour and the minute.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { addDays, type Ymd } from '../lib/holidays';
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

const triggerCls = (open: boolean, now: boolean) =>
  `flex h-10 items-center gap-2 rounded-xl border bg-slate-50 px-3 text-sm font-semibold transition-colors hover:bg-white dark:bg-slate-800/60 dark:hover:bg-slate-800 ${
    open ? 'border-sky-500 ring-4 ring-sky-500/15' : 'border-slate-200 dark:border-slate-700'
  } ${now ? 'text-slate-700 dark:text-slate-200' : 'text-sky-700 dark:text-sky-300'}`;
const selectCls =
  'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-2 text-base font-medium tabular-nums outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15 dark:border-slate-700 dark:bg-slate-800';

const pad = (n: number) => String(n).padStart(2, '0');

/** Days offered in the date drop-down: a week back (a departure that has already run) and a few months ahead. */
const DAYS_BACK = 7;
const DAYS_AHEAD = 120;

export function DepartPicker({ time, date, today, nowMinutes, note, onChange }: { time: string | null; date: string | null; today: Ymd; nowMinutes: number; note?: string; onChange: (v: { time: string | null; date: string | null }) => void }) {
  const { t, lang } = useT();
  const todayIso = ymdToIso(today);
  const dateIso = date ?? todayIso;
  const [h, m] = (time ?? `${pad(Math.floor(nowMinutes / 60))}:${pad(nowMinutes % 60)}`).split(':').map(Number);
  const fmt = useMemo(() => new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' }), [lang]);
  const asDate = (v: Ymd) => new Date(Date.UTC(v.y, v.m - 1, v.d));
  const options = useMemo(() => Array.from({ length: DAYS_BACK + DAYS_AHEAD + 1 }, (_, i) => addDays(today, i - DAYS_BACK)).map((d) => ({ iso: ymdToIso(d), label: fmt.format(asDate(d)) })), [today, fmt]);
  const picked = isoToYmd(dateIso) ?? today;
  // the current choice may lie outside the list (a link with a far date): keep it selectable
  const dates = options.some((o) => o.iso === dateIso) ? options : [...options, { iso: dateIso, label: fmt.format(asDate(picked)) }];
  const set = (d: string, hh: number, mm: number) => onChange({ date: d === todayIso ? null : d, time: `${pad(hh)}:${pad(mm)}` });
  const isNow = time === null && date === null;
  const whenWord = dateIso === todayIso ? t('whenToday') : fmt.format(asDate(picked));
  const label = isNow ? t('departNow') : t('departOn', { when: `${whenWord} ${time ?? `${pad(h)}:${pad(m)}`}` });
  return (
    <Popover
      label={t('departAt')}
      testid="depart-picker"
      trigger={({ open, toggle, id }) => (
        <button type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} data-testid="depart-trigger" data-value={isNow ? 'now' : `${dateIso} ${time}`} className={triggerCls(open, isNow)}>
          <Icon name="clock" className="size-4 text-slate-400" />
          {label}
        </button>
      )}
    >
      {() => (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('dateLabel')}
            <select value={dateIso} onChange={(e) => set(e.target.value, h, m)} data-testid="depart-date" className={selectCls}>
              {dates.map((o) => (
                <option key={o.iso} value={o.iso}>
                  {o.iso === todayIso ? `${t('dayToday')}, ${o.label}` : o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('pickerHour')}
              <select value={h} onChange={(e) => set(dateIso, +e.target.value, m)} data-testid="depart-hour" className={selectCls}>
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {pad(i)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('pickerMinute')}
              <select value={m} onChange={(e) => set(dateIso, h, +e.target.value)} data-testid="depart-minute" className={selectCls}>
                {Array.from({ length: 60 }, (_, i) => (
                  <option key={i} value={i}>
                    {pad(i)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {note && (
            <p className="px-1 text-xs text-slate-500 dark:text-slate-400" data-testid="day-info">
              {note}
            </p>
          )}
          <button
            type="button"
            onClick={() => onChange({ time: null, date: null })}
            disabled={isNow}
            data-testid="depart-now"
            className="h-10 rounded-xl border border-slate-200 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 disabled:opacity-40 dark:border-slate-700 dark:text-sky-300 dark:hover:bg-sky-400/10"
          >
            {t('pickerNow')}
          </button>
        </div>
      )}
    </Popover>
  );
}
