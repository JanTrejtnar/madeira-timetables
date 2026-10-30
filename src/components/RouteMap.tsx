import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import '../lib/leafletGuard';
import { addBasemap } from '../lib/basemap';
import { loadShape } from '../data';
import { useT, type Lang } from '../i18n';
import { localStopName } from '../lib/text';
import { spliceDetours } from '../lib/via';
import { offRoadLinks } from '../lib/offRoad';
import { rideSplit } from '../lib/ride';
import { googleMapsUrl, mapyCzUrl } from '../lib/maps';
import { isApproxPosition } from '../lib/precision';
import { drawPin } from '../lib/mapPin';
import type { UserPos } from '../lib/nearby';
import type { MapFocus, MapLayer, Stop } from '../types';
import { cutSpurs } from '../lib/spur';
import { iconSvg } from './Icons';
import { LocateFab, LocateHint } from './LocateControl';
import { live, useLiveLocation } from '../lib/liveLocation';

interface PopupLabels {
  google: string;
  mapy: string;
  arrival: string;
  departure: string;
  settlement: string;
}

function popupContent(s: Stop, lang: Lang, labels: PopupLabels, time: string | null, first: boolean): HTMLElement {
  const box = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = localStopName(s.name, lang);
  box.appendChild(title);
  if (time) {
    const row = document.createElement('div');
    row.className = 'popup-time';
    row.style.fontWeight = '600';
    row.textContent = `${first ? labels.departure : labels.arrival}: ${time}`;
    box.appendChild(row);
  }
  if (isApproxPosition(s)) {
    const w = document.createElement('div');
    w.setAttribute('role', 'alert');
    w.textContent = `⚠️ ${labels.settlement}`;
    w.style.cssText = 'margin-top:4px;padding:4px 6px;border-radius:6px;background:#fffbeb;color:#92400e;font-weight:600;font-size:12px;';
    box.appendChild(w);
  }
  if (s.code) {
    const code = document.createElement('div');
    code.textContent = s.code;
    code.style.color = '#64748b';
    box.appendChild(code);
  }
  const row = document.createElement('div');
  row.className = 'map-links';
  const add = (href: string, text: string, icon: 'pin' | 'map') => {
    const a = document.createElement('a');
    a.className = 'map-link';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = iconSvg(icon, 13); // static markup from our own icon table
    a.appendChild(document.createTextNode(text));
    row.appendChild(a);
  };
  add(googleMapsUrl(s), labels.google, 'pin');
  const mapy = mapyCzUrl(s);
  if (mapy) add(mapy, labels.mapy, 'map');
  box.appendChild(row);
  return box;
}

/** Transfer pin (two arrows); between two different stops also the walk between the platforms as a dashed yellow line. */
function drawTransfer(group: L.FeatureGroup, x: NonNullable<MapLayer['transfers']>[number], title: string, walkTitle: string) {
  const mid: [number, number] = x.to ? [(x.at[0] + x.to[0]) / 2, (x.at[1] + x.to[1]) / 2] : x.at;
  if (x.to) {
    // dark underlay keeps the yellow readable on light map tiles
    const walk = x.path ?? [x.at, x.to];
    L.polyline(walk, { color: '#0f172a', weight: 7, opacity: 0.55, interactive: false }).addTo(group);
    L.polyline(walk, { color: '#facc15', weight: 4, opacity: 1, dashArray: '2 8', lineCap: 'round', interactive: false }).bindTooltip(walkTitle).addTo(group);
  }
  L.marker(mid, {
    icon: L.divIcon({ className: '', html: `<div class="transfer-pin" data-testid="transfer-pin">${iconSvg('transfer', 17)}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
    zIndexOffset: 800,
    keyboard: false,
  })
    .bindTooltip(title)
    .addTo(group);
}

const touch = typeof window !== 'undefined' && (L.Browser.mobile || navigator.maxTouchPoints > 0);

interface Props {
  layers: MapLayer[];
  /** fills its parent (desktop side map) instead of being a fixed-height card */
  fill?: boolean;
  /** stop of the first layer to centre on; its popup opens with the passing time */
  focus?: MapFocus | null;
  /** GPS position of the user, shown as a pulsing dot */
  me?: UserPos | null;
  /** a stop marker of the first layer was clicked (index into that layer's stops) */
  onStopClick?: (index: number) => void;
}

/** Dark casing under the coloured line, so the route stands out on every kind of map (a whole line: 4 + 7 px, the ridden stretch: 6 + 9 px). */
function casedLine(group: L.FeatureGroup, pts: [number, number][], style: { color: string; lineCap: 'round'; lineJoin: 'round' }, weight = 4): void {
  L.polyline(pts, { ...style, weight, opacity: 1 }).addTo(group).bringToBack();
  // sent to the back after the line: casing, line, then the stop markers on top (they stay clickable)
  L.polyline(pts, { color: '#0f172a', weight: weight + 3, opacity: 0.85, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(group).bringToBack();
}

export function RouteMap({ layers, focus = null, me = null, fill = false, onStopClick }: Props) {
  const { t, lang } = useT();
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const [mapInst, setMapInst] = useState<L.Map | null>(null);
  const loc = useLiveLocation(mapInst, t('yourPosition'));
  const markers = useRef(new Map<number, L.CircleMarker>());
  const baseStyle = useRef(new Map<number, L.CircleMarkerOptions>());
  const focusRef = useRef<MapFocus | null>(focus);
  focusRef.current = focus;
  const clickRef = useRef(onStopClick);
  clickRef.current = onStopClick;
  // inline maps: one finger moves the map (the page scrolls outside it), the corner button opens it full screen
  const canFull = true;
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

  // the map is rebuilt when what it draws changes, not whenever the parent hands over equal layers (a tap on a stop does that: the view jumped back to the whole route)
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const layersKey = useMemo(() => JSON.stringify(layers), [layers]);
  useEffect(() => {
    const container = el.current;
    if (!container) return;
    const layers = layersRef.current;
    setFailed(false);
    markers.current = new Map();
    baseStyle.current = new Map();
    const map = L.map(container, { scrollWheelZoom: fill, dragging: true, touchZoom: true, zoomControl: true });
    addBasemap(map);
    mapRef.current = map;
    setMapInst(map);
    const group = L.featureGroup().addTo(map);
    const labels: PopupLabels = { google: t('mapGoogle'), mapy: t('mapMapyCz'), arrival: t('arrivalWord'), departure: t('departureWord'), settlement: t('settlementWarning') };
    let alive = true;
    // the message belongs to the route being shown: a new route starts without it, and a route that loaded clears it
    setFailed(false);
    let drawn = false;

    layers.forEach((layer, li) => {
      layer.pins?.forEach((p) => drawPin(group, p, t('pickedPoint'), t('mapWalk')));
      layer.transfers?.forEach((x) => drawTransfer(group, x, t('mapTransfer', { name: localStopName(x.name, lang) }), t('mapTransferWalk')));
      layer.stops.forEach((s, si) => {
        if (s.lat === undefined || s.lon === undefined) return;
        // a stop the trip does not serve (outside the ridden stretch) is faint and small; boarding and alighting stand out
        const sv = layer.served;
        const off = !!sv && (si < sv.from || si > sv.to);
        const board = !!sv && si === sv.from;
        const alight = !!sv && si === sv.to && sv.to > sv.from;
        const base: L.CircleMarkerOptions = off
          ? { radius: 3.5, color: '#475569', weight: 1.5, fillColor: '#fff', fillOpacity: 0.25, opacity: 0.25 }
          : board || alight
            ? { radius: 8, color: '#0f172a', weight: 3, fillColor: board ? '#16a34a' : '#dc2626', fillOpacity: 1, opacity: 1 }
            : { radius: 5.5, color: '#0f172a', weight: 2.5, fillColor: '#fff', fillOpacity: 1, opacity: 1 };
        const marker = L.circleMarker([s.lat, s.lon], base)
          .bindTooltip(localStopName(s.name, lang))
          // content is built when the popup opens, so it always shows the time of the currently selected trip
          .bindPopup(() => popupContent(s, lang, labels, li === 0 ? focusRef.current?.times[si] ?? null : null, si === 0), { autoPan: true, autoPanPadding: [12, 12] })
          .addTo(group);
        if (li === 0) {
          markers.current.set(si, marker);
          baseStyle.current.set(si, base);
          marker.on('click', () => clickRef.current?.(si));
        }
      });
    });
    const fit = () => {
      // a late call (timer, route loaded) on a removed map or a detached container would throw inside Leaflet (_leaflet_pos)
      if (!alive || !container.isConnected) return;
      map.invalidateSize();
      const b = group.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [32, 32], animate: false });
      else map.setView([32.75, -16.95], 10);
    };
    fit();

    // The container may be laid out after the map is created (route change, fonts, orientation change).
    const ro = new ResizeObserver(() => alive && map.invalidateSize());
    ro.observe(container);
    const late = setTimeout(fit, 250);

    const shapes = layers.filter((l) => l.shapeId !== null);
    if (shapes.length) {
      for (const layer of shapes) {
        loadShape(layer.shapeId as number)
          .then((pts) => {
            if (!alive) return;
            drawn = true;
            setFailed(false);
            const full = cutSpurs(spliceDetours(pts, layer.detours), layer.trip?.stops);
            const style = { color: layer.color, lineCap: 'round', lineJoin: 'round' } as const;
            const cut = layer.ride ? rideSplit(full, layer.ride.stops, layer.ride.from, layer.ride.to) : null;
            if (cut) {
              // the rest of the line is only a hint, but still readable on the dark base: thin, 60 % opaque, and outside the group so the view fits the ride
              for (const rest of [cut.before, cut.after]) if (rest.length > 1) L.polyline(rest, { ...style, weight: 3, opacity: 0.6, interactive: false }).addTo(map).bringToBack();
              casedLine(group, cut.ride, style, 6);
            } else casedLine(group, full, style);
            // a stop the line does not touch is joined to it by a dashed link (the route must not look as if the bus ignored the place)
            const placed = layer.stops.flatMap((s) => (s.lat !== undefined && s.lon !== undefined ? [[s.lat, s.lon] as [number, number]] : []));
            for (const link of offRoadLinks(full, placed)) L.polyline(link, { color: layer.color, weight: 2, opacity: 0.8, dashArray: '2 6', lineCap: 'round', interactive: false }).addTo(group);
            fit();
          })
          .catch(() => alive && !drawn && setFailed(true));
      }
    } else if (layers.length && !group.getLayers().length) setFailed(true);

    return () => {
      alive = false;
      clearTimeout(late);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setMapInst(null);
      markers.current = new Map();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layersKey, t, fill]);

  // user position: pulsing dot plus accuracy circle; centres the map on every new fix
  const meSeq = me?.seq;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !me) return;
    const dot = L.marker([me.lat, me.lon], {
      icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      zIndexOffset: 1000,
      keyboard: false,
    })
      .bindTooltip(t('yourPosition'))
      .addTo(map);
    const ring = L.circle([me.lat, me.lon], { radius: Math.min(me.acc, 500), color: '#2563eb', weight: 1, fillOpacity: 0.08 }).addTo(map);
    return () => {
      dot.remove();
      ring.remove();
    };
  }, [me, layersKey, t, fill]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !me || meSeq === undefined || !live(map)) return;
    // include the nearest shown stops so the user sees both themselves and where to walk
    const pts: L.LatLngTuple[] = [[me.lat, me.lon]];
    for (const l of layers) for (const s of l.stops.slice(0, 3)) if (s.lat !== undefined && s.lon !== undefined) pts.push([s.lat, s.lon]);
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16, animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meSeq]);

  // tapping a stop in the list: pan to it, highlight it and open its popup (with the selected trip's time)
  const seq = focus?.seq;
  const stopIndex = focus?.stopIndex;
  const fromMap = focus?.fromMap;
  useEffect(() => {
    const map = mapRef.current;
    for (const [i, m] of markers.current) {
      const b = baseStyle.current.get(i);
      if (!b) continue;
      // the chosen stop is enlarged and filled, the others return to their own look (faint / highlighted / plain)
      m.setStyle(i === stopIndex ? { ...b, radius: 9, fillColor: b.color, fillOpacity: 1, opacity: 1 } : b);
    }
    if (!map || stopIndex === undefined) return;
    const m = markers.current.get(stopIndex);
    if (!m || !live(map)) return;
    m.bringToFront();
    // clicked on the map itself: the popup is already open and the map where the reader put it
    if (fromMap) return;
    // open the popup once the map has settled, so it pans into view instead of being cut off by the map's edge
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.6 });
    const open = () => live(map) && m.openPopup();
    map.once('moveend', open);
    const fallback = setTimeout(() => !m.isPopupOpen() && open(), 900);
    return () => {
      clearTimeout(fallback);
      map.off('moveend', open);
    };
  }, [seq, stopIndex]);
  // another trip selected while a popup is open: refresh the time in it
  const times = focus?.times;
  useEffect(() => {
    if (stopIndex === undefined) return;
    const m = markers.current.get(stopIndex);
    if (m?.isPopupOpen()) m.getPopup()?.update();
  }, [times, stopIndex]);

  const legend = layers.flatMap((l) => (l.legend ? [{ ...l.legend, color: l.color }] : []));
  return (
    <div className={full ? 'fixed inset-0 z-1000 bg-white dark:bg-slate-950' : fill ? 'relative h-full w-full' : 'relative'}>
      {/* the size classes sit on a wrapper: Leaflet owns the class list of its own container, which React must not rewrite */}
      <div className={`overflow-hidden ${fill || full ? 'h-full w-full' : 'h-72 w-full rounded-2xl border border-slate-200/70 dark:border-slate-700/70'}`}>
        <div ref={el} className="isolate size-full bg-slate-200 dark:bg-slate-800" style={{ touchAction: touch ? 'none' : undefined }} />
      </div>
      {canFull && (
        <button
          type="button"
          onClick={() => setFull((v) => !v)}
          aria-label={full ? t('mapExitFullscreen') : t('mapFullscreen')}
          title={full ? t('mapExitFullscreen') : t('mapFullscreen')}
          data-testid="map-fullscreen"
          className={`absolute z-500 flex size-10 cursor-pointer items-center justify-center rounded-xl bg-white text-sky-700 shadow-md ring-1 ring-slate-200 dark:bg-slate-900 dark:text-sky-300 dark:ring-slate-700 ${full ? 'right-3 top-[max(0.75rem,env(safe-area-inset-top))]' : 'right-3 top-3'}`}
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {full ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
          </svg>
        </button>
      )}
      <LocateFab status={loc.status} following={loc.following} onClick={loc.locate} className={full ? 'right-3 top-[max(4.25rem,calc(env(safe-area-inset-top)+3.5rem))]' : 'right-3 top-16'} />
      <LocateHint status={loc.status} />
      {legend.length > 1 && (
        <ul className="absolute bottom-6 left-3 z-500 flex max-w-[calc(100%-4.5rem)] flex-col gap-1 rounded-xl bg-white/95 p-1.5 text-xs shadow-md ring-1 ring-slate-200 dark:bg-slate-900/95 dark:ring-slate-700" data-testid="map-legend">
          {legend.map((l, i) => (
            <li key={i} className="flex min-w-0 items-center gap-1.5">
              <span className="h-1.5 w-5 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
              <span className="shrink-0 font-bold tabular-nums">{l.badge}</span>
              <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p
          className={
            fill
              ? 'absolute bottom-4 left-4 z-500 rounded-xl bg-white/95 px-3 py-2 text-xs text-amber-700 shadow-md dark:bg-slate-900/95 dark:text-amber-300'
              : 'mt-1.5 px-1 text-xs text-amber-600'
          }
        >
          {t('mapUnavailable')}
        </p>
      )}
    </div>
  );
}
