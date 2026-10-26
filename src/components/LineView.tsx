import { useEffect, useMemo, useRef, useState } from 'react';
import { useT, type Key } from '../i18n';
import { stopLabel } from '../lib/text';
import { sameCall } from '../lib/network';
import { dayKeysOf, keysFor, listFor, timesAtStop, withMinutes, type Timed } from '../lib/departures';
import { fmtMinutes, toMinutes } from '../lib/time';
import { onRequestPlaces, withVia, detoursFor } from '../lib/via';
import { serviceDay } from '../lib/holidays';
import type { DayKey, Direction, Line, MapFocus, MapLayer, MapPin, Stop } from '../types';
import { Card, Chip, dirLabel, EstTag, LineBadge, Linkified, lineColor, lineRailCls, MapLinks, PdfButton, pdfHref, PrecisionWarning, SectionTitle, type RideEnds, type RideWhen, type Shared } from './common';
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
/** The first stop of a direction is a terminal in Funchal. */
const inFunchal = (name: string | null | undefined) => /^funchal(\s|$|-)/i.test((name ?? '').trim());

/** The code of a legend note (`*`, `a`, `b`, ...) as a badge in front of its text. */
function NoteCode({ code }: { code: string }) {
  return <span className="mr-1.5 inline-flex min-w-[1.4rem] items-center justify-center rounded-md bg-slate-200 px-1.5 py-0.5 align-baseline text-xs font-bold text-slate-800 dark:bg-slate-700 dark:text-slate-100" data-testid="note-code">{code}</span>;
}

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

export function LineView({ line, initialDir, initialRide, initialWhen, initialEnds, shared, onBack }: { line: Line; initialDir?: number; initialRide?: { from: number; to: number }; initialWhen?: RideWhen; initialEnds?: RideEnds; shared: Shared; onBack: () => void }) {
  const { t, lang } = useT();
  const tn = (s: string) => translateNote(s, lang);
  const [dirIndex, setDirIndex] = useState(initialDir ?? 0);
  /** lines with many branches (Funchal - Corrida / Jardim da Serra / ...): two sides (from / to Funchal) and an optional filter of the far end */
  const groups = useMemo(() => {
    if (line.directions.length <= 2) return null;
    const first = line.directions[0];
    const sides: number[][] = [[], []];
    line.directions.forEach((d, i) => {
      const from = d.from ?? d.stops[0]?.name;
      const out = inFunchal(from) && !inFunchal(d.to) ? 0 : inFunchal(d.to) && !inFunchal(from) ? 1 : from === (first.from ?? first.stops[0]?.name) ? 0 : 1;
      sides[out].push(i);
    });
    if (!sides[0].length || !sides[1].length) return null;
    return { sides, funchal: line.directions.some((d) => inFunchal(d.from) || inFunchal(d.to)) };
  }, [line]);
  /** every trip of the side shown in one chronological list, the far end printed on each time */
  const [allMode, setAllMode] = useState(initialDir === undefined);
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
    setAllMode(initialDir === undefined);
    setStopIdx(bestStop(line.directions[initialDir ?? 0]));
    setDay(defaultDay(keys, shared));
    setSelKey(null);
    setFocusIdx(null);
    window.scrollTo(0, 0);
    document.getElementById('scroller')?.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.id, initialDir]);
  /** set by the effect that selects a searched trip: the next change of day / direction is its own and must not clear the selection */
  const holdSel = useRef({ day: false, dir: false });
  useEffect(() => {
    if (holdSel.current.dir) {
      holdSel.current.dir = false;
      return;
    }
    setStopIdx(bestStop(line.directions[dirIndex]));
    setLinksIdx(null);
    setSelKey(null);
    setFocusIdx(null);
  }, [dirIndex]);
  // a day without trips in this direction (e.g. a weekend-only direction): show the first day that has some
  useEffect(() => {
    const d = line.directions[dirIndex];
    if (!d || !line.hasParsedSchedule) return;
    // the merged list covers the whole side: a day is empty only when no direction of the side runs on it (else weekday / weekend-only branches flip the day back and forth)
    const ds = groups && allMode ? groups.sides[groups.sides.findIndex((x) => x.includes(dirIndex))].map((i) => line.directions[i]) : [d];
    const has = (k: DayKey) => ds.some((x) => timesOfDay(x, k, 0).length);
    if (day && has(day)) return;
    const alt = keys.find(has);
    if (alt) setDay(alt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirIndex, line.id, day, allMode]);
  useEffect(() => {
    if (holdSel.current.day) holdSel.current.day = false;
    else setSelKey(null);
  }, [day]);
  useEffect(() => setLinksIdx(null), [day]);
  // coming from a planned connection: the searched trip (boarding time, service date) is selected, never "the next one by the clock"
  useEffect(() => {
    if (!initialWhen || !initialRide) return;
    const d = line.directions[initialDir ?? 0];
    if (!d?.trips?.length) return;
    const at = toMinutes(initialWhen.dep) % 1440;
    const same = d.trips.map((x, i) => ({ x, i })).filter(({ x }) => x.times[initialRide.from] && toMinutes(x.times[initialRide.from] as string) % 1440 === at);
    if (!same.length) return;
    const date = initialWhen.date?.split('-').map(Number);
    const type = date ? serviceDay({ y: date[0], m: date[1], d: date[2] }, shared.ctx.municipalities).type : null;
    const wanted = type === 'weekday' ? keysFor('weekday', shared.ctx.school) : type ? [type] : [];
    const hit = same.find(({ x }) => x.days.some((k) => wanted.includes(k))) ?? same[0];
    const dayKey = hit.x.days.find((k) => wanted.includes(k)) ?? hit.x.days[0];
    if (dayKey !== day) holdSel.current.day = true;
    if ((initialDir ?? 0) !== dirIndex) holdSel.current.dir = true;
    setDirIndex(initialDir ?? 0);
    setDay(dayKey);
    setStopIdx(initialRide.from);
    setSelKey(`t${hit.i}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.id, initialDir, initialWhen?.dep, initialWhen?.date]);

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
  const side = groups ? Math.max(0, groups.sides.findIndex((s) => s.includes(dirIndex))) : 0;
  const merged = groups && allMode ? groups.sides[side] : null;
  const times: Timed[] = useMemo(() => {
    if (!dir || !day) return [];
    if (merged) return merged.flatMap((i) => timesOfDay(line.directions[i], day, 0).map((x) => ({ ...x, dirIdx: i }))).sort((a, b) => a.minutes - b.minutes);
    return timesOfDay(dir, day, hasTrips ? stopIdx : 0);
  }, [dir, day, hasTrips, stopIdx, merged, line]);
  // a day tab is disabled when no trip of the shown list (merged side / this stop) runs on it
  const dayHas = (k: DayKey) => (k === day ? times.length > 0 : merged ? merged.some((i) => timesOfDay(line.directions[i], k, 0).length) : !!dir && timesOfDay(dir, k, hasTrips ? stopIdx : 0).length > 0);
  const keyOf = (x: Timed, i: number) => {
    const d = x.dirIdx !== undefined ? line.directions[x.dirIdx] : dir;
    return x.trip && d?.trips ? `${x.dirIdx !== undefined ? `${x.dirIdx}:` : ''}t${d.trips.indexOf(x.trip)}` : `d${i}`;
  };
  const isToday = day !== undefined && today.type !== null && keysFor(today.type, shared.ctx.school).includes(day);
  const nextIdx = isToday ? times.findIndex((x) => x.minutes >= shared.ctx.now.minutes) : -1;
  // exactly one time is always active: the tapped one, else the next upcoming departure, else the first of the day
  const found = selKey === null ? -1 : times.findIndex((x, i) => keyOf(x, i) === selKey);
  // a chosen trip stays chosen even when the listed stop has no time for it (a dash in the timetable): it is looked up by its own key
  const pinned = useMemo<Timed | undefined>(() => {
    if (selKey === null || found >= 0 || !dir?.trips || !selKey.startsWith('t')) return undefined;
    const trip = dir.trips[Number(selKey.slice(1))];
    const t = trip?.times.find(Boolean);
    return trip && t ? { t, minutes: toMinutes(t), trip, ...(trip.notes ? { notes: trip.notes } : {}) } : undefined;
  }, [selKey, found, dir]);
  const selIdx = found >= 0 ? found : pinned ? -1 : nextIdx >= 0 ? nextIdx : 0;
  const sel: Timed | undefined = pinned ?? times[selIdx];
  // the merged list: the direction (stops, map) follows the selected trip
  useEffect(() => {
    if (!merged || sel?.dirIdx === undefined || sel.dirIdx === dirIndex) return;
    holdSel.current.dir = true;
    setDirIndex(sel.dirIdx);
    setStopIdx(Math.max(0, sel.trip?.times.findIndex(Boolean) ?? 0));
    setLinksIdx(null);
    setFocusIdx(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merged, sel?.dirIdx, dirIndex]);
  // a tap on a stop only moves the listed stop: the trip in use is pinned so that it cannot fall back to "the next departure"
  const pinTrip = () => {
    if (merged) {
      // times at a stop exist per direction: the merged list gives way to the direction of the selected trip, the trip stays selected
      if (sel?.trip && dir?.trips) setSelKey(`t${dir.trips.indexOf(sel.trip)}`);
      setAllMode(false);
    } else if (selKey === null && sel) setSelKey(keyOf(sel, selIdx));
  };
  // the passing time of the selected trip at every stop: printed times, or terminal departure + estimated offset
  const stopTimes = useMemo<(string | null)[]>(() => {
    if (!dir || !sel) return [];
    return dir.stops.map((_, i) => {
      if (sel.trip) return sel.trip.times[i] ?? null;
      if (hasOffsets) return i === 0 ? sel.t : fmtMinutes(sel.minutes + (dir.stopOffsets?.[i] ?? 0));
      return i === 0 ? sel.t : null;
    });
  }, [dir, sel, hasOffsets]);
  /** a time of the selected trip that is not printed: the final arrival (estLast) or a stop between the printed timing points (dir.printedIdx) */
  const isEstTime = (i: number) => !!sel?.trip && ((!!sel.trip.estLast && i === (dir?.stops.length ?? 0) - 1) || (!!dir?.printedIdx && !dir.printedIdx.includes(i)));
  const stopTimeLabel = (i: number) => {
    const v = stopTimes[i];
    return v ? ((hasOffsets && i > 0) || isEstTime(i) ? `~${v}` : v) : null;
  };

  // "Via Aeroporto" notes: the place is a stop of the selected trip (list and map); same array as dir.stops when there is none
  const shownAll = useMemo(() => (dir ? withVia(line, dirIndex, dir, sel?.notes, stopTimes) : null), [line, dirIndex, dir, sel, stopTimes]);
  // a dash in the timetable means the trip does not call there: such a stop is neither listed nor drawn for this trip
  const shown = useMemo(() => {
    if (!shownAll || !sel?.trip) return shownAll;
    const keep = shownAll.srcIdx.map((src) => src === null || !!stopTimes[src]);
    if (keep.every(Boolean)) return shownAll;
    return { stops: shownAll.stops.filter((_, i) => keep[i]), srcIdx: shownAll.srcIdx.filter((_, i) => keep[i]), viaTimes: shownAll.viaTimes.filter((_, i) => keep[i]) };
  }, [shownAll, sel, stopTimes]);
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
  // the stops of the selected trip in driving order with "called at / skipped": the road line does not drive into a side road to a skipped stop
  const tripPts = useMemo(() => {
    if (!dir || !sel?.trip) return undefined;
    const stops = dir.stops.flatMap((s, i) => (s.lat !== undefined && s.lon !== undefined ? [{ at: [s.lat, s.lon] as [number, number], calls: !!stopTimes[i] }] : []));
    return stops.some((s) => !s.calls) ? { stops } : undefined;
  }, [dir, sel, stopTimes]);
  const layers = useMemo<MapLayer[]>(() => (dir ? [{ shapeId: dir.shapeId, stops: shownStops, color: lineColor(line), ...(tripPts ? { trip: tripPts } : {}), ...(pins.length ? { pins } : {}), ...(detours.length ? { detours } : {}), ...(rideShown ? { ride: { stops: shownStops.map((s) => (s.lat !== undefined && s.lon !== undefined ? ([s.lat, s.lon] as [number, number]) : null)), ...rideShown } } : {}) }] : []), [dir, line, shownStops, detours, rideShown, pins, tripPts]);
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
    pinTrip();
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
    pinTrip();
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
  const isFree = (k: string) => !(k in line.notes) || k.length > 3;
  const hasFreeNote = (notes?: readonly string[]) => (notes ?? []).some(isFree);
  // mark at the time for free text of a trip. "via ..." only names the route (shown with the selected trip) and gets no mark; the mark is
  // never "*": that is a real legend code (line 96) and shows only on the trips that carry it.
  const hasFreeMark = (notes?: readonly string[]) => (notes ?? []).some((k) => isFree(k) && !/^\s*via(\s|$)/i.test(k));
  const requestPlaces = (notes?: readonly string[]) => [...new Set((notes ?? []).flatMap((k) => onRequestPlaces(line.notes[k] ?? k) ?? []))];
  const selRequest = requestPlaces(selNotes);
  const railCls = lineRailCls(line);
  const ringCls = line.type === 'urbano' ? 'border-emerald-600' : 'border-slate-700 dark:border-slate-400';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-1">
        <button
          onClick={onBack}
          className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-400/10"
        >
          <Icon name="back" className="size-4" />
          {t('back')}
        </button>
        <span className="ml-auto flex items-center gap-0.5">
          {hasMap && !desktop && (
            <button
              type="button"
              onClick={() => mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              aria-label={t('mapShort')}
              title={t('mapShort')}
              data-testid="scroll-to-map"
              className="inline-flex size-10 items-center justify-center rounded-full text-sky-700 transition-colors hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-400/10"
            >
              <Icon name="map" className="size-5" />
            </button>
          )}
          {line.hasParsedSchedule && (
            <a href={pdfHref(line)} target="_blank" rel="noreferrer" aria-label={t('pdfShort')} title={t('pdfShort')} data-testid="open-pdf" className="inline-flex size-10 items-center justify-center rounded-full text-sky-700 transition-colors hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-400/10">
              <Icon name="file" className="size-5" />
            </a>
          )}
        </span>
      </div>

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

      {groups && !initialRide ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('direction')}>
            {groups.sides.map((idx, k) => (
              <Chip
                key={k}
                active={k === side}
                onClick={() => {
                  if (k === side) return;
                  setAllMode(true);
                  setDirIndex(idx[0]);
                }}
              >
                {t(k === 0 ? (groups.funchal ? 'segFromFunchal' : 'segThere') : groups.funchal ? 'segToFunchal' : 'segBack')}
              </Chip>
            ))}
          </div>
          {groups.sides[side].length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label={t(side === 0 ? 'allDestinations' : 'allOrigins')} data-testid="dir-filter">
              <Chip active={allMode} onClick={() => setAllMode(true)}>
                {t(side === 0 ? 'allDestinations' : 'allOrigins')}
              </Chip>
              {groups.sides[side].map((i) => {
                const d = line.directions[i];
                const end = side === 0 ? d.to : d.from ?? d.stops[0]?.name ?? '';
                return (
                  <Chip
                    key={i}
                    active={!allMode && i === dirIndex}
                    onClick={() => {
                      setAllMode(false);
                      setDirIndex(i);
                    }}
                  >
                    {t(side === 0 ? 'onlyDest' : 'onlyFrom').replace('{x}', `${d.variant ? `${variantLabel(d.variant, lang)} ` : ''}${end}`)}
                  </Chip>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        line.directions.length > 1 &&
        !initialRide && (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('direction')}>
            {line.directions.map((d, i) => (
              <Chip key={i} active={i === dirIndex} onClick={() => setDirIndex(i)}>
                {d.variant ? `${variantLabel(d.variant, lang)}: ` : ''}
                {dirLabel(d, line.name)}
              </Chip>
            ))}
          </div>
        )
      )}

      {line.hasParsedSchedule && dir && (
        <section className="flex flex-col gap-3">
          <div>
            <SectionTitle>
              {merged ? t('departuresAllDest') : hasTrips ? `${t('departuresFromStop')}: ${dir.stops[stopIdx]?.name ?? ''}` : `${t('schedule')}: ${dir.from}`}
            </SectionTitle>
            <p className="px-1 text-xs text-slate-500 dark:text-slate-400">{hasTrips ? `${t('tapTime')} ${t('tapStop')}` : t('tapTime')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {keys.map((k) => (
              <Chip key={k} active={k === day} onClick={() => setDay(k)} disabled={!dayHas(k)} title={dayHas(k) ? undefined : t('noTripsDayTitle')}>
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
                    onClick={() => {
                      setSelKey(keyOf(x, i));
                      setLinksIdx(null);
                    }}
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
                    {merged && x.dirIdx !== undefined ? (
                      <span className="block truncate text-[10px] font-normal opacity-70" data-testid="time-end">
                        {side === 0 ? line.directions[x.dirIdx].to : line.directions[x.dirIdx].from ?? line.directions[x.dirIdx].stops[0]?.name}
                      </span>
                    ) : null}
                    {hasFreeMark(x.notes) && !requestPlaces(x.notes).length ? <sup className="ml-0.5 text-[10px] font-normal opacity-70" title={(x.notes ?? []).map(tn).join('; ')} data-testid="free-note-mark">ⓘ</sup> : null}
                  </button>
                );
              })}
            </Card>
          ) : (
            <p className="px-1 text-sm text-slate-500" data-testid="no-trips-day">{keys.some((k) => dayHas(k)) ? t('noTripsDay') : t('noDeparturesInDir')}</p>
          )}
          {sel?.trip?.estLast && (
            <p className="px-1 text-xs text-slate-500 dark:text-slate-400" data-testid="est-arrival">
              ~ {t('estArrival')}
            </p>
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
                // the same stop twice in a row = arrival and departure of one bus waiting there
                const pair = (o?: Stop) => !!o && !s.via && !o.via && o.name === s.name;
                const twin = pair(shownStops[i + 1]) && sameCall(s, shownStops[i + 1]) ? 'arr' : i > 0 && pair(shownStops[i - 1]) && sameCall(s, shownStops[i - 1]) ? 'dep' : null;
                // a street with several poles of one name: the pole code tells the rows apart
                const sameName = !twin && !s.via && !!s.code && (pair(shownStops[i + 1]) || (i > 0 && pair(shownStops[i - 1])));
                // Google Maps style: outside the ridden stretch the stop fades
                const faded = !!rideShown && (i < rideShown.from || i > rideShown.to);
                const boardOff = !!rideShown && (i === rideShown.from || i === rideShown.to);
                const content = (
                  <>
                    <span className={`min-w-0 flex-1 ${edge || active || boardOff ? 'font-semibold' : ''}`}>
                      {stopLabel(s, lang)} {s.via ? <ViaTag /> : <PrecisionWarning stop={s} />}
                      {sameName && <span className="ml-1 text-xs font-normal tabular-nums text-slate-500 dark:text-slate-400" data-testid="stop-pole">({s.code})</span>}
                      {twin && <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400" data-testid="stop-twin">({t(twin === 'arr' ? 'stopArrival' : 'stopDeparture')})</span>}
                    </span>
                    {label ? (
                      (hasOffsets && i > 0) || s.via || (src !== null && isEstTime(src)) ? (
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
                  <NoteCode code={k} />
                  <Linkified text={tn(v)} />
                </li>
              );
            })}
            {selNotes
              .filter((k) => !(k in line.notes))
              .map((k) => {
                // a free-text note keeps its leading marker ("*Serviço a pedido: ...") as the badge
                const m = /^\s*(\*+)\s*(?=\S)/.exec(k) ?? /^\s*([a-z])\s*[:)\-–]\s+(?=\S)/i.exec(k);
                return (
                  <li key={`sel-${k}`} className="rounded-lg bg-sky-50 px-2 py-1 font-medium dark:bg-sky-400/10">
                    {m && <NoteCode code={m[1]} />}
                    <Linkified text={tn(m ? k.slice(m[0].length) : k)} />
                  </li>
                );
              })}
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

      {hasMap && !desktop && (
        <section ref={mapBox} className="scroll-mt-4">
          <SectionTitle>{t('map')}</SectionTitle>
          <RouteMap layers={layers} focus={mapFocus} onStopClick={onMapStop} />
        </section>
      )}
    </div>
  );
}
