import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { departuresFrom, nearbyStops, type NearbyStop } from '../lib/nearby';
import type { MapLayer } from '../types';
import { Card, EstTag, LineBadge, SectionTitle, type Shared } from './common';
import { Icon } from './Icons';
import { RouteMap } from './RouteMap';

const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

function StopCard({ stop, shared }: { stop: NearbyStop; shared: Shared }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const deps = useMemo(() => (open ? departuresFrom(shared.net, shared.lines, stop, shared.ctx) : []), [open, shared.net, shared.lines, shared.ctx, stop]);
  return (
    <Card className="p-3.5!">
      <div className="flex items-center gap-2 font-medium">
        <Icon name="pin" className="size-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1">{stop.name}</span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-sky-700 dark:text-sky-300">{fmtDist(stop.dist)}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2 text-sm">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-h-9 rounded-lg bg-sky-600 px-3 font-medium text-white transition-opacity active:opacity-80"
        >
          {open ? t('hideDepartures') : t('departuresHere')}
        </button>
        <button
          onClick={() => shared.useAsFrom(stop.name, stop.key)}
          className="min-h-9 rounded-lg px-3 font-medium text-sky-700 ring-1 ring-sky-200 dark:text-sky-300 dark:ring-sky-500/30"
        >
          {t('setAsFrom')}
        </button>
      </div>
      {open && (
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {!deps.length && <li className="text-slate-500">{t('noDeparturesHere')}</li>}
          {deps.map((d, i) => (
            <li key={i}>
              <button onClick={() => shared.openLine(d.line.id, d.dirIndex)} className="flex w-full items-center gap-2 text-left">
                <LineBadge line={d.line} />
                <span className="min-w-0 flex-1 truncate text-slate-500">{d.line.directions[d.dirIndex].to}</span>
                <span className="font-semibold tabular-nums">{d.estimated ? <EstTag>~{d.next.t}</EstTag> : d.next.t}</span>
                <span className="w-14 text-right text-xs text-slate-400">{d.next.inMin} min</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** "Stops near me": locate button, list of stops within 500 m (or 1 km) with distance, map with the pulsing position. */
export function Nearby({ shared }: { shared: Shared }) {
  const { t } = useT();
  const { userPos: pos, geo, locate, desktop, setMap } = shared;
  const result = useMemo(() => (pos ? nearbyStops(shared.net, pos) : null), [shared.net, pos]);
  const layers = useMemo<MapLayer[]>(
    () => (result?.stops.length ? [{ shapeId: null, color: '#0284c7', stops: result.stops.map((s) => ({ code: null, name: `${s.name} – ${fmtDist(s.dist)}`, lat: s.lat, lon: s.lon })) }] : []),
    [result],
  );
  // the big desktop map shows the same stops; cleared when the panel goes away
  useEffect(() => {
    if (!desktop || !pos) return;
    setMap(layers);
    return () => setMap(null);
  }, [desktop, pos, layers, setMap]);

  const err = geo === 'denied' ? t('geoDenied') : geo === 'error' ? t('geoError') : geo === 'unsupported' ? t('geoUnsupported') : null;
  return (
    <section className="flex flex-col gap-3">
      <button
        onClick={locate}
        disabled={geo === 'busy'}
        className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl bg-white px-4 font-medium text-sky-700 shadow-sm ring-1 ring-sky-200 disabled:opacity-60 dark:bg-slate-900 dark:text-sky-300 dark:ring-sky-500/30"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
        </svg>
        {geo === 'busy' ? t('locating') : t('locateMe')}
      </button>
      {err && (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
          {err}
        </p>
      )}
      {pos && result && (
        <>
          <SectionTitle aside={<span className="text-xs text-slate-400">±{Math.round(pos.acc)} m</span>}>{t('nearbyTitle')}</SectionTitle>
          {result.widened && result.stops.length > 0 && <p className="text-sm text-slate-500">{t('nearbyWidened')}</p>}
          {!result.stops.length && <p className="text-sm text-slate-500">{t('nearbyNone')}</p>}
          {!desktop && <RouteMap layers={layers} me={pos} onLocate={locate} locating={geo === 'busy'} />}
          <div className="flex flex-col gap-2">
            {result.stops.map((s) => (
              <StopCard key={s.nodeId} stop={s} shared={shared} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
