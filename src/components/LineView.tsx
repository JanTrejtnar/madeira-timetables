import { useEffect, useMemo, useState } from 'react';
import { useT, type Key } from '../i18n';
import { dayKeysOf, keysFor, listFor, timesAtStop, withMinutes, type Timed } from '../lib/departures';
import { fmtMinutes } from '../lib/time';
import { serviceDay } from '../lib/holidays';
import type { DayKey, Line, MapLayer } from '../types';
import { Card, Chip, dirLabel, EstTag, LineBadge, lineColor, lineRailCls, MapLinks, PdfButton, SectionTitle, type Shared } from './common';
import { Icon } from './Icons';
import { RouteMap } from './RouteMap';

function defaultDay(keys: DayKey[], shared: Shared): DayKey | undefined {
  const type = serviceDay(shared.ctx.now, shared.ctx.municipalities).type;
  const wanted = type === 'weekday' ? keysFor('weekday', shared.ctx.school) : type ? [type] : [];
  return keys.find((k) => wanted.includes(k)) ?? keys[0];
}

export function LineView({ line, initialDir, shared, onBack }: { line: Line; initialDir?: number; shared: Shared; onBack: () => void }) {
  const { t } = useT();
  const [dirIndex, setDirIndex] = useState(initialDir ?? 0);
  const [stopIdx, setStopIdx] = useState(0);
  const [linksIdx, setLinksIdx] = useState<number | null>(null);
  const keys = useMemo(() => dayKeysOf(line), [line]);
  const [day, setDay] = useState<DayKey | undefined>(() => defaultDay(keys, shared));
  useEffect(() => {
    setDirIndex(initialDir ?? 0);
    setStopIdx(0);
    setDay(defaultDay(keys, shared));
    window.scrollTo(0, 0);
    document.getElementById('scroller')?.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.id, initialDir]);
  useEffect(() => {
    setStopIdx(0);
    setLinksIdx(null);
  }, [dirIndex]);

  const dir = line.directions[dirIndex] ?? line.directions[0];
  const hasTrips = !!dir?.trips?.length;
  const hasOffsets = !hasTrips && !!dir?.stopOffsets?.length;
  const perStop = hasTrips || hasOffsets;
  /** times at the selected stop are estimates (all but the first stop of a direction without printed stop times) */
  const estimatedHere = hasOffsets && stopIdx > 0;
  const today = serviceDay(shared.ctx.now, shared.ctx.municipalities);
  const dayLabel = (k: DayKey) => {
    const extra = line.dayLabels?.[k];
    const base = t(`day_${k}` as Key);
    return extra && (k === 'weekday' || k === 'saturday' || k === 'sunday') ? `${base} (${extra})` : base;
  };

  const times: Timed[] = useMemo(() => {
    if (!dir || !day) return [];
    if (hasTrips) return timesAtStop(dir, stopIdx, (dir.trips ?? []).filter((x) => x.days.includes(day)));
    const type = day === 'saturday' || day === 'sunday' ? day : 'weekday';
    const list = day === 'weekday_school' || day === 'weekday_holiday' ? dir.departures[day] ?? [] : listFor(dir, type, true);
    const off = hasOffsets ? dir.stopOffsets?.[stopIdx] ?? 0 : 0;
    return withMinutes(list).map((x) => (off ? { ...x, minutes: x.minutes + off, t: fmtMinutes(x.minutes + off) } : x));
  }, [dir, day, hasTrips, hasOffsets, stopIdx]);
  const isToday = day !== undefined && today.type !== null && keysFor(today.type, shared.ctx.school).includes(day);
  const nextIdx = isToday ? times.findIndex((x) => x.minutes >= shared.ctx.now.minutes) : -1;

  const hasMap = !!dir && (dir.stops.some((s) => s.lat !== undefined) || dir.shapeId !== null);
  const layers = useMemo<MapLayer[]>(() => (dir ? [{ shapeId: dir.shapeId, stops: dir.stops, color: lineColor(line) }] : []), [dir, line]);
  // on desktop the route is drawn on the big map next to the sidebar, on mobile it is shown inline
  const { desktop, setMap } = shared;
  useEffect(() => {
    if (!desktop || !hasMap) return;
    setMap(layers);
    return () => setMap(null);
  }, [desktop, hasMap, setMap, layers]);

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
              {d.variant ? `${d.variant}: ` : ''}
              {dirLabel(d, line.name)}
            </Chip>
          ))}
        </div>
      )}

      {line.hasParsedSchedule && dir && (
        <section className="flex flex-col gap-3">
          <div>
            <SectionTitle>
              {perStop ? `${t('departuresFromStop')}: ${dir.stops[stopIdx]?.name ?? ''}${estimatedHere ? ` (${t('estimateWord')})` : ''}` : `${t('schedule')}: ${dir.from}`}
            </SectionTitle>
            {perStop && <p className="px-1 text-xs text-slate-500 dark:text-slate-400">{estimatedHere ? t('estimatedAtStop') : t('tapStop')}</p>}
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
                const label = (
                  <>
                    {estimatedHere ? '~' : ''}
                    {x.t}
                    {x.notes?.length ? <sup className="ml-0.5 text-[10px] font-normal opacity-70">{x.notes.join(',')}</sup> : null}
                  </>
                );
                return (
                  <span
                    key={i}
                    className={`rounded-lg px-1 py-1.5 text-center text-sm tabular-nums ${
                      i === nextIdx ? 'bg-sky-600 font-bold text-white' : i < nextIdx ? 'text-slate-300 dark:text-slate-600' : 'font-medium'
                    }`}
                  >
                    {estimatedHere && i !== nextIdx ? <EstTag>{label}</EstTag> : label}
                  </span>
                );
              })}
            </Card>
          ) : (
            <p className="px-1 text-sm text-slate-500">{t('noDeparturesInDir')}</p>
          )}
        </section>
      )}

      {Object.keys(line.notes).length > 0 && (
        <section>
          <SectionTitle>{t('notes')}</SectionTitle>
          <ul className="space-y-1 px-1 text-sm">
            {Object.entries(line.notes).map(([k, v]) => (
              <li key={k}>
                <b>{k}</b> – {v}
              </li>
            ))}
            {line.generalNotes?.map((n, i) => (
              <li key={`g${i}`} className="text-slate-500">
                {n}
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasMap && !desktop && (
        <section>
          <SectionTitle>{t('map')}</SectionTitle>
          <RouteMap layers={layers} />
        </section>
      )}

      {dir && (
        <section>
          <SectionTitle aside={<span className="text-xs text-slate-400">{dir.stops.length}</span>}>{t('stopsOfDirection')}</SectionTitle>
          {dir.stops.length ? (
            <ol className="rounded-2xl border border-slate-200/70 bg-white py-2 pr-2 text-sm dark:border-slate-700/70 dark:bg-slate-900">
              {dir.stops.map((s, i) => {
                const selectable = perStop;
                const edge = i === 0 || i === dir.stops.length - 1;
                const active = i === stopIdx && selectable;
                const content = (
                  <>
                    <span className={`min-w-0 flex-1 ${edge || active ? 'font-semibold' : ''}`}>{s.name}</span>
                    {hasOffsets && i > 0 && (
                      <EstTag>
                        <span className="text-xs">~+{dir.stopOffsets?.[i]} min</span>
                      </EstTag>
                    )}
                    {s.code && <span className="text-xs text-slate-400">{s.code}</span>}
                  </>
                );
                const hasCoords = s.lat !== undefined && s.lon !== undefined;
                const last = i === dir.stops.length - 1;
                return (
                  <li key={i} className="grid grid-cols-[2.75rem_minmax(0,1fr)]">
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
                        {selectable ? (
                          <button
                            onClick={() => {
                              setStopIdx(i);
                              setLinksIdx(i);
                            }}
                            aria-pressed={i === stopIdx}
                            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 pr-1 text-left"
                          >
                            {content}
                          </button>
                        ) : (
                          <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 pr-1">{content}</div>
                        )}
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
                        <div className="flex flex-wrap items-center gap-2 pb-2.5">
                          <MapLinks stop={s} />
                          {!hasCoords && <span className="text-xs text-slate-400">{t('mapByName')}</span>}
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

      {line.hasParsedSchedule && <PdfButton line={line} />}
    </div>
  );
}
