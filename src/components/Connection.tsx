// Search results in the style of the IDOS app: a compact card per connection (date, duration, one pair of rows per bus), and a detail
// page of the whole connection with the walks, the transfers and a fold-out of the intermediate stops; a bus opens its line.
import { useMemo, useState, type ReactNode } from 'react';
import { useT, type Lang } from '../i18n';
import { stopLabel } from '../lib/text';
import { addDays, type Ymd } from '../lib/holidays';
import { tripStops } from '../lib/network';
import { cachedFoot } from '../lib/foot';
import { fmtMinutes } from '../lib/time';
import { WALK_M_PER_MIN, walkTo } from '../lib/walk';
import type { Picked } from '../lib/plannerForm';
import type { Itinerary, Leg } from '../lib/router';
import { LineBadge, MapPin, PrecisionWarning, dirLabel, lineRailCls, type RideEnds, type Shared } from './common';
import { Icon } from './Icons';

type TFn = ReturnType<typeof useT>['t'];

/** Positions of a leg in the direction's own stop list (the trip may carry extra "Via" places). */
export function srcRide(l: Leg): { from: number; to: number } {
  const stops = tripStops(l.trip);
  const src = (pos: number) => stops.slice(0, pos).filter((s) => !s.via).length;
  return { from: src(l.fromPos), to: src(l.toPos) };
}

function Time({ min, est, t, className = '' }: { min: number; est: boolean; t: TFn; className?: string }) {
  return (
    <span className={`whitespace-nowrap tabular-nums ${className}`}>
      {est ? <span title={t('estimateWord')} className="text-amber-700 dark:text-amber-300">~{fmtMinutes(min)}</span> : fmtMinutes(min)}
      {min >= 1440 && <sup className="ml-0.5 text-[9px] text-slate-400">+1</sup>}
    </span>
  );
}

/** "45 min" or "2 h 14 min" */
export function duration(min: number, t: TFn): string {
  return min >= 60 ? t('durH', { h: Math.floor(min / 60), m: min % 60 }) : `${min} min`;
}

/** The walks at both ends of the connection: from the picked point to the first stop, from the last stop to the picked destination. */
export function endWalks(it: Itinerary, fromPt: Picked['pt'], toPt: Picked['pt']) {
  const last = it.legs.length - 1;
  const inStop = tripStops(it.legs[0].trip)[it.legs[0].fromPos];
  const outStop = tripStops(it.legs[last].trip)[it.legs[last].toPos];
  // the walk along the streets once it was fetched (the selected itinerary fetches it), else the straight line corrected for winding roads
  const real = (pt: Picked['pt'], stop: typeof inStop, back: boolean) => {
    if (!pt || stop.lat === undefined || stop.lon === undefined) return null;
    const route = back ? cachedFoot({ lat: stop.lat, lon: stop.lon }, pt) : cachedFoot(pt, { lat: stop.lat, lon: stop.lon });
    return route ? { m: route.m, min: Math.max(1, Math.round(route.m / WALK_M_PER_MIN)) } : null;
  };
  return { walkIn: real(fromPt, inStop, false) ?? walkTo(fromPt, inStop), walkOut: real(toPt, outStop, true) ?? walkTo(toPt, outStop) };
}

/** Where the leg starts / ends for the line detail: the picked point when the leg is the first / last one, else the stop itself. */
export function rideEnds(it: Itinerary, i: number, fromPt: Picked['pt'], toPt: Picked['pt']): RideEnds {
  return {
    ...(i === 0 ? { start: fromPt ?? (true as const) } : {}),
    ...(i === it.legs.length - 1 ? { end: toPt ?? (true as const) } : {}),
  };
}

const dateOf = (base: Ymd, min: number): Ymd => addDays(base, Math.floor(min / 1440));

/** "Wed 21. 10." — the weekday and date of the departure (after midnight: of the next day). */
function useDateLabel(base: Ymd, min: number, lang: Lang) {
  return useMemo(() => {
    const d = dateOf(base, min);
    return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(d.y, d.m - 1, d.d)));
  }, [base, min, lang]);
}

/** Dates and countdown line of a connection: "Wed 21. 10. · in 14 min" (the countdown only for a departure that is still ahead today). */
function whenLabel(it: Itinerary, date: string, now: Shared['ctx']['now'], dateText: string, t: TFn): string {
  const isToday = date === `${now.y}-${String(now.m).padStart(2, '0')}-${String(now.d).padStart(2, '0')}`;
  const ahead = it.depart - now.minutes;
  return isToday && ahead >= 0 ? `${dateText} · ${t('departsIn', { d: duration(ahead, t) })}` : dateText;
}

export function ConnectionCard({ it, shared, date, base, selected, onOpen, fromPt, toPt }: { it: Itinerary; shared: Shared; date: string; base: Ymd; selected: boolean; onOpen: () => void; fromPt?: Picked['pt']; toPt?: Picked['pt'] }) {
  const { t, lang } = useT();
  const { walkIn, walkOut } = endWalks(it, fromPt, toPt);
  const dateText = useDateLabel(base, it.depart, lang);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="connection"
      className={`block w-full overflow-hidden rounded-2xl border border-slate-200/70 bg-white text-left transition-colors hover:bg-slate-50/70 dark:border-slate-700/70 dark:bg-slate-900 dark:hover:bg-slate-800/60 ${selected && shared.desktop ? 'ring-2 ring-sky-500/70' : ''}`}
    >
      <span className="flex items-baseline justify-between gap-3 bg-slate-100 px-4 py-1.5 text-sm dark:bg-slate-800/80">
        <span className="font-semibold text-slate-700 dark:text-slate-200" data-testid="connection-date">
          {whenLabel(it, date, shared.ctx.now, dateText, t)}
        </span>
        <span className="shrink-0 text-slate-500 tabular-nums dark:text-slate-400">
          {duration(it.arrive - it.depart, t)}
          {it.legs.length > 1 && <span className="ml-1.5 text-xs">· {t('oneTransfer')}</span>}
        </span>
      </span>
      <span className="flex items-stretch gap-1 py-2.5 pl-4 pr-2">
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          {walkIn && <WalkLine label={t('walkShort', { m: walkIn.m, n: walkIn.min })} testId="walk-in" />}
          {it.legs.map((l, i) => {
            const stops = tripStops(l.trip);
            const prev = it.legs[i - 1];
            return (
              <span key={i} className="flex flex-col gap-2">
                {prev && <span className="pl-12 text-xs text-slate-400">{t('waitMin', { n: l.depart - prev.arrive })}</span>}
                <span className="grid grid-cols-[2.75rem_3.5rem_minmax(0,1fr)] items-baseline gap-x-1.5 gap-y-0.5">
                  <span className="row-span-2 self-center">
                    <LineBadge line={l.trip.line} />
                  </span>
                  <Time min={l.depart} est={l.departEstimated} t={t} className="font-semibold" />
                  <span className="truncate font-medium">{stopLabel(stops[l.fromPos], lang)}</span>
                  <Time min={l.arrive} est={l.arriveEstimated} t={t} className="text-slate-600 dark:text-slate-300" />
                  <span className="truncate text-slate-600 dark:text-slate-300">{stopLabel(stops[l.toPos], lang)}</span>
                </span>
              </span>
            );
          })}
          {walkOut && <WalkLine label={t('walkShort', { m: walkOut.m, n: walkOut.min })} testId="walk-out" />}
        </span>
        <Icon name="chevron" className="size-5 shrink-0 self-center text-sky-600" />
      </span>
    </button>
  );
}

function WalkLine({ label, testId }: { label: string; testId: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400" data-testid={testId}>
      <span aria-hidden="true" className="w-11 text-center">🚶</span>
      {label}
    </span>
  );
}

/** One row of the detail timeline: time | rail | content. */
function Row({ time, rail, dot, children }: { time?: ReactNode; rail?: { cls: string } | 'dashed'; dot?: 'big' | 'small' | 'end'; children: ReactNode }) {
  const bar = rail === 'dashed' ? 'border-l-2 border-dashed border-slate-300 dark:border-slate-600' : rail ? `w-1 rounded-full ${rail.cls}` : '';
  return (
    <div className="grid grid-cols-[3.5rem_1.25rem_minmax(0,1fr)] gap-x-2">
      <div className="pt-1.5 text-right text-[15px] font-semibold leading-5">{time}</div>
      <div className="relative">
        {rail && <span className={`absolute left-1/2 -translate-x-1/2 ${dot ? 'bottom-0 top-3.5' : 'inset-y-0'} ${bar}`} />}
        {dot === 'big' && <span className="absolute left-1/2 top-2.5 z-10 size-3 -translate-x-1/2 rounded-full bg-sky-600 ring-4 ring-white dark:ring-slate-900" />}
        {dot === 'small' && <span className="absolute left-1/2 top-2.5 z-10 size-3 -translate-x-1/2 rounded-full border-[2.5px] border-slate-500 bg-white dark:border-slate-400 dark:bg-slate-900" />}
        {dot === 'end' && <Icon name="pin" className="absolute left-1/2 top-1.5 z-10 size-5 -translate-x-1/2 fill-white text-sky-600 dark:fill-slate-900" strokeWidth={2} />}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function StopRow({ stop, lang }: { stop: Parameters<typeof MapPin>[0]['stop']; lang: Lang }) {
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-1 py-1 text-[15px] font-medium leading-5">
      <span className="min-w-0 wrap-break-word">{stopLabel(stop, lang)}</span>
      <PrecisionWarning stop={stop} />
      <MapPin stop={stop} />
    </div>
  );
}

function Rides({ it, shared, fromPt, toPt, walkIn, walkOut }: { it: Itinerary; shared: Shared; fromPt: Picked['pt']; toPt: Picked['pt']; walkIn: ReturnType<typeof endWalks>['walkIn']; walkOut: ReturnType<typeof endWalks>['walkOut'] }) {
  const { t, lang } = useT();
  const last = it.legs.length - 1;
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (i: number) => setOpen((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <div className="flex flex-col">
      {walkIn && (
        <Row time={<span className="font-normal text-slate-500 dark:text-slate-400">{fmtMinutes(it.legs[0].depart - walkIn.min)}</span>} rail="dashed">
          <p className="py-1.5 text-sm leading-5 text-slate-600 dark:text-slate-300" data-testid="walk-in">
            <span aria-hidden="true">🚶 </span>
            {t('walkToStop', { m: walkIn.m, n: walkIn.min, at: fmtMinutes(it.legs[0].depart) })}
          </p>
        </Row>
      )}
      {it.legs.map((l, i) => {
        const stops = tripStops(l.trip);
        const line = l.trip.line;
        const rail = { cls: lineRailCls(line) };
        const mid = stops.slice(l.fromPos + 1, l.toPos);
        const expanded = open.has(i);
        return (
          <div key={i}>
            <Row time={<Time min={l.depart} est={l.departEstimated} t={t} />} rail={rail} dot={i === 0 ? 'big' : 'small'}>
              <StopRow stop={stops[l.fromPos]} lang={lang} />
            </Row>
            <Row rail={rail}>
              <div className="my-1 flex flex-col gap-1">
                <button
                  type="button"
                  data-testid="open-leg"
                  className="flex w-full items-center gap-2.5 rounded-xl bg-slate-50 px-2.5 py-2 text-left transition-colors hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800"
                  onClick={() => shared.openLine(line.id, l.trip.dirIndex, srcRide(l), rideEnds(it, i, fromPt, toPt))}
                >
                  <LineBadge line={line} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{dirLabel(l.trip.dir, line.name)}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{t('rideStops', { n: l.stops, m: l.arrive - l.depart })}</span>
                  </span>
                  <Icon name="chevron" className="size-4 shrink-0 text-sky-600" />
                </button>
                {mid.length > 0 && (
                  <button type="button" onClick={() => toggle(i)} aria-expanded={expanded} data-testid="toggle-stops" className="flex min-h-9 items-center gap-1.5 self-start rounded-lg px-1 text-sm font-medium text-sky-700 dark:text-sky-300">
                    <Icon name="chevronDown" className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} strokeWidth={2.25} />
                    {t('intermediateStops', { n: mid.length })}
                  </button>
                )}
                {expanded && (
                  <ul className="mb-1 flex flex-col text-sm text-slate-600 dark:text-slate-300" data-testid="mid-stops">
                    {mid.map((s, k) => {
                      const tm = l.trip.times[l.fromPos + 1 + k];
                      return (
                        <li key={k} className="flex min-h-7 items-baseline gap-2 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                          <span className="w-12 shrink-0 text-slate-400 tabular-nums">{tm === null || tm === undefined ? '' : `${l.trip.estimated ? '~' : ''}${fmtMinutes(tm)}`}</span>
                          <span className="min-w-0 wrap-break-word">{stopLabel(s, lang)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Row>
            <Row time={<Time min={l.arrive} est={l.arriveEstimated} t={t} />} rail={i === last && !walkOut ? undefined : i === last ? 'dashed' : rail} dot={i === last ? 'end' : 'small'}>
              <StopRow stop={stops[l.toPos]} lang={lang} />
            </Row>
            {i === last && walkOut && (
              <Row time={<span className="font-normal text-slate-500 dark:text-slate-400">{fmtMinutes(l.arrive + walkOut.min)}</span>}>
                <p className="py-1.5 text-sm leading-5 text-slate-600 dark:text-slate-300" data-testid="walk-out">
                  <span aria-hidden="true">🚶 </span>
                  {t('walkToDest', { m: walkOut.m, n: walkOut.min })}
                </p>
              </Row>
            )}
            {i < last && (
              <Row rail="dashed">
                <p className="py-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  <b className="font-semibold text-slate-600 dark:text-slate-300">{t('transferWord')}</b>
                  {' · '}
                  {stopLabel(tripStops(it.legs[i + 1].trip)[it.legs[i + 1].fromPos], lang)}
                  {' · '}
                  {t('waitMin', { n: it.legs[i + 1].depart - l.arrive })}
                  {it.walk > 0 ? ` · ${t('walkMin', { n: it.walk })}` : ''}
                </p>
              </Row>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The whole connection: header with date and duration, the map (phone), then the buses with walks and transfers. */
export function ConnectionDetail({ it, shared, date, base, onBack, fromPt, toPt, map, estimatedNote }: { it: Itinerary; shared: Shared; date: string; base: Ymd; onBack: () => void; fromPt: Picked['pt']; toPt: Picked['pt']; map: ReactNode; estimatedNote: ReactNode }) {
  const { t, lang } = useT();
  const { walkIn, walkOut } = endWalks(it, fromPt, toPt);
  const dateText = useDateLabel(base, it.depart, lang);
  return (
    <div className="flex flex-col gap-3" data-testid="connection-detail">
      <button
        type="button"
        onClick={onBack}
        data-testid="connection-back"
        className="-ml-2 inline-flex h-10 items-center gap-1.5 self-start rounded-full px-3 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-400/10"
      >
        <Icon name="back" className="size-4" />
        {t('connectionBack')}
      </button>
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white dark:border-slate-700/70 dark:bg-slate-900">
        <div className="flex items-baseline justify-between gap-3 bg-slate-100 px-4 py-1.5 text-sm dark:bg-slate-800/80">
          <span className="font-semibold text-slate-700 dark:text-slate-200" data-testid="connection-date">
            {whenLabel(it, date, shared.ctx.now, dateText, t)}
          </span>
          <span className="shrink-0 text-slate-500 tabular-nums dark:text-slate-400">
            {duration(it.arrive - it.depart, t)}
            <span className="ml-1.5 text-xs">· {it.legs.length === 1 ? t('noTransfer') : t('oneTransfer')}</span>
          </span>
        </div>
        <div className="px-3 py-3">
          <Rides it={it} shared={shared} fromPt={fromPt} toPt={toPt} walkIn={walkIn} walkOut={walkOut} />
        </div>
      </div>
      {map}
      {estimatedNote}
    </div>
  );
}
