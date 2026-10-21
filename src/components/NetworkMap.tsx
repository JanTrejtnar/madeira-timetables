import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { darkTiles } from '../lib/tiles';
import { useT } from '../i18n';
import { departuresFrom } from '../lib/nearby';
import { decodeSegment, loadOverview, type Overview } from '../lib/overview';
import { dirKey } from '../lib/network';
import { OPERATORS, operatorById, operatorOf, type OperatorId } from '../lib/operators';
import { simplify } from '../lib/simplify';
import { localStopName } from '../lib/text';
import type { Line } from '../types';
import { EstTag, LineBadge, type Shared } from './common';
import { Icon } from './Icons';

type Selection = { kind: 'stop'; nodeId: number } | { kind: 'line'; id: number } | null;

const touch = typeof window !== 'undefined' && (L.Browser.mobile || navigator.maxTouchPoints > 0);
/** zoom from which stops with at least this many lines are drawn: the hubs first, every stop when zoomed in close */
const TIER_ZOOM = [0, 13, 14];
/** zoom from which the full-resolution geometry of the lines is drawn; below it a copy simplified to about 30 m */
const DETAIL_ZOOM = 13;
const LITE_TOLERANCE = 0.0003;
const tierOf = (lineCount: number, hub: boolean) => (hub || lineCount >= 6 ? 0 : lineCount >= 2 ? 1 : 2);
/** Madeira with a margin; Porto Santo is a pan away */
const ISLAND: L.LatLngBoundsLiteral = [[32.60, -17.27], [32.88, -16.65]];

/** The whole network when no route is shown: lines in the colour of their operator, stops as tappable points, a panel for the tapped one. */
export function NetworkMap({ shared, fill = false }: { shared: Shared; fill?: boolean }) {
  const { t, lang } = useT();
  const { net, lines, userPos, locate, geo } = shared;
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [sel, setSel] = useState<Selection>(null);
  const [hidden, setHidden] = useState<ReadonlySet<OperatorId>>(new Set());
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
    };
  }, [full]);
  const selRef = useRef(setSel);
  selRef.current = setSel;

  const lineById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  /** lines calling at each node, built once per network */
  const linesAt = useMemo(() => {
    const m = new Map<number, Map<number, Line>>();
    for (const line of lines) {
      line.directions.forEach((_, di) => {
        for (const id of net.dirNodes.get(dirKey(line, di)) ?? []) (m.get(id) ?? m.set(id, new Map()).get(id)!).set(line.id, line);
      });
    }
    return m;
  }, [net, lines]);

  useEffect(() => {
    let alive = true;
    loadOverview().then((o) => alive && setOverview(o), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const lineLayers = useRef(new Map<number, L.Polyline[]>());
  const operatorGroups = useRef(new Map<OperatorId, L.LayerGroup>());
  const stopApi = useRef<{ light: (id: number | null) => void } | null>(null);
  const selStop = useRef<number | null>(null);
  /** one canvas for lines and stops: they share its hit testing, so both stay clickable */
  const renderer = useRef<L.Canvas | null>(null);
  const baseWeight = useRef(new WeakMap<L.Polyline, number>());

  // the map itself
  useEffect(() => {
    const container = el.current;
    if (!container) return;
    const map = L.map(container, { zoomControl: true, preferCanvas: true, scrollWheelZoom: fill, zoomAnimation: true, wheelDebounceTime: 60 });
    darkTiles().addTo(map);
    map.fitBounds(ISLAND, { animate: false });
    let moved = false;
    map.once('movestart', () => (moved = true));
    const syncView = () => container.setAttribute('data-view', `${map.getZoom()}|${map.getCenter().lat.toFixed(5)}|${map.getCenter().lng.toFixed(5)}`);
    syncView();
    map.on('moveend', syncView);
    map.on('click', () => selRef.current(null));
    renderer.current = L.canvas({ padding: 0.4 });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);
    // the container may be laid out after the map is created: fit the island once its size is known, unless the user already moved the map
    const late = setTimeout(() => {
      map.invalidateSize();
      if (!moved) map.fitBounds(ISLAND, { animate: false });
    }, 250);
    return () => {
      clearTimeout(late);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      renderer.current = null;
      lineLayers.current = new Map();
      operatorGroups.current = new Map();
    };
  }, [fill]);

  // lines: one canvas, the busiest on top; a coarse copy of every polyline is drawn until the map is zoomed in close
  useEffect(() => {
    const map = mapRef.current;
    const canvas = renderer.current;
    if (!map || !overview || !canvas) return;
    const groups = new Map<OperatorId, L.LayerGroup>(OPERATORS.map((o) => [o.id, L.layerGroup().addTo(map)]));
    operatorGroups.current = groups;
    const layers = new Map<number, L.Polyline[]>();
    const geo = new Map<L.Polyline, { full: [number, number][]; lite: [number, number][] }>();
    const detailed = () => map.getZoom() >= DETAIL_ZOOM;
    for (const o of [...overview.lines].sort((a, b) => a.t - b.t)) {
      const line = lineById.get(o.i);
      if (!line) continue;
      const op = operatorOf(line);
      const group = groups.get(op)!;
      const weight = 2 + Math.min(3, o.t / 25);
      const polys: L.Polyline[] = [];
      for (const seg of o.p) {
        const full = decodeSegment(seg);
        const lite = simplify(full, LITE_TOLERANCE);
        const pl = L.polyline(detailed() ? full : lite, { renderer: canvas, color: operatorById(op).color, weight, opacity: 0.9, lineCap: 'round', lineJoin: 'round', smoothFactor: 1.5 })
          .bindTooltip(`${line.number} · ${line.name}`, { sticky: true })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selRef.current({ kind: 'line', id: line.id });
          })
          .addTo(group);
        geo.set(pl, { full, lite });
        baseWeight.current.set(pl, weight);
        polys.push(pl);
      }
      layers.set(line.id, polys);
    }
    lineLayers.current = layers;
    let wasDetailed = detailed();
    const swap = () => {
      if (detailed() === wasDetailed) return;
      wasDetailed = detailed();
      for (const [pl, g] of geo) pl.setLatLngs(wasDetailed ? g.full : g.lite);
    };
    map.on('zoomend', swap);
    return () => {
      map.off('zoomend', swap);
      for (const g of groups.values()) g.remove();
    };
  }, [overview, lineById, fill]);

  // stops: hubs from far away, more as the map zooms in; only those in view, created on first need
  useEffect(() => {
    const map = mapRef.current;
    const canvas = renderer.current;
    if (!map || !canvas) return;
    const ids: number[][] = [[], [], []];
    const tierById = new Map<number, number>();
    for (const n of net.nodes) {
      if (n.lat === undefined || n.lon === undefined || !linesAt.get(n.id)?.size) continue;
      const tier = tierOf(linesAt.get(n.id)!.size, !!n.transferHub);
      ids[tier].push(n.id);
      tierById.set(n.id, tier);
    }
    const base = (id: number) => {
      const tier = tierById.get(id) ?? 2;
      return { radius: tier === 0 ? 6 : tier === 1 ? 4.5 : 3.5, color: '#0f172a', weight: tier === 0 ? 2.5 : 2, fillColor: '#ffffff', fillOpacity: 1 };
    };
    const made = new Map<number, L.CircleMarker>();
    const make = (id: number): L.CircleMarker => {
      let m = made.get(id);
      if (!m) {
        const n = net.nodes[id];
        m = L.circleMarker([n.lat as number, n.lon as number], { renderer: canvas, ...base(id), bubblingMouseEvents: false })
          .bindTooltip(localStopName(n.name, lang))
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selRef.current({ kind: 'stop', nodeId: id });
          });
        made.set(id, m);
      }
      return m;
    };
    const group = L.layerGroup().addTo(map);
    const shown = new Set<number>();
    let lit: number | null = null;
    const refresh = () => {
      const z = map.getZoom();
      const view = map.getBounds().pad(0.25);
      const want = new Set<number>();
      ids.forEach((list, i) => {
        if (z < TIER_ZOOM[i]) return;
        for (const id of list) {
          const n = net.nodes[id];
          if (view.contains([n.lat as number, n.lon as number])) want.add(id);
        }
      });
      if (selStop.current !== null && tierById.has(selStop.current)) want.add(selStop.current);
      for (const id of shown) if (!want.has(id)) (group.removeLayer(made.get(id)!), shown.delete(id));
      for (const id of want) if (!shown.has(id)) (group.addLayer(make(id)), shown.add(id));
    };
    /** the tapped stop is large and yellow, the one tapped before goes back to its size */
    const light = (id: number | null) => {
      refresh();
      if (lit !== null && lit !== id) made.get(lit)?.setStyle(base(lit));
      lit = id;
      if (id === null) return;
      const m = made.get(id);
      if (!m) return;
      m.setStyle({ radius: 9, fillColor: '#facc15' });
      m.bringToFront();
      map.panTo(m.getLatLng(), { animate: true });
    };
    stopApi.current = { light };
    refresh();
    if (selStop.current !== null) light(selStop.current);
    map.on('moveend', refresh);
    return () => {
      map.off('moveend', refresh);
      stopApi.current = null;
      group.remove();
    };
  }, [net, linesAt, fill, lang, overview]);

  // operators switched off in the legend
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [id, g] of operatorGroups.current) {
      if (hidden.has(id)) g.remove();
      else if (!map.hasLayer(g)) g.addTo(map);
    }
  }, [hidden, overview]);

  // the selected stop or line stands out
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const lineId = sel?.kind === 'line' ? sel.id : null;
    for (const [id, polys] of lineLayers.current) for (const p of polys) p.setStyle({ opacity: lineId === null || id === lineId ? 0.9 : 0.25, weight: (baseWeight.current.get(p) ?? 3) + (id === lineId ? 3 : 0) });
    if (lineId !== null) lineLayers.current.get(lineId)?.forEach((p) => p.bringToFront());
    const stopId = sel?.kind === 'stop' ? sel.nodeId : null;
    selStop.current = stopId;
    stopApi.current?.light(stopId);
  }, [sel, overview]);

  // the user's position
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userPos) return;
    const dot = L.marker([userPos.lat, userPos.lon], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 1000, keyboard: false }).bindTooltip(t('yourPosition')).addTo(map);
    const ring = L.circle([userPos.lat, userPos.lon], { radius: Math.min(userPos.acc, 500), color: '#2563eb', weight: 1, fillOpacity: 0.08 }).addTo(map);
    map.flyTo([userPos.lat, userPos.lon], Math.max(map.getZoom(), 15), { duration: 0.6 });
    return () => {
      dot.remove();
      ring.remove();
    };
  }, [userPos?.seq, fill, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const node = sel?.kind === 'stop' ? net.nodes[sel.nodeId] : null;
  const picked = sel?.kind === 'line' ? lineById.get(sel.id) : null;

  return (
    <div className={full ? 'fixed inset-0 z-1000 bg-white dark:bg-slate-950' : 'relative h-full w-full'} data-testid="network-map">
      <div ref={el} className="isolate size-full bg-slate-200 dark:bg-slate-800" style={{ touchAction: touch ? 'none' : undefined }} />
      <div className="pointer-events-none absolute left-3 top-3 z-500 flex max-w-[calc(100%-4.5rem)] flex-wrap gap-1.5" data-testid="network-legend">
        {OPERATORS.map((o) => {
          const off = hidden.has(o.id);
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={!off}
              onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; })}
              className={`pointer-events-auto flex h-8 items-center gap-1.5 rounded-full bg-white/95 px-2.5 text-xs font-semibold shadow-md ring-1 ring-slate-200 backdrop-blur dark:bg-slate-900/95 dark:ring-slate-700 ${off ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200'}`}
            >
              <span className="size-2.5 rounded-full" style={{ background: off ? '#cbd5e1' : o.color }} />
              {o.name}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={locate}
        disabled={geo === 'busy'}
        aria-label={t('locateMe')}
        title={t('locateMe')}
        className="absolute right-3 top-3 z-500 flex size-10 items-center justify-center rounded-xl bg-white text-sky-700 shadow-md ring-1 ring-slate-200 disabled:opacity-60 dark:bg-slate-900 dark:text-sky-300 dark:ring-slate-700"
      >
        <svg viewBox="0 0 24 24" className={`size-5 ${geo === 'busy' ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => setFull((v) => !v)}
        aria-label={full ? t('mapExitFullscreen') : t('mapFullscreen')}
        title={full ? t('mapExitFullscreen') : t('mapFullscreen')}
        data-testid="map-fullscreen"
        className="absolute right-3 top-16 z-500 flex size-10 cursor-pointer items-center justify-center rounded-xl bg-white text-sky-700 shadow-md ring-1 ring-slate-200 dark:bg-slate-900 dark:text-sky-300 dark:ring-slate-700"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {full ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
        </svg>
      </button>
      {failed && <p className="absolute bottom-4 left-4 z-500 rounded-xl bg-white/95 px-3 py-2 text-xs text-amber-700 shadow-md dark:bg-slate-900/95 dark:text-amber-300">{t('mapUnavailable')}</p>}
      {node && <StopPanel shared={shared} nodeId={node.id} lines={[...(linesAt.get(node.id)?.values() ?? [])]} onClose={() => setSel(null)} />}
      {picked && <LinePanel shared={shared} line={picked} onClose={() => setSel(null)} />}
    </div>
  );
}

const panelCls = 'absolute inset-x-2 bottom-2 z-600 max-h-[55%] overflow-auto rounded-2xl border border-slate-200/70 bg-white p-3.5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:right-auto sm:w-96';

function CloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  return (
    <button type="button" onClick={onClose} aria-label={t('close')} className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
      <Icon name="close" className="size-5" />
    </button>
  );
}

/** Tapped stop: the lines that call there, the next departures and "From / To" buttons for the planner. */
function StopPanel({ shared, nodeId, lines, onClose }: { shared: Shared; nodeId: number; lines: Line[]; onClose: () => void }) {
  const { t, lang } = useT();
  const node = shared.net.nodes[nodeId];
  const deps = useMemo(() => departuresFrom(shared.net, shared.lines, { nodeId, key: node.key }, shared.ctx, 6), [shared.net, shared.lines, shared.ctx, nodeId, node.key]);
  const sorted = useMemo(() => [...lines].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })), [lines]);
  return (
    <div className={panelCls} role="dialog" aria-label={node.name} data-testid="stop-panel">
      <div className="flex items-start gap-2">
        <Icon name="bus" className="mt-1 size-5 shrink-0 text-sky-600" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-6">{localStopName(node.name, lang)}</h3>
          {(node.par || node.muni) && <p className="text-xs text-slate-500 dark:text-slate-400">{node.par ?? node.muni}</p>}
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label={t('stopLines')}>
        {sorted.map((l) => (
          <button key={l.id} type="button" onClick={() => shared.openLine(l.id)} aria-label={`${l.number} ${l.name}`} className="rounded-lg transition-opacity hover:opacity-80 active:opacity-70">
            <LineBadge line={l} />
          </button>
        ))}
      </div>
      <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('stopNextDepartures')}</h4>
      <ul className="mt-1.5 flex flex-col gap-1.5 text-sm" data-testid="stop-panel-departures">
        {!deps.length && <li className="text-slate-500">{t('noDeparturesHere')}</li>}
        {deps.map((d, i) => (
          <li key={i}>
            <button type="button" onClick={() => shared.openLine(d.line.id, d.dirIndex)} className="flex w-full items-center gap-2 text-left">
              <LineBadge line={d.line} />
              <span className="min-w-0 flex-1 truncate text-slate-500">{d.line.directions[d.dirIndex].to}</span>
              <span className="font-semibold tabular-nums">{d.estimated ? <EstTag>~{d.next.t}</EstTag> : d.next.t}</span>
              <span className="w-14 text-right text-xs text-slate-400">{d.next.inMin} min</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" data-testid="stop-set-from" onClick={() => shared.useStopAs('from', localStopName(node.name, lang), node.key)} className="min-h-10 rounded-xl bg-sky-600 px-3 text-sm font-semibold text-white active:bg-sky-700">
          {t('setAsFrom')}
        </button>
        <button type="button" data-testid="stop-set-to" onClick={() => shared.useStopAs('to', localStopName(node.name, lang), node.key)} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-sky-700 ring-1 ring-sky-200 active:bg-sky-50 dark:text-sky-300 dark:ring-sky-500/30">
          {t('setAsTo')}
        </button>
      </div>
    </div>
  );
}

/** Tapped line: name, route and the way to its timetable. */
function LinePanel({ shared, line, onClose }: { shared: Shared; line: Line; onClose: () => void }) {
  const { t } = useT();
  return (
    <div className={panelCls} role="dialog" aria-label={`${line.number} ${line.name}`} data-testid="line-panel">
      <div className="flex items-start gap-2">
        <LineBadge line={line} large />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-6">{line.name}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">{line.route}</p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <button type="button" onClick={() => shared.openLine(line.id)} className="mt-3 min-h-10 w-full rounded-xl bg-sky-600 px-3 text-sm font-semibold text-white active:bg-sky-700">
        {t('openTimetable')}
      </button>
    </div>
  );
}
