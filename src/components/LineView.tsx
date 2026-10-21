import { useEffect, useMemo, useRef, useState } from 'react';
import { useT, type Key } from '../i18n';
import { stopLabel } from '../lib/text';
import { dayKeysOf, keysFor, listFor, timesAtStop, withMinutes, type Timed } from '../lib/departures';
import { fmtMinutes } from '../lib/time';
import { onRequestPlaces, withVia, detoursFor } from '../lib/via';
import { serviceDay } from '../lib/holidays';
import type { DayKey, Direction, Line, MapFocus, MapLayer, MapPin } from '../types';
import { Card, Chip, dirLabel, EstTag, LineBadge, Linkified, lineColor, lineRailCls, MapLinks, PdfButton, PrecisionWarning, SectionTitle, type RideEnds, type Shared } from './common';
import { Icon } from './Icons';
import { RouteMap } from './RouteMap';
import { useFootRoutes } from '../lib/foot';

function defaultDay(keys: DayKey[], shared: Shared): DayKey | undefined {
  const type = serviceDay(shared.ctx.now, shared.ctx.municipalities).type;
  const wanted = type === 'weekday' ? keysFor('weekday', shared.ctx.school) : type ? [type] : [];
  return keys.find((k) => wanted.includes(k)) ?? keys[0];
}

import { translateNote, variantLabel } from '../lib/notes';

/** Times of a direction on a day key: at `stopIdx` for timetables with times at every stop, else departures from the terminal. */
function timesOfDay(dir: Direction, day: DayKey, stopIdx: number): Timed[] {
  if (dir.trips?.length) return timesAtStop(dir, stopIdx, dir.trips.filter((x) => x.days.includes(day)));
  const type = day === 'saturday' || day === 'sunday' ? day : 'weekday';
  const list = day === 'weekday_school' || day === 'weekday_holiday' ? dir.departures[day] ?? [] : listFor(dir, type, true);
  return withMinutes(list);
}

/** The stop where most trips have a time: many SAM trips start mid-route, so stop 0 would show almost nothing. */
function bestStop(dir: Line['directions'][number] | undefined): number {
  if (!dir?.trips?.length) return 0;
  let best = 0;
  let bestN = -1;
  for (let i = 0; i < dir.stops.length; i++) {
    const n = dir.trips.filter((t) => t.times[i]).length;
    if (n > bestN) {
      best = i;
      bestN = n;
    }
  }
  return best;
}

/** Marks a place inserted from a "Via X" note: it is called at only on the selected trip, and its time is interpolated. */
function ViaTag() {
  const { t } = useT();
  return <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 align-middle text-[11px] font-semibold text-sky-800 dark:bg-sky-400/15 dark:text-sky-200">{t('viaStop')}</span>;
}

export function LineView({ line, initialDir, initialRide, initialEnds, shared, onBack }: { line: Line; initialDir?: number; initialRide?: { from: number; to: number }; initialEnds?: RideEnds; shared: Shared; onBack: () => void }) {
  const { t, lang } = useT();
  const tn = (s: string) => translateNote(s, lang);
  const [dirIndex, setDirIndex] = useState(initialDir ?? 0);
  const [stopIdx, setStopIdx] = useState(0);
  const [linksIdx, setLinksIdx] = useState<number | null>(null);
  /** selected departure (key of the Timed item); null = automatic: the next upcoming one, or the first of the day */
  const [selKey, setSelKey] = useState<string | null>(null);
  /** stop last tapped in the list (drives the map popup); null = none yet */
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [focusSeq, setFocusSeq] = useState(0);
  const [focusFromMap, setFocusFromMap] = useState(false);
  const mapBox = useRef<HTMLElement>(null);
  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  const keys = useMemo(() => dayKeysOf(line), [line]);
  const [day, setDay] = useState<DayKey | undefined>(() => defaultDay(keys, shared));
  useEffect(() => {
    setDirIndex(initialDir ?? 0);
    setStopIdx(bestStop(line.directions[initialDir ?? 0]));
    setDay(defaultDay(keys, shared));
    setSelKey(null);
    setFocusIdx(null);
    window.scrollTo(0, 0);
    document.getElementById('scroller')?.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.id, initialDir]);
  useEffect(() => {
    setStopIdx(bestStop(line.directions[dirIndex]));
    setLinksIdx(null);
    setSelKey(null);
    setFocusIdx(null);
  }, [dirIndex]);
  // a day without trips in this direction (e.g. a weekend-only direction): show the first day that has some
  useEffect(() => {
    const d = line.directions[dirIndex];
    if (!d || !line.hasParsedSchedule) return;
    if (day && timesOfDay(d, day, 0).length) return;
    const alt = keys.find((k) => timesOfDay(d, k, 0).length);
    if (alt) setDay(alt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirIndex, line.id, day]);
  useEffect(() => setSelKey(null), [day]);
  // another trip: the open stop details may belong to a "via" row that is no longer there
  useEffect(() => setLinksIdx(null), [selKey]);

  const dir = line.directions[dirIndex] ?? line.directions[0];
  const hasTrips = !!dir?.trips?.length;
  const hasOffsets = !hasTrips && !!dir?.stopOffsets?.length;
  const today = serviceDay(shared.ctx.now, shared.ctx.municipalities);
  const dayLabel = (k: DayKey) => {
    const extra = line.dayLabels?.[k];
    const base = t(`day_${k}` as Key);
    return extra && (k === 'weekday' || k === 'saturday' || k === 'sunday') ? `${base} (${tn(extra)})` : base;
  };

  // grid: times at the chosen stop (timetables with times at every stop) or departures from the terminal
  const times: Timed[] = useMemo(() => (dir && day ? timesOfDay(dir, day, hasTrips ? stopIdx : 0) : []), [dir, day, hasTrips, stopIdx]);
  const keyOf = (x: Timed, i: number) => (x.trip && dir?.trips ? `t${dir.trips.indexOf(x.trip)}` : `d${i}`);
  const isToday = day !== undefined && today.type !== null && keysFor(today.type, shared.ctx.school).includes(day);
  const nextIdx = isToday ? times.findIndex((x) => x.minutes >= shared.ctx.now.minutes) : -1;
  // exactly one time is always active: the tapped one, else the next upcoming departure, else the first of the day
  const found = selKey === null ? -1 : times.findIndex((x, i) => keyOf(x, i) === selKey);
  const selIdx = found >= 0 ? found : nextIdx >= 0 ? nextIdx : 0;
  const sel: Timed | undefined = times[selIdx];
  // the passing time of the selected trip at every stop: printed times, or terminal departure + estimated offset
  const stopTimes = useMemo<(string | null)[]>(() => {
    if (!dir || !sel) return [];
    return dir.stops.map((_, i) => {
      if (sel.trip) return sel.trip.times[i] ?? null;
      if (hasOffsets) return i === 0 ? sel.t : fmtMinutes(sel.minutes + (dir.stopOffsets?.[i] ?? 0));
      return i === 0 ? sel.t : null;
    });
  }, [dir, sel, hasOffsets]);
  const stopTimeLabel = (i: number) => {
    const v = stopTimes[i];
    return v ? (hasOffsets && i > 0 ? `~${v}` : v) : null;
  };

  // "Via Aeroporto" notes: the place is a stop of the selected trip (list and map); same array as dir.stops when there is none
  const shown = useMemo(() => (dir ? withVia(line, dirIndex, dir, sel?.notes, stopTimes) : null), [line, dirIndex, dir, sel, stopTimes]);
  const shownStops = shown?.stops ?? dir?.stops ?? [];
  const shownLabel = (i: number) => {
    const src = (shown ? shown.srcIdx[i] : i);
    if (src !== null) return stopTimeLabel(src);
    const v = shown?.viaTimes[i];
    return v ? `~${v}` : null;
  };
  // the stretch the traveller rides (from the planner): shown stops before boarding and after getting off are dimmed
  const rideShown = useMemo(() => {
    if (!initialRide || !shown || dirIndex !== (initialDir ?? 0)) return null;
    const from = shown.srcIdx.indexOf(initialRide.from);
    const to = shown.srcIdx.indexOf(initialRide.to);
    return from >= 0 && to > from ? { from, to } : null;
  }, [initialRide, initialDir, dirIndex, shown]);
  useEffect(() => {
    if (!rideShown) return;
    const id = setTimeout(() => rowRefs.current.get(rideShown.from)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
    return () => clearTimeout(id);
  }, [rideShown?.from, line.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasMap = !!dir && (dir.stops.some((s) => s.lat !== undefined) || dir.shapeId !== null);
  const noteKey = sel?.notes?.join('') ?? '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const detours = useMemo(() => detoursFor(line, dirIndex, sel?.notes), [line, dirIndex, noteKey]);
  // planner start / destination of the ridden stretch: the A / B pins and the walk between the picked point and the stop
  const endStops = useMemo(() => {
    if (!initialRide || !initialEnds || !dir || dirIndex !== (initialDir ?? 0)) return null;
    const ll = (s?: { lat?: number; lon?: number }) => (s?.lat !== undefined && s.lon !== undefined ? { lat: s.lat, lon: s.lon } : null);
    return { start: ll(dir.stops[initialRide.from]), end: ll(dir.stops[initialRide.to]) };
  }, [initialRide, initialEnds, dir, dirIndex, initialDir]);
  const startPt = initialEnds?.start && initialEnds.start !== true ? initialEnds.start : null;
  const endPt = initialEnds?.end && initialEnds.end !== true ? initialEnds.end : null;
  const foot = useFootRoutes([startPt && endStops?.start ? [startPt, endStops.start] : null, endPt && endStops?.end ? [endStops.end, endPt] : null]);
  const footSig = foot.map((r) => (r ? r.m : '-')).join(',');
  const pins = useMemo<MapPin[]>(() => {
    if (!endStops || !initialEnds) return [];
    const mk = (kind: MapPin['kind'], at: { lat: number; lon: number } | true | undefined, stop: { lat: number; lon: number } | null, name: string, path?: [number, number][]): MapPin[] => {
      const pos = at === true ? stop : at ?? null;
      if (!pos) return [];
      return [{ kind, label: t(kind === 'from' ? 'mapStart' : 'mapEnd'), lat: pos.lat, lon: pos.lon, ...(stop ? { stop: { ...stop, name } } : {}), ...(at !== true && path ? { path } : {}) }];
    };
    return [
      ...mk('from', initialEnds.start, endStops.start, dir?.stops[initialRide?.from ?? 0]?.name ?? '', foot[0]?.pts),
      ...mk('to', initialEnds.end, endStops.end, dir?.stops[initialRide?.to ?? 0]?.name ?? '', foot[1]?.pts),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endStops, initialEnds, footSig, t]);
  const layers = useMemo<MapLayer[]>(() => (dir ? [{ shapeId: dir.shapeId, stops: shownStops, color: lineColor(line), ...(pins.length ? { pins } : {}), ...(detours.length ? { detours } : {}), ...(rideShown ? { ride: { stops: shownStops.map((s) => (s.lat !== undefined && s.lon !== undefined ? ([s.lat, s.lon] as [number, number]) : null)), ...rideShown } } : {}) }] : []), [dir, line, shownStops, detours, rideShown, pins]);
  // on desktop the route is drawn on the big map next to the sidebar, on mobile it is shown inline
  const { desktop, setMap } = shared;
  useEffect(() => {
    if (!desktop || !hasMap) return;
    setMap(layers);
    return () => setMap(null);
  }, [desktop, hasMap, setMap, layers]);

  const mapFocus = useMemo<MapFocus | null>(
    () => (focusIdx === null ? null : { stopIndex: focusIdx, seq: focusSeq, times: shownStops.map((_, i) => shownLabel(i)), fromMap: focusFromMap }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusIdx, focusSeq, stopTimes, shown, focusFromMap],
  );
  const { setMapFocus, setMapStopHandler } = shared;
  useEffect(() => {
    if (!desktop) return;
    setMapFocus(mapFocus);
    return () => setMapFocus(null);
  }, [desktop, mapFocus, setMapFocus]);
  /** force: the reader asked for the map ("show on map"), so scroll to it even when it is far below the list */
  const tapStop = (i: number, force = false) => {
    const src = (shown ? shown.srcIdx[i] : i);
    if (hasTrips && src !== null) setStopIdx(src);
    setFocusFromMap(false);
    setFocusIdx(i);
    setFocusSeq((n) => n + 1);
    // on a phone the map is below the list: only nudge it fully into view when it is already partly visible
    // (otherwise tapping a stop would throw the reader away from the list)
    const el = mapBox.current;
    if (!desktop && el) {
      const r = el.getBoundingClientRect();
      if (force || (r.top < window.innerHeight && r.bottom > 0 && (r.top < 0 || r.bottom > window.innerHeight))) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  /** a stop marker was clicked on the map: open that stop in the list and scroll the list to it */
  const onMapStop = (i: number) => {
    const src = (shown ? shown.srcIdx[i] : i);
    if (hasTrips && src !== null) setStopIdx(src);
    setFocusFromMap(true);
    setFocusIdx(i);
    setFocusSeq((n) => n + 1);
    setLinksIdx(i);
    setTimeout(() => rowRefs.current.get(i)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };
  const onMapStopRef = useRef(onMapStop);
  onMapStopRef.current = onMapStop;
  useEffect(() => {
    if (!desktop) return;
    setMapStopHandler((i) => onMapStopRef.current(i));
    return () => setMapStopHandler(null);
  }, [desktop, setMapStopHandler]);

  const selNotes = sel?.notes ?? [];
  /** places a trip reaches only after a phone booking ("*Serviço a pedido: ..."), from its notes (legend code or free text) */
  // the grid shows the time and short legend codes only; the text of a free-text note ("Via Ilha, …") is shown below for the selected time
  const legendCodes = (notes?: readonly string[]) => (notes ?? []).filter((k) => k in line.notes && k.length <= 3);
  const hasFreeNote = (notes?: readonly string[]) => (notes ?? []).some((k) => !(k in line.notes) || k.length > 3);
  const requestPlaces = (notes?: readonly string[]) => [...new Set((notes ?? []).flatMap((k) => onRequestPlaces(line.notes[k] ?? k) ?? []))];
  const selRequest = requestPlaces(selNotes);
  const railCls = lineRailCls(line);
  const ringCls = line.type === 'urbano' ? 'border-emerald-600' : 'border-slate-700 dark:border-slate-400';

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={onBack}
        className="-ml-2 inline-flex h-10 items-center gap-1.5 self-start rounded-full px-3 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-400/10"
      >
        <Icon name="back" className="size-4" />
        {t('back')}
      </button>

      <div className="flex items-start gap-3.5">
        <LineBadge line={line} large />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight tracking-tight">{line.name}</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{line.route}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium dark:bg-slate-800">{line.type === 'urbano' ? t('urban') : t('interurban')}</span>
            {line.municipality && <span>{line.municipality}</span>}
            {line.newNumber && line.oldNumber && line.oldNumber !== String(Number(line.newNumber)) ? (
              <span>
                · {t('oldNumber')} {line.oldNumber}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {!line.hasParsedSchedule && (
        <Card className="flex flex-col gap-3 border-amber-300! bg-amber-50/60! dark:border-amber-400/30! dark:bg-amber-400/5!">
          <div className="flex items-start gap-3">
            <Icon name="alert" className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold">{t('notParsedTitle')}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('notParsedBody')}</p>
            </div>
          </div>
          <PdfButton line={line} big />
        </Card>
      )}

      {line.directions.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('direction')}>
          {line.directions.map((d, i) => (
            <Chip key={i} active={i === dirIndex} onClick={() => setDirIndex(i)}>
              {d.variant ? `${variantLabel(d.variant, lang)}: ` : ''}
              {dirLabel(d, line.name)}
            </Chip>
          ))}
        </div>
      )}

      {line.hasParsedSchedule && dir && (
        <section className="flex flex-col gap-3">
          <div>
            <SectionTitle>
              {hasTrips ? `${t('departuresFromStop')}: ${dir.stops[stopIdx]?.name ?? ''}` : `${t('schedule')}: ${dir.from}`}
            </SectionTitle>
            <p className="px-1 text-xs text-slate-500 dark:text-slate-400">{hasTrips ? `${t('tapTime')} ${t('tapStop')}` : t('tapTime')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {keys.map((k) => (
              <Chip key={k} active={k === day} onClick={() => setDay(k)}>
                {dayLabel(k)}
              </Chip>
            ))}
          </div>
          {today.type === null && <p className="px-1 text-sm text-amber-600">{t('noService')}</p>}
          {times.length ? (
            <Card className="grid grid-cols-4 gap-1.5 p-3! sm:grid-cols-5">
              {times.map((x, i) => {
                const active = i === selIdx;
                return (
                  <button
                    key={i}
                    onClick={() => setSelKey(keyOf(x, i))}
                    aria-pressed={active}
                    className={`min-h-11 rounded-lg px-1 py-1.5 text-center text-sm tabular-nums transition-colors ${
                      active
                        ? 'bg-sky-600 font-bold text-white'
                        : i === nextIdx
                          ? 'font-semibold text-sky-700 ring-2 ring-sky-300 hover:bg-sky-50 dark:text-sky-300 dark:ring-sky-500/50 dark:hover:bg-sky-400/10'
                          : i < nextIdx
                            ? 'text-slate-400 hover:bg-slate-100 dark:text-slate-600 dark:hover:bg-slate-800'
                            : 'font-medium hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {x.t}
                    {requestPlaces(x.notes).length ? <span className="ml-0.5 text-amber-600" aria-hidden>⚠</span> : null}
                    {legendCodes(x.notes).length ? <sup className="ml-0.5 text-[10px] font-normal opacity-70">{legendCodes(x.notes).map(tn).join(',')}</sup> : null}
                    {hasFreeNote(x.notes) && !requestPlaces(x.notes).length ? <sup className="ml-0.5 text-[10px] font-normal opacity-70" title={(x.notes ?? []).map(tn).join('; ')}>*</sup> : null}
                  </button>
                );
              })}
            </Card>
          ) : (
            <p className="px-1 text-sm text-slate-500">{t('noDeparturesInDir')}</p>
          )}
          {sel && selRequest.length === 0 && hasFreeNote(selNotes) && (
            <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-400/10 dark:text-sky-200" data-testid="trip-note">
              <b className="tabular-nums">{sel.t}</b> – {selNotes.filter((k) => !legendCodes([k]).length).map((k) => tn(k)).join('; ')}
            </p>
          )}
          {selRequest.length > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200" data-testid="on-request">
              <span aria-hidden>⚠️</span>
              <span>
                <b className="tabular-nums">{sel?.t}</b> – {t('onRequestWarn').replace('{places}', selRequest.join(', '))}
              </span>
            </p>
          )}
        </section>
      )}

      {dir && (
        <section>
          <SectionTitle aside={<span className="text-xs text-slate-400">{shownStops.length}</span>}>{t('stopsOfDirection')}</SectionTitle>
          {shownStops.length ? (
            <ol className="rounded-2xl border border-slate-200/70 bg-white py-2 pr-2 text-sm dark:border-slate-700/70 dark:bg-slate-900">
              {shownStops.map((s, i) => {
                const edge = i === 0 || i === shownStops.length - 1;
                const src = (shown ? shown.srcIdx[i] : i);
                const active = hasTrips ? src === stopIdx : i === focusIdx;
                const label = shownLabel(i);
                // Google Maps style: outside the ridden stretch the stop fades
                const faded = !!rideShown && (i < rideShown.from || i > rideShown.to);
                const boardOff = !!rideShown && (i === rideShown.from || i === rideShown.to);
                const content = (
                  <>
                    <span className={`min-w-0 flex-1 ${edge || active || boardOff ? 'font-semibold' : ''}`}>
                      {stopLabel(s, lang)} {s.via ? <ViaTag /> : <PrecisionWarning stop={s} />}
                    </span>
                    {label ? (
                      (hasOffsets && i > 0) || s.via ? (
                        <EstTag>
                          <span className="text-xs tabular-nums">{label}</span>
                        </EstTag>
                      ) : (
                        <span className={`text-sm font-semibold tabular-nums ${i === 0 ? 'text-sky-700 dark:text-sky-300' : ''}`}>{label}</span>
                      )
                    ) : hasTrips && sel && !s.via ? (
                      <span className="text-xs text-slate-300 dark:text-slate-600" title={t('noTimeAtStop')}>
                        –
                      </span>
                    ) : null}
                    {s.code && <span className="text-xs text-slate-400">{s.code}</span>}
                  </>
                );
                const hasCoords = s.lat !== undefined && s.lon !== undefined;
                const last = i === shownStops.length - 1;
                return (
                  <li key={i} ref={(el) => { if (el) rowRefs.current.set(i, el); else rowRefs.current.delete(i); }} className={`grid grid-cols-[2.75rem_minmax(0,1fr)] ${faded ? 'opacity-40' : ''}`} data-ride={rideShown ? (faded ? 'off' : boardOff ? 'end' : 'on') : undefined}>
                    <div className="relative">
                      {i > 0 && <span className={`absolute left-1/2 top-0 h-5.5 w-1 -translate-x-1/2 ${railCls}`} />}
                      {!last && <span className={`absolute bottom-0 left-1/2 top-5.5 w-1 -translate-x-1/2 ${railCls}`} />}
                      <span
                        className={`absolute left-1/2 z-10 -translate-x-1/2 rounded-full border-[2.5px] ${
                          active
                            ? 'top-3.75 size-3.5 border-sky-600 bg-sky-600 dark:border-sky-400 dark:bg-sky-400'
                            : `${ringCls} bg-white dark:bg-slate-900 ${edge ? 'top-3.5 size-4' : 'top-4.25 size-2.5'}`
                        }`}
                      />
                    </div>
                    <div className={`rounded-xl ${active ? 'bg-sky-50 dark:bg-sky-400/10' : ''}`}>
                      <div className="flex items-center">
                        <button
                          onClick={() => {
                            tapStop(i);
                            setLinksIdx(i);
                          }}
                          aria-pressed={active}
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 pl-4 pr-2 text-left"
                        >
                          {content}
                        </button>
                        <button
                          onClick={() => setLinksIdx(linksIdx === i ? null : i)}
                          aria-expanded={linksIdx === i}
                          aria-label={`${t('openInMaps')}: ${s.name}`}
                          title={t('openInMaps')}
                          className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                            linksIdx === i ? 'text-sky-700 dark:text-sky-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <Icon name="pin" className="size-4" />
                        </button>
                      </div>
                      {linksIdx === i && (
                        <div className="mx-3 mb-3 flex flex-col gap-2.5 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3.5 dark:border-slate-700/70 dark:bg-slate-800/40" data-testid="stop-details">
                          <PrecisionWarning stop={s} block />
                          <MapLinks
                            stop={s}
                            grid
                            lead={
                              hasCoords && hasMap ? (
                                <button
                                  onClick={() => tapStop(i, true)}
                                  className="inline-flex h-auto min-h-10 items-center justify-center gap-1.5 rounded-full border border-sky-300 bg-sky-50 px-2 text-center text-xs font-semibold leading-tight text-sky-800 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-200"
                                >
                                  {t('showOnMap')}
                                </button>
                              ) : null
                            }
                          />
                          {!hasCoords && <span className="text-xs text-slate-400">{t('mapByName')}</span>}
                          {s.approx && s.locationPrecision !== 'settlement_center' && <span className="text-xs text-amber-600">{t('coordsApprox')}</span>}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="px-1 text-sm text-slate-500">{t('noStops')}</p>
          )}
        </section>
      )}

      {hasMap && !desktop && (
        <section ref={mapBox}>
          <SectionTitle>{t('map')}</SectionTitle>
          <RouteMap layers={layers} focus={mapFocus} onStopClick={onMapStop} />
        </section>
      )}

      {(Object.keys(line.notes).length > 0 || selNotes.length > 0) && (
        <section>
          <SectionTitle>{t('notes')}</SectionTitle>
          {line.hasParsedSchedule && selNotes.length > 0 && sel && (
            <p className="mb-1 px-1 text-xs text-slate-500 dark:text-slate-400">
              {t('tripNotes')}: <b className="tabular-nums">{sel.t}</b>
            </p>
          )}
          <ul className="space-y-1 px-1 text-sm">
            {Object.entries(line.notes).map(([k, v]) => {
              const on = selNotes.includes(k);
              const dim = selNotes.length > 0 && !on;
              return (
                <li key={k} className={on ? 'rounded-lg bg-sky-50 px-2 py-1 font-medium dark:bg-sky-400/10' : dim ? 'opacity-40' : ''}>
                  <b>{k}</b> – <Linkified text={tn(v)} />
                </li>
              );
            })}
            {selNotes
              .filter((k) => !(k in line.notes))
              .map((k) => (
                <li key={`sel-${k}`} className="rounded-lg bg-sky-50 px-2 py-1 font-medium dark:bg-sky-400/10">
                  <Linkified text={tn(k)} />
                </li>
              ))}
            {line.generalNotes?.map((n, i) => (
              <li key={`g${i}`} className="text-slate-500">
                <Linkified text={tn(n)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {line.info && (
        <section className="flex flex-col gap-2 rounded-2xl border border-sky-200 bg-sky-50/60 p-4 text-sm dark:border-sky-400/30 dark:bg-sky-400/5">
          {line.operator && (
            <p>
              <span className="text-slate-500">{t('lineOperator')}:</span> <b>{line.operator}</b>
            </p>
          )}
          {line.info.price && (
            <div>
              <p className="font-semibold">{t('linePrice')}</p>
              <p className="text-slate-600 dark:text-slate-300"><Linkified text={line.info.price[lang]} /></p>
            </div>
          )}
          {line.info.conditions && (
            <div>
              <p className="font-semibold">{t('lineConditions')}</p>
              <p className="text-slate-600 dark:text-slate-300"><Linkified text={line.info.conditions[lang]} /></p>
            </div>
          )}
          {line.sourceUrl && (
            <a href={line.sourceUrl} target="_blank" rel="noreferrer" className="text-sky-700 underline dark:text-sky-300">
              {t('lineSourcePage')}
            </a>
          )}
        </section>
      )}

      {line.hasParsedSchedule && <PdfButton line={line} />}
    </div>
  );
}
