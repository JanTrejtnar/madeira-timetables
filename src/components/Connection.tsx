// Search results in the style of the IDOS app: a compact card per connection (date, duration, one pair of rows per bus), and a detail
// page of the whole connection with the walks, the transfers and a fold-out of the intermediate stops; a bus opens its line.
import { useRef, useState, type ReactNode } from 'react';
import { useT, type Lang } from '../i18n';
import { stopLabel } from '../lib/text';
import { addDays, type Ymd } from '../lib/holidays';
import { tripStops } from '../lib/network';
import { midStops } from '../lib/ride';
import { cachedFoot } from '../lib/foot';
import { fmtMinutes } from '../lib/time';
import { connectionFare, formatEuro, type FareCard } from '../lib/fare';
import { WALK_M_PER_MIN, walkTo } from '../lib/walk';
import type { Picked } from '../lib/plannerForm';
import type { Itinerary, Leg } from '../lib/router';
import { badgeText, LEG_COLORS, LineBadge, MapPin, PrecisionWarning, dirLabel, lineRailCls, pdfHref, type RideEnds, type RideWhen, type Shared } from './common';
import { Icon } from './Icons';

type TFn = ReturnType<typeof useT>['t'];

/** Positions of a leg in the direction's own stop list (the trip may carry extra "Via" places). */
export function srcRide(l: Leg): { from: number; to: number } {
  const stops = tripStops(l.trip);
  const src = (pos: number) => stops.slice(0, pos).filter((s) => !s.via).length;
  return { from: src(l.fromPos), to: src(l.toPos) };
}

/** boarding time and service date of a leg, passed to the line detail so that it shows this very trip */
function rideWhen(l: Leg, base: Ymd): RideWhen {
  const d = dateOf(base, l.depart);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { dep: fmtMinutes(((l.depart % 1440) + 1440) % 1440), date: `${d.y}-${pad(d.m)}-${pad(d.d)}` };
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

const MS_DAY = 86_400_000;

/** "Wed 21. 10." */
export const shortDate = (d: Ymd, lang: Lang) => new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(d.y, d.m - 1, d.d)));

/**
 * When the connection leaves, for the head of a card: "in 2 h 14 min" while it is up to three hours ahead, otherwise the date
 * ("today" for the current day) and the time: "today at 9:05", "Wed 21. 10. at 9:05" (also for a departure that has already run).
 */
export function whenLabel(it: Itinerary, base: Ymd, now: Shared['ctx']['now'], t: TFn, lang: Lang): string {
  const dayDiff = Math.round((Date.UTC(base.y, base.m - 1, base.d) - Date.UTC(now.y, now.m - 1, now.d)) / MS_DAY);
  const ahead = dayDiff * 1440 + it.depart - now.minutes;
  if (ahead >= 0 && ahead <= 180) {
    const h = Math.floor(ahead / 60);
    const m = ahead % 60;
    return ahead === 0 ? t('now') : h === 0 ? t('inMin', { n: m }) : m === 0 ? t('inH', { h }) : t('inHm', { h, m });
  }
  const day = dateOf(base, it.depart);
  const date = dayDiff + Math.floor(it.depart / 1440) === 0 ? t('whenToday') : shortDate(day, lang);
  const mins = ((it.depart % 1440) + 1440) % 1440;
  return t('whenAt', { date, time: `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}` });
}

export function ConnectionCard({ it, shared, base, selected, onOpen, fromPt, toPt }: { it: Itinerary; shared: Shared; base: Ymd; selected: boolean; onOpen: () => void; fromPt?: Picked['pt']; toPt?: Picked['pt'] }) {
  const { t, lang } = useT();
  const { walkIn, walkOut } = endWalks(it, fromPt, toPt);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="connection"
      className={`block w-full overflow-hidden rounded-2xl border border-slate-200/70 bg-white text-left transition-colors hover:bg-slate-50/70 dark:border-slate-700/70 dark:bg-slate-900 dark:hover:bg-slate-800/60 ${selected && shared.desktop ? 'ring-2 ring-sky-500/70' : ''}`}
    >
      <span className="flex items-baseline justify-between gap-3 bg-slate-100 px-4 py-1.5 text-sm dark:bg-slate-800/80">
        <span className="font-semibold text-slate-700 first-letter:uppercase dark:text-slate-200" data-testid="connection-date">
          {whenLabel(it, base, shared.ctx.now, t, lang)}
        </span>
        <span className="shrink-0 text-slate-500 tabular-nums dark:text-slate-400">
          {duration(it.arrive - it.depart, t)}
          <Fare it={it} card={shared.fareCard} />
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
                <span className={`grid ${it.arrive >= 1440 ? 'grid-cols-[2.75rem_4.5rem_minmax(0,1fr)]' : 'grid-cols-[2.75rem_3.5rem_minmax(0,1fr)]'} items-baseline gap-x-1.5 gap-y-0.5`}>
                  <span className="row-span-2 self-center">
                    <LineBadge line={l.trip.line} />
                  </span>
                  <Time min={l.depart} est={l.departEstimated} t={t} className="font-semibold" />
                  <span className="truncate font-medium">{stopLabel(stops[l.fromPos], lang)}</span>
                  <Time min={l.arrive} est={l.arriveEstimated} t={t} className="font-semibold" />
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

/** Price of the connection for the card from the settings; small and grey so it stays in the background. */
function Fare({ it, card }: { it: Itinerary; card: FareCard }) {
  const { t, lang } = useT();
  if (card === 'yellow') return null;
  const price = connectionFare(card, it.legs.map((l) => l.depart));
  return (
    <span className="ml-1.5 text-xs text-slate-400 dark:text-slate-500" data-testid="fare" title={t('fareNote')}>
      · {price === 0 ? t('fareFree') : formatEuro(price, lang)}
    </span>
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
function Row({ time, rail, dot, children }: { time?: ReactNode; rail?: { cls: string; color?: string } | 'dashed'; dot?: 'big' | 'small' | 'end'; children: ReactNode }) {
  const bar = rail === 'dashed' ? 'border-l-2 border-dashed border-slate-300 dark:border-slate-600' : rail ? `w-1 rounded-full ${rail.cls}` : '';
  return (
    <div className="grid grid-cols-[3.5rem_1.25rem_minmax(0,1fr)] gap-x-2">
      <div className="pt-1.5 text-right text-[15px] font-semibold leading-5">{time}</div>
      <div className="relative">
        {rail && <span style={rail !== 'dashed' && rail.color ? { backgroundColor: rail.color } : undefined} className={`absolute left-1/2 -translate-x-1/2 ${dot ? 'bottom-0 top-3.5' : 'inset-y-0'} ${bar}`} />}
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

function Rides({ it, shared, base, fromPt, toPt, walkIn, walkOut }: { it: Itinerary; shared: Shared; base: Ymd; fromPt: Picked['pt']; toPt: Picked['pt']; walkIn: ReturnType<typeof endWalks>['walkIn']; walkOut: ReturnType<typeof endWalks>['walkOut'] }) {
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
        // with a transfer every bus has its own colour, the same as on the map
        const color = it.legs.length > 1 ? LEG_COLORS[i % LEG_COLORS.length] : undefined;
        const rail = { cls: color ? '' : lineRailCls(line), color };
        const mid = midStops(l.trip, l.fromPos, l.toPos);
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
                  onClick={() => shared.openLine(line.id, l.trip.dirIndex, srcRide(l), rideEnds(it, i, fromPt, toPt), rideWhen(l, base))}
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
                    {mid.map((m, k) => (
                      <li key={k} className="flex min-h-7 items-baseline gap-2 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                        <span className="w-12 shrink-0 text-slate-400 tabular-nums">{`${l.trip.estimated ? '~' : ''}${fmtMinutes(m.arrive)}`}</span>
                        <span className="min-w-0 wrap-break-word">
                          {stopLabel(m.stop, lang)}
                          {m.depart !== undefined && (
                            <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400" data-testid="mid-wait">
                              {t('stopWait', { n: m.depart - m.arrive })} · {t('stopDeparture')} {fmtMinutes(m.depart)}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
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

/** The whole connection: sticky bar (back, map, PDF), header with date and duration, the buses with walks and transfers, the map (phone) last. */
export function ConnectionDetail({ it, shared, base, onBack, fromPt, toPt, map, estimatedNote }: { it: Itinerary; shared: Shared; base: Ymd; onBack: () => void; fromPt: Picked['pt']; toPt: Picked['pt']; map: ReactNode; estimatedNote: ReactNode }) {
  const { t, lang } = useT();
  const { walkIn, walkOut } = endWalks(it, fromPt, toPt);
  const mapBox = useRef<HTMLDivElement>(null);
  // the first and the last stop of the connection, when the map has no position for them
  const endsOf = [it.legs[0].trip, it.legs[it.legs.length - 1].trip].map((trip, k) => tripStops(trip)[k === 0 ? it.legs[0].fromPos : it.legs[it.legs.length - 1].toPos]);
  const noPos = [...new Set(endsOf.filter((st) => st.lat === undefined || st.lon === undefined).map((st) => stopLabel(st, lang)))];
  const iconBtn = 'inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-full px-2 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-400/10';
  return (
    <div className="flex flex-col gap-3" data-testid="connection-detail">
      <div className="sticky top-(--header-h,0px) z-30 -mx-4 -mt-4 flex items-center gap-1 bg-slate-50/95 px-4 pb-3 pt-2.5 backdrop-blur dark:bg-slate-950/95 lg:-top-4">
        <button type="button" onClick={onBack} data-testid="connection-back" className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-400/10">
          <Icon name="back" className="size-4" />
          {t('connectionBack')}
        </button>
        <span className="ml-auto flex items-center gap-0.5">
          {map && (
            <button type="button" onClick={() => mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} aria-label={t('mapShort')} title={t('mapShort')} data-testid="scroll-to-map" className={iconBtn}>
              <Icon name="map" className="size-5" />
            </button>
          )}
          {it.legs.map((l, i) => (
            <a key={i} href={pdfHref(l.trip.line)} target="_blank" rel="noreferrer" aria-label={`${t('pdfShort')}: ${l.trip.line.number}`} title={`${t('pdfShort')}: ${l.trip.line.number}`} data-testid="open-pdf" className={iconBtn}>
              <Icon name="file" className="size-5" />
              {it.legs.length > 1 && <span className="text-xs">{badgeText(l.trip.line)}</span>}
            </a>
          ))}
        </span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white dark:border-slate-700/70 dark:bg-slate-900">
        <div className="flex items-baseline justify-between gap-3 bg-slate-100 px-4 py-1.5 text-sm dark:bg-slate-800/80">
          <span className="font-semibold text-slate-700 first-letter:uppercase dark:text-slate-200" data-testid="connection-date">
            {whenLabel(it, base, shared.ctx.now, t, lang)}
          </span>
          <span className="shrink-0 text-slate-500 tabular-nums dark:text-slate-400">
            {duration(it.arrive - it.depart, t)}
            <Fare it={it} card={shared.fareCard} />
          </span>
        </div>
        <div className="px-3 py-3">
          <Rides it={it} shared={shared} base={base} fromPt={fromPt} toPt={toPt} walkIn={walkIn} walkOut={walkOut} />
        </div>
      </div>
      {noPos.map((name) => (
        <p key={name} className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200" data-testid="approx-place">
          {t('approxPlace', { name })}
        </p>
      ))}
      {estimatedNote}
      {map && <div ref={mapBox} className="scroll-mt-[calc(var(--header-h,0px)+3.5rem)]">{map}</div>}
    </div>
  );
}
