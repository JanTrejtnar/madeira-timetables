import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { addDays } from '../lib/holidays';
import { resolveNodes, servicesFor, suggest } from '../lib/network';
import { plan, type Itinerary } from '../lib/router';
import { useDebounced } from '../lib/hooks';
import { fmtMinutes } from '../lib/time';
import type { Line, MapLayer } from '../types';
import { Card, Chip, dirLabel, EmptyState, EstTag, LineBadge, lineColor, lineRailCls, MapPin, SectionTitle, SkeletonCards, TypeFilter, type LineTypeFilter, type Shared } from './common';
import { Icon } from './Icons';

interface Picked {
  text: string;
  key: string | null;
}

function Combobox({ label, placeholder, value, onChange, shared }: { label: string; placeholder: string; value: Picked; onChange: (v: Picked) => void; shared: Shared }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(value.text, 120);
  const items = useMemo(() => (open ? suggest(shared.net, shared.lines, debounced) : []), [open, debounced, shared.net, shared.lines]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  return (
    <div ref={box} className="relative">
      <input
        value={value.text}
        onChange={(e) => {
          onChange({ text: e.target.value, key: null });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="h-11 w-full rounded-lg bg-transparent px-2 text-base font-medium outline-none placeholder:font-normal placeholder:text-slate-400 focus:bg-slate-50 dark:focus:bg-slate-800/60"
      />
      {open && items.length > 0 && (
        <ul className="absolute -left-9 -right-12 top-full z-30 mt-2 max-h-72 overflow-auto rounded-2xl border border-slate-200/70 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {items.map((s) => {
            const name = s.group ? t('allStopsOf', { name: s.name }) : s.name;
            return (
            <li key={s.key}>
              <button
                className={`flex min-h-11 w-full items-center gap-3 px-4 text-left hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800 ${s.group ? 'bg-sky-50/70 font-semibold dark:bg-sky-400/10' : ''}`}
                onClick={() => {
                  onChange({ text: name, key: s.key });
                  setOpen(false);
                }}
              >
                <Icon name="pin" className={`size-4 shrink-0 ${s.group ? 'text-sky-600' : 'text-slate-400'}`} />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="shrink-0 text-xs text-slate-400">{s.lines}×</span>
              </button>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

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
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-1 py-1 text-[15px] font-medium leading-5">
      <span className="min-w-0 wrap-break-word">{name}</span>
      <MapPin stop={stop} />
    </div>
  );
}

function ItineraryCard({ it, shared, selected, onSelect }: { it: Itinerary; shared: Shared; selected: boolean; onSelect: () => void }) {
  const { t } = useT();
  const dur = it.arrive - it.depart;
  const last = it.legs.length - 1;
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
        {it.legs.map((l, i) => {
          const prev = it.legs[i - 1];
          const stops = l.trip.dir.stops;
          const line = l.trip.line;
          const isLast = i === last;
          return (
            <div key={i}>
              <Row
                time={<Time min={l.depart} est={l.departEstimated} t={t} compact />}
                dot={i === 0 ? 'start' : 'ring'}
                above={prev ? 'dashed' : undefined}
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
                below={isLast ? undefined : 'dashed'}
                line={line}
              >
                <StopName name={stops[l.toPos].name} stop={stops[l.toPos]} />
              </Row>
              {!isLast && (
                <Row below="dashed">
                  <p className="py-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    <b className="font-semibold text-slate-600 dark:text-slate-300">{t('transferWord')}</b>
                    {' · '}
                    {it.legs[i + 1].trip.dir.stops[it.legs[i + 1].fromPos].name}
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
  const [from, setFrom] = useState<Picked>({ text: '', key: null });
  const [to, setTo] = useState<Picked>({ text: '', key: null });
  const [time, setTime] = useState(() => hhmm(shared.ctx.now.minutes));
  const [dayOffset, setDayOffset] = useState<0 | 1>(0);
  const fromReq = shared.plannerFrom;
  useEffect(() => {
    if (fromReq) setFrom({ text: fromReq.text, key: fromReq.key });
  }, [fromReq?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [type, setType] = useState<LineTypeFilter>('all');
  const [directOnly, setDirectOnly] = useState(false);

  const date = useMemo(() => addDays({ y: shared.ctx.now.y, m: shared.ctx.now.m, d: shared.ctx.now.d }, dayOffset), [shared.ctx.now.y, shared.ctx.now.m, shared.ctx.now.d, dayOffset]);
  // all trips of the day; rebuilt only when the date or the school switch changes
  const trips = useMemo(() => servicesFor(shared.net, shared.lines, date, shared.ctx.school, shared.ctx.municipalities), [shared.net, shared.lines, date, shared.ctx.school, shared.ctx.municipalities]);

  const dFrom = useDebounced(from, 150);
  const dTo = useDebounced(to, 150);
  const [h, m] = time.split(':').map(Number);
  const departAt = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);

  const result = useMemo(() => {
    const A = resolveNodes(shared.net, dFrom.text, dFrom.key);
    const B = resolveNodes(shared.net, dTo.text, dTo.key);
    if (!dFrom.text.trim() || !dTo.text.trim()) return null;
    const only = type === 'all' ? trips : trips.filter((tr) => tr.line.type === type);
    const found = plan(shared.net, only, A, B, departAt);
    return { A: A.size, B: B.size, plan: directOnly ? { ...found, transfers: [] } : found };
  }, [shared.net, trips, dFrom, dTo, departAt, type, directOnly]);

  const pending = (from !== dFrom || to !== dTo) && !!from.text.trim() && !!to.text.trim();
  const empty = result && !result.plan.direct.length && !result.plan.transfers.length;
  const all = useMemo(
    () => (result ? [...result.plan.direct.map((it, i) => ({ key: `d${i}`, it })), ...result.plan.transfers.map((it, i) => ({ key: `t${i}`, it }))] : []),
    [result],
  );
  const anyEstimated = all.some(({ it }) => it.legs.some((l) => l.departEstimated || l.arriveEstimated));
  const selected = all.find((x) => x.key === selectedKey) ?? all[0];

  // the selected itinerary is drawn on the big desktop map
  const layers = useMemo<MapLayer[] | null>(
    () =>
      selected
        ? selected.it.legs.map((l) => ({
            shapeId: l.trip.dir.shapeId,
            stops: l.trip.dir.stops.slice(l.fromPos, l.toPos + 1),
            color: lineColor(l.trip.line),
          }))
        : null,
    [selected],
  );
  const { desktop, setMap } = shared;
  useEffect(() => {
    if (!desktop) return;
    setMap(layers);
    return () => setMap(null);
  }, [desktop, setMap, layers]);

  const setDeparture = (plusMin: number) => {
    const target = shared.ctx.now.minutes + plusMin;
    setDayOffset(target >= 1440 ? 1 : 0);
    setTime(hhmm(target % 1440));
  };
  const isChip = (plusMin: number) => {
    const target = shared.ctx.now.minutes + plusMin;
    return time === hhmm(target % 1440) && dayOffset === (target >= 1440 ? 1 : 0);
  };

  const renderList = (title: ReactNode, key: 'd' | 't') => {
    const rows = all.filter((x) => x.key.startsWith(key));
    if (!rows.length) return null;
    return (
      <section>
        <SectionTitle>{title}</SectionTitle>
        <div className="flex flex-col gap-3">
          {rows.map(({ key: k, it }) => (
            <ItineraryCard key={k} it={it} shared={shared} selected={selected?.key === k} onSelect={() => setSelectedKey(k)} />
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
            <Combobox label={t('from')} placeholder={t('fromPlaceholder')} value={from} onChange={setFrom} shared={shared} />
            <div className="mx-2 h-px bg-slate-100 dark:bg-slate-800" />
            <Combobox label={t('to')} placeholder={t('toPlaceholder')} value={to} onChange={setTo} shared={shared} />
          </div>
          <button
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
            aria-label={t('swap')}
            title={t('swap')}
            className="size-10 shrink-0 self-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-sky-600 active:rotate-180 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <Icon name="swap" className="mx-auto size-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <label className="flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 pl-3 pr-2 dark:border-slate-700 dark:bg-slate-800/60">
            <Icon name="clock" className="size-4 text-slate-400" />
            <span className="sr-only">{t('departAt')}</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="bg-transparent text-sm font-semibold tabular-nums outline-none" />
          </label>
          <Chip active={isChip(0)} onClick={() => setDeparture(0)}>
            {t('chipNow')}
          </Chip>
          <Chip active={isChip(15)} onClick={() => setDeparture(15)}>
            {t('chipPlus15')}
          </Chip>
          <Chip active={isChip(60)} onClick={() => setDeparture(60)}>
            {t('chipPlus60')}
          </Chip>
          <div className="ml-auto inline-flex rounded-full bg-slate-100 p-0.5 dark:bg-slate-800" role="group">
            {([0, 1] as const).map((o) => (
              <button
                key={o}
                aria-pressed={dayOffset === o}
                onClick={() => setDayOffset(o)}
                className={`h-8 rounded-full px-3 text-sm font-medium transition-colors ${
                  dayOffset === o ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {o === 0 ? t('dayToday') : t('dayTomorrow')}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <TypeFilter value={type} onChange={setType} />
          <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-full px-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={directOnly} onChange={(e) => setDirectOnly(e.target.checked)} className="size-4 accent-sky-600" />
            {t('directOnly')}
          </label>
        </div>
      </Card>

      {!result && !pending && <EmptyState icon="route" title={t('plannerEmptyTitle')} body={t('plannerHint')} />}
      {pending && <SkeletonCards n={2} tall />}
      {!pending && result && (result.A === 0 || result.B === 0) && <EmptyState icon="alert" tone="warn" title={t('noStopNodesTitle')} body={t('noStopNodes')} />}
      {!pending && empty && result.A > 0 && result.B > 0 && <EmptyState icon="frown" title={t('noConnectionTitle')} body={t('noConnectionBody')} />}
      {!pending && empty && result.A > 0 && result.B > 0 && (type !== 'all' || directOnly) && (
        <div className="flex justify-center">
          <Chip
            onClick={() => {
              setType('all');
              setDirectOnly(false);
            }}
          >
            {t('tryAllTypes')}
          </Chip>
        </div>
      )}

      {!pending && renderList(t('directTitle'), 'd')}
      {!pending && renderList(`${result?.plan.direct.length === 0 ? `${t('noDirect')} ` : ''}${t('transferTitle')}`, 't')}
      {!pending && anyEstimated && (
        <p className="flex items-start gap-2 px-1 text-xs text-slate-500">
          <EstTag>~</EstTag>
          <span>{t('estimatedLegend').replace(/^~ = /, '')}</span>
        </p>
      )}
    </div>
  );
}
