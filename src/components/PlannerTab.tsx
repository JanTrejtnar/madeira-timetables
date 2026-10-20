import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '../i18n';
import { localStopName } from '../lib/text';
import { detoursFor } from '../lib/via';
import { addDays, serviceDay } from '../lib/holidays';
import { hubsNear, resolveNodes, servicesFor, suggest, tripStops, type Suggestion } from '../lib/network';
import { isoToYmd, ymdToIso, type Picked, type PlannerForm } from '../lib/plannerForm';
import { plan, type Itinerary } from '../lib/router';
import { useDebounced } from '../lib/hooks';
import { fmtMinutes } from '../lib/time';
import { DatePicker, TimePicker } from './Pickers';
import { walkTo } from '../lib/walk';
import type { Line, MapLayer, MapPin as PickedPin } from '../types';
import { Card, Chip, dirLabel, EmptyState, EstTag, LineBadge, lineColor, lineRailCls, MapPin, PrecisionWarning, SectionTitle, TypeFilter, type LineTypeFilter, type Shared } from './common';
import { Icon } from './Icons';
import { MapPicker } from './MapPicker';
import { RouteMap } from './RouteMap';

function Combobox({ label, placeholder, value, onChange, onCommit, shared, onPickMap }: { label: string; placeholder: string; value: Picked; onChange: (v: Picked) => void; onCommit: () => void; shared: Shared; onPickMap: () => void }) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(value.text, 120);
  const items = useMemo(() => (open ? suggest(shared.net, shared.lines, debounced) : []), [open, debounced, shared.net, shared.lines]);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  useEffect(() => {
    const close = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  // a new list starts without a highlighted item; the highlighted one is kept in view when scrolling with the arrows
  useEffect(() => setActive(-1), [items]);
  useEffect(() => {
    if (active >= 0) box.current?.querySelector(`[id="${listId}-${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  const labelOf = (s: Suggestion) => (s.group ? t('allStopsOf', { name: s.name }) : localStopName(s.name, lang));
  const pick = (s: Suggestion) => {
    onChange({ text: labelOf(s), key: s.key });
    setOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (!items.length) return;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1));
    } else if (e.key === 'Enter' && open && items.length) {
      // the highlighted item, else the first suggestion (a municipality group when a town is typed)
      e.preventDefault();
      pick(items[active >= 0 ? active : 0]);
    } else if (e.key === 'Enter') {
      // typed text without a suggestion to take: search for it as it stands
      e.preventDefault();
      onCommit();
      setOpen(false);
    }
  };

  return (
    <div ref={box} className="relative flex items-center">
      <input
        value={value.text}
        onChange={(e) => {
          onChange({ text: e.target.value, key: null });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="h-11 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-base font-medium outline-none placeholder:font-normal placeholder:text-slate-400 focus:bg-slate-50 dark:focus:bg-slate-800/60"
      />
      <button
        type="button"
        onClick={onPickMap}
        aria-label={`${t('pickOnMap')}: ${label}`}
        title={t('pickOnMap')}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-sky-600 dark:hover:bg-slate-800"
      >
        <Icon name="map" className="size-5" />
      </button>
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute -left-9 -right-12 top-full z-30 mt-2 max-h-72 overflow-auto rounded-2xl border border-slate-200/70 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {items.map((s, i) => (
            <li key={s.key} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button
                tabIndex={-1}
                className={`flex min-h-11 w-full items-center gap-3 px-4 text-left hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800 ${s.group ? 'font-semibold' : ''} ${
                  i === active ? 'bg-sky-100 dark:bg-sky-400/20' : s.group ? 'bg-sky-50/70 dark:bg-sky-400/10' : ''
                }`}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => pick(s)}
              >
                <Icon name="pin" className={`size-4 shrink-0 ${s.group ? 'text-sky-600' : 'text-slate-400'}`} />
                <span className="min-w-0 flex-1 truncate">{labelOf(s)}</span>
                <span className="shrink-0 text-xs text-slate-400">{s.lines}×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** straight-line reach (about 12 minutes on foot over winding roads) within which a transfer hub counts as a start of the journey */
const HUB_WALK_M = 650;

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function Time({ min, est, t, compact = false }: { min: number; est: boolean; t: ReturnType<typeof useT>['t']; compact?: boolean }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {est ? (
        <EstTag title={t('estimateWord')}>
          ~{fmtMinutes(min)}
        </EstTag>
      ) : (
        fmtMinutes(min)
      )}
      {min >= 1440 && <sup className={`ml-0.5 text-slate-400 ${compact ? 'text-[9px]' : 'text-[10px]'}`}>+1</sup>}
    </span>
  );
}

type Rail = { line: Line } | 'dashed';

const railBar = (r: Rail, pos: string) =>
  r === 'dashed' ? (
    <span className={`absolute left-1/2 -translate-x-1/2 border-l-2 border-dashed border-slate-300 dark:border-slate-600 ${pos}`} />
  ) : (
    <span className={`absolute left-1/2 w-1 -translate-x-1/2 rounded-full ${lineRailCls(r.line)} ${pos}`} />
  );

/** One row of the metro-map style timeline: time | rail with dot | content. */
function Row({ time, dot, above, below, line, children }: { time?: ReactNode; dot?: 'start' | 'ring' | 'end'; above?: Rail; below?: Rail; line?: Line; children: ReactNode }) {
  const hasDot = dot !== undefined;
  const ringTone = line ? (line.type === 'urbano' ? 'border-emerald-600' : 'border-slate-700 dark:border-slate-400') : 'border-slate-400';
  return (
    <div className="grid grid-cols-[4.5rem_1.25rem_minmax(0,1fr)] gap-x-2.5">
      <div className="pt-1 text-right text-sm font-semibold leading-8">{time}</div>
      <div className="relative">
        {hasDot ? (
          <>
            {above && railBar(above, 'top-0 h-5')}
            {below && railBar(below, 'top-5 bottom-0')}
          </>
        ) : (
          below && railBar(below, 'inset-y-0')
        )}
        {dot === 'start' && <span className="absolute left-1/2 top-3.5 z-10 size-3 -translate-x-1/2 rounded-full bg-sky-600 ring-4 ring-white dark:ring-slate-900" />}
        {dot === 'ring' && <span className={`absolute left-1/2 top-3.5 z-10 size-3 -translate-x-1/2 rounded-full border-[2.5px] bg-white dark:bg-slate-900 ${ringTone}`} />}
        {dot === 'end' && <Icon name="pin" className="absolute left-1/2 top-2 z-10 size-5 -translate-x-1/2 fill-white text-sky-600 dark:fill-slate-900" strokeWidth={2} />}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function StopName({ name, stop }: { name: string; stop: Parameters<typeof MapPin>[0]['stop'] }) {
  const { lang } = useT();
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-1 py-1 text-[15px] font-medium leading-5">
      <span className="min-w-0 wrap-break-word">{localStopName(name, lang)}</span>
      <PrecisionWarning stop={stop} />
      <MapPin stop={stop} />
    </div>
  );
}

/** "🚶 Walk to the stop: 280 m (~4 min)" between the picked point and the bus. */
function WalkNote({ label, testId }: { label: string; testId: string }) {
  return (
    <p className="py-2 text-sm leading-5 text-slate-600 dark:text-slate-300" data-testid={testId}>
      <span aria-hidden="true">🚶 </span>
      {label}
    </p>
  );
}

function ItineraryCard({ it, shared, selected, onSelect, fromPt, toPt }: { it: Itinerary; shared: Shared; selected: boolean; onSelect: () => void; fromPt?: Picked['pt']; toPt?: Picked['pt'] }) {
  const { t, lang } = useT();
  const dur = it.arrive - it.depart;
  const last = it.legs.length - 1;
  // walking from the point picked on the map to the first stop / from the last stop to the picked destination
  const walkIn = walkTo(fromPt, tripStops(it.legs[0].trip)[it.legs[0].fromPos]);
  const walkOut = walkTo(toPt, tripStops(it.legs[last].trip)[it.legs[last].toPos]);
  return (
    <Card className={`p-0! transition-shadow ${selected && shared.desktop ? 'ring-2 ring-sky-500/70' : ''}`}>
      <button onClick={onSelect} className="flex w-full items-center justify-between gap-3 rounded-t-2xl px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-xl font-semibold">
          <Time min={it.depart} est={it.legs[0].departEstimated} t={t} />
          <Icon name="chevron" className="size-4 text-slate-300" />
          <Time min={it.arrive} est={it.legs[last].arriveEstimated} t={t} />
        </span>
        <span className="flex flex-col items-end gap-0.5 text-right">
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-semibold tabular-nums dark:bg-slate-800">{dur} min</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">{it.legs.length === 1 ? t('noTransfer') : t('oneTransfer')}</span>
        </span>
      </button>
      <div className="border-t border-slate-100 px-4 pb-3 pt-3 dark:border-slate-800">
        {walkIn && (
          <Row time={<span className="text-slate-500 tabular-nums dark:text-slate-400">{fmtMinutes(it.legs[0].depart - walkIn.min)}</span>} below="dashed">
            <WalkNote label={t('walkToStop', { m: walkIn.m, n: walkIn.min, at: fmtMinutes(it.legs[0].depart) })} testId="walk-in" />
          </Row>
        )}
        {it.legs.map((l, i) => {
          const prev = it.legs[i - 1];
          const stops = tripStops(l.trip);
          const line = l.trip.line;
          const isLast = i === last;
          return (
            <div key={i}>
              <Row
                time={<Time min={l.depart} est={l.departEstimated} t={t} compact />}
                dot={i === 0 ? 'start' : 'ring'}
                above={prev || walkIn ? 'dashed' : undefined}
                below={{ line }}
                line={line}
              >
                <StopName name={stops[l.fromPos].name} stop={stops[l.fromPos]} />
              </Row>
              <Row below={{ line }}>
                <button
                  className="my-1 flex w-full items-center gap-2.5 rounded-xl bg-slate-50 px-2.5 py-2 text-left transition-colors hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800"
                  onClick={() => shared.openLine(line.id, l.trip.dirIndex)}
                >
                  <LineBadge line={line} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{dirLabel(l.trip.dir, line.name)}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{t('rideStops', { n: l.stops, m: l.arrive - l.depart })}</span>
                  </span>
                  <Icon name="chevron" className="size-4 shrink-0 text-slate-300" />
                </button>
              </Row>
              <Row
                time={<Time min={l.arrive} est={l.arriveEstimated} t={t} compact />}
                dot={isLast ? 'end' : 'ring'}
                above={{ line }}
                below={isLast ? (walkOut ? 'dashed' : undefined) : 'dashed'}
                line={line}
              >
                <StopName name={stops[l.toPos].name} stop={stops[l.toPos]} />
              </Row>
              {isLast && walkOut && (
                <Row time={<span className="text-slate-500 tabular-nums dark:text-slate-400">{fmtMinutes(l.arrive + walkOut.min)}</span>}>
                  <WalkNote label={t('walkToDest', { m: walkOut.m, n: walkOut.min })} testId="walk-out" />
                </Row>
              )}
              {!isLast && (
                <Row below="dashed">
                  <p className="py-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    <b className="font-semibold text-slate-600 dark:text-slate-300">{t('transferWord')}</b>
                    {' · '}
                    {localStopName(tripStops(it.legs[i + 1].trip)[it.legs[i + 1].fromPos].name, lang)}
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
    </Card>
  );
}

export function PlannerTab({ shared }: { shared: Shared }) {
  const { t } = useT();
  const { planner, setPlanner, applied, commit } = shared;
  const { from, to, time, type, directOnly } = planner;
  const patch = (p: Partial<PlannerForm>) => setPlanner((f) => ({ ...f, ...p }));
  const setFrom = (v: Picked) => patch({ from: v });
  const setTo = (v: Picked) => patch({ to: v });
  const setTime = (v: string) => patch({ time: v });
  const setType = (v: LineTypeFilter) => patch({ type: v });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<'from' | 'to' | null>(null);

  const { y: ny, m: nm, d: nd } = shared.ctx.now;
  const today = useMemo(() => ({ y: ny, m: nm, d: nd }), [ny, nm, nd]);
  const todayIso = ymdToIso(today);
  const tomorrowIso = ymdToIso(addDays(today, 1));
  // the chosen day (any date); null = today
  const date = useMemo(() => isoToYmd(planner.date) ?? today, [planner.date, today]);
  const dateIso = ymdToIso(date);
  const dayInfo = useMemo(() => serviceDay(date, shared.ctx.municipalities), [date, shared.ctx.municipalities]);
  // all trips of the day; rebuilt only when the date or the school switch changes
  const trips = useMemo(() => servicesFor(shared.net, shared.lines, date, shared.ctx.school, shared.ctx.municipalities), [shared.net, shared.lines, date, shared.ctx.school, shared.ctx.municipalities]);

  // results and map follow the applied values: a picked suggestion / map point or Enter, never the keystrokes
  const dFrom = applied.from;
  const dTo = applied.to;
  const [h, m] = time.split(':').map(Number);
  const departAt = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);

  const result = useMemo(() => {
    const A = resolveNodes(shared.net, dFrom.text, dFrom.key);
    const B = resolveNodes(shared.net, dTo.text, dTo.key);
    if (!dFrom.text.trim() || !dTo.text.trim()) return null;
    const only = type === 'all' ? trips : trips.filter((tr) => tr.line.type === type);
    // walking from a picked start point: a bus counts only when it leaves after departAt + the walk to its stop
    let walkIn: Map<number, number> | undefined;
    if (dFrom.pt) {
      // a terminal within walking reach is a boarding point too: leaving from there beats a one-stop city hop to it
      for (const hub of hubsNear(shared.net, dFrom.pt.lat, dFrom.pt.lon, HUB_WALK_M)) A.add(hub.id);
      walkIn = new Map();
      for (const id of A) {
        const w = walkTo(dFrom.pt, shared.net.nodes[id]);
        if (w) walkIn.set(id, w.min);
      }
    }
    const found = plan(shared.net, only, A, B, departAt, walkIn);
    return { A: A.size, B: B.size, plan: directOnly ? { ...found, transfers: [] } : found };
  }, [shared.net, trips, dFrom, dTo, departAt, type, directOnly]);

  const empty = result && !result.plan.direct.length && !result.plan.transfers.length;
  const all = useMemo(
    () => (result ? [...result.plan.direct.map((it, i) => ({ key: `d${i}`, it })), ...result.plan.transfers.map((it, i) => ({ key: `t${i}`, it }))] : []),
    [result],
  );
  const anyEstimated = all.some(({ it }) => it.legs.some((l) => l.departEstimated || l.arriveEstimated));
  const selected = all.find((x) => x.key === selectedKey) ?? all[0];

  // the selected itinerary is drawn on the map (desktop side map, small map on the phone when a point was picked)
  const rawLayers = useMemo<MapLayer[] | null>(() => {
    if (!selected) return null;
    const legs = selected.it.legs;
    const pinFor = (kind: PickedPin['kind'], pt: Picked['pt'], stop: { lat?: number; lon?: number; name: string }): PickedPin | null =>
      pt ? { kind, lat: pt.lat, lon: pt.lon, stop: stop.lat !== undefined && stop.lon !== undefined ? { lat: stop.lat, lon: stop.lon, name: stop.name } : undefined } : null;
    const first = tripStops(legs[0].trip)[legs[0].fromPos];
    const lastLeg = legs[legs.length - 1];
    const pins = [pinFor('from', dFrom.pt, first), pinFor('to', dTo.pt, tripStops(lastLeg.trip)[lastLeg.toPos])].filter((p): p is PickedPin => p !== null);
    // every change of bus: the alighting stop, and the walk to the platform of the next bus when that is another stop
    const transfers = legs.slice(0, -1).flatMap((l, i) => {
      const a = tripStops(l.trip)[l.toPos];
      const b = tripStops(legs[i + 1].trip)[legs[i + 1].fromPos];
      if (a.lat === undefined || a.lon === undefined) return [];
      const at: [number, number] = [a.lat, a.lon];
      const apart = b.lat !== undefined && b.lon !== undefined && Math.hypot((b.lat - a.lat) * 110540, (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180)) > 5;
      return [{ name: a.name, at, ...(apart ? { to: [b.lat, b.lon] as [number, number] } : {}) }];
    });
    return legs.map((l, i) => ({
      shapeId: l.trip.dir.shapeId,
      stops: tripStops(l.trip).slice(l.fromPos, l.toPos + 1),
      color: lineColor(l.trip.line),
      detours: detoursFor(l.trip.line, l.trip.dirIndex, l.trip.notes),
      ride: { stops: tripStops(l.trip).map((s) => (s.lat !== undefined && s.lon !== undefined ? ([s.lat, s.lon] as [number, number]) : null)), from: l.fromPos, to: l.toPos },
      ...(i === 0 && pins.length ? { pins } : {}),
      ...(i === 0 && transfers.length ? { transfers } : {}),
    }));
  }, [selected, dFrom.pt, dTo.pt]);
  const layers = rawLayers;
  const { desktop, setMap } = shared;
  useEffect(() => {
    if (!desktop) return;
    setMap(layers);
    return () => setMap(null);
  }, [desktop, setMap, layers]);

  const setDeparture = (plusMin: number) => {
    const target = shared.ctx.now.minutes + plusMin;
    patch({ date: target >= 1440 ? tomorrowIso : null, time: hhmm(target % 1440) });
  };
  const isChip = (plusMin: number) => {
    const target = shared.ctx.now.minutes + plusMin;
    return time === hhmm(target % 1440) && dateIso === (target >= 1440 ? tomorrowIso : todayIso);
  };

  const renderList = (title: ReactNode, key: 'd' | 't') => {
    const rows = all.filter((x) => x.key.startsWith(key));
    if (!rows.length) return null;
    return (
      <section>
        <SectionTitle>{title}</SectionTitle>
        <div className="flex flex-col gap-3">
          {rows.map(({ key: k, it }) => (
            <ItineraryCard key={k} it={it} shared={shared} selected={selected?.key === k} onSelect={() => setSelectedKey(k)} fromPt={dFrom.pt} toPt={dTo.pt} />
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-3!">
        <div className="flex items-stretch gap-2">
          <div className="flex w-5 shrink-0 flex-col items-center pb-3.5 pt-4.25">
            <span className="size-2.5 rounded-full border-[2.5px] border-sky-600" />
            <span className="my-1 w-0 flex-1 border-l-2 border-dotted border-slate-300 dark:border-slate-600" />
            <Icon name="pin" className="size-4 text-sky-600" strokeWidth={2} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <Combobox label={t('from')} placeholder={t('fromPlaceholder')} value={from} onChange={setFrom} onCommit={() => commit({ from })} shared={shared} onPickMap={() => setPickFor('from')} />
            <div className="mx-2 h-px bg-slate-100 dark:bg-slate-800" />
            <Combobox label={t('to')} placeholder={t('toPlaceholder')} value={to} onChange={setTo} onCommit={() => commit({ to })} shared={shared} onPickMap={() => setPickFor('to')} />
          </div>
          <button
            onClick={() => {
              patch({ from: to, to: from });
              commit({ from: to, to: from });
            }}
            aria-label={t('swap')}
            title={t('swap')}
            className="size-10 shrink-0 self-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-sky-600 active:rotate-180 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <Icon name="swap" className="mx-auto size-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <TimePicker value={time} onChange={setTime} />
          <Chip active={isChip(0)} onClick={() => setDeparture(0)}>
            {t('chipNow')}
          </Chip>
          <Chip active={isChip(15)} onClick={() => setDeparture(15)}>
            {t('chipPlus15')}
          </Chip>
          <Chip active={isChip(30)} onClick={() => setDeparture(30)}>
            {t('chipPlus30')}
          </Chip>
          <Chip active={isChip(60)} onClick={() => setDeparture(60)}>
            {t('chipPlus60')}
          </Chip>
          <div className="ml-auto inline-flex rounded-full bg-slate-100 p-0.5 dark:bg-slate-800" role="group">
            {([null, tomorrowIso] as const).map((o) => {
              const on = dateIso === (o ?? todayIso);
              return (
                <button
                  key={o ?? 'today'}
                  aria-pressed={on}
                  onClick={() => patch({ date: o })}
                  className={`h-8 rounded-full px-3 text-sm font-medium transition-colors ${on ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
                >
                  {o === null ? t('dayToday') : t('dayTomorrow')}
                </button>
              );
            })}
          </div>
          <DatePicker value={dateIso} today={today} municipalities={shared.ctx.municipalities} onChange={(iso) => patch({ date: iso === todayIso ? null : iso })} />
          <p className="w-full px-1 text-xs text-slate-500 dark:text-slate-400" data-testid="day-info">
            {dayInfo.type === null ? t('noService') : t(`day_${dayInfo.type}`)}
            {dayInfo.reason === 'holiday' ? ` · ${t('reason_holiday')}: ${dayInfo.holiday?.name}` : dayInfo.reason === 'saturday-rule' ? ` · ${dayInfo.special}` : dayInfo.holiday ? ` · ${dayInfo.holiday.name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <TypeFilter value={type} onChange={setType} />
          <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-full px-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={directOnly} onChange={(e) => patch({ directOnly: e.target.checked })} className="size-4 accent-sky-600" />
            {t('directOnly')}
          </label>
        </div>
      </Card>

      {!result && <EmptyState icon="route" title={t('plannerEmptyTitle')} body={t('plannerHint')} />}
      {result && (result.A === 0 || result.B === 0) && <EmptyState icon="alert" tone="warn" title={t('noStopNodesTitle')} body={t('noStopNodes')} />}
      {empty && result.A > 0 && result.B > 0 && <EmptyState icon="frown" title={t('noConnectionTitle')} body={t('noConnectionBody')} />}
      {empty && result.A > 0 && result.B > 0 && (type !== 'all' || directOnly) && (
        <div className="flex justify-center">
          <Chip
            onClick={() => {
              patch({ type: 'all', directOnly: false });
            }}
          >
            {t('tryAllTypes')}
          </Chip>
        </div>
      )}

      {!desktop && layers?.[0]?.pins && (
        <div data-testid="planner-map">
          <RouteMap layers={layers} />
        </div>
      )}
      {renderList(t('directTitle'), 'd')}
      {renderList(`${result?.plan.direct.length === 0 ? `${t('noDirect')} ` : ''}${t('transferTitle')}`, 't')}
      {anyEstimated && (
        <p className="flex items-start gap-2 px-1 text-xs text-slate-500">
          <EstTag>~</EstTag>
          <span>{t('estimatedLegend').replace(/^~ = /, '')}</span>
        </p>
      )}
      {pickFor && (
        <MapPicker
          shared={shared}
          title={pickFor === 'from' ? t('from') : t('to')}
          kind={pickFor}
          current={pickFor === 'from' ? from : to}
          onPick={(v) => (pickFor === 'from' ? setFrom(v) : setTo(v))}
          onClose={() => setPickFor(null)}
        />
      )}
    </div>
  );
}
