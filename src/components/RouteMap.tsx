import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { loadShape } from '../data';
import { useT } from '../i18n';
import { googleMapsUrl, mapyCzUrl } from '../lib/maps';
import type { UserPos } from '../lib/nearby';
import type { MapFocus, MapLayer, Stop } from '../types';
import { iconSvg } from './Icons';

interface PopupLabels {
  google: string;
  mapy: string;
  arrival: string;
  departure: string;
  approx: string;
  estimated: string;
  settlement: string;
}

function popupContent(s: Stop, labels: PopupLabels, time: string | null, first: boolean): HTMLElement {
  const box = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = s.name;
  box.appendChild(title);
  if (time) {
    const row = document.createElement('div');
    row.className = 'popup-time';
    row.style.fontWeight = '600';
    row.textContent = `${first ? labels.departure : labels.arrival}: ${time}`;
    box.appendChild(row);
  }
  if (s.locationPrecision === 'settlement_center') {
    const w = document.createElement('div');
    w.setAttribute('role', 'alert');
    w.textContent = `⚠️ ${labels.settlement}`;
    w.style.cssText = 'margin-top:4px;padding:4px 6px;border-radius:6px;background:#fffbeb;color:#92400e;font-weight:600;font-size:12px;';
    box.appendChild(w);
  } else if (s.approx) {
    const a = document.createElement('div');
    a.textContent = s.isEstimatedLocation ? labels.estimated : labels.approx;
    a.style.color = '#b45309';
    a.style.fontSize = '12px';
    box.appendChild(a);
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

const touch = typeof window !== 'undefined' && (L.Browser.mobile || navigator.maxTouchPoints > 0);

interface Props {
  layers: MapLayer[];
  /** fills its parent (desktop side map) instead of being a fixed-height card */
  fill?: boolean;
  /** stop of the first layer to centre on; its popup opens with the passing time */
  focus?: MapFocus | null;
  /** GPS position of the user, shown as a pulsing dot */
  me?: UserPos | null;
  /** adds the locate button to the map */
  onLocate?: () => void;
  locating?: boolean;
}

export function RouteMap({ layers, focus = null, me = null, onLocate, locating = false, fill = false }: Props) {
  const { t } = useT();
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const markers = useRef(new Map<number, L.CircleMarker>());
  const focusRef = useRef<MapFocus | null>(focus);
  focusRef.current = focus;
  // inline maps on touch screens: one finger scrolls the page, two fingers move the map
  const lockDrag = touch && !fill;

  useEffect(() => {
    const container = el.current;
    if (!container) return;
    setFailed(false);
    markers.current = new Map();
    const map = L.map(container, { scrollWheelZoom: fill, dragging: !lockDrag, touchZoom: true, zoomControl: !lockDrag });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    const group = L.featureGroup().addTo(map);
    const labels: PopupLabels = { google: t('mapGoogle'), mapy: t('mapMapyCz'), arrival: t('arrivalWord'), departure: t('departureWord'), approx: t('coordsApprox'), estimated: t('estimatedLocation'), settlement: t('settlementWarning') };
    let alive = true;

    layers.forEach((layer, li) => {
      layer.stops.forEach((s, si) => {
        if (s.lat === undefined || s.lon === undefined) return;
        const marker = L.circleMarker([s.lat, s.lon], { radius: 5, color: layer.color, weight: 2.5, fillColor: '#fff', fillOpacity: 1 })
          .bindTooltip(s.name)
          // content is built when the popup opens, so it always shows the time of the currently selected trip
          .bindPopup(() => popupContent(s, labels, li === 0 ? focusRef.current?.times[si] ?? null : null, si === 0), { autoPan: true, autoPanPadding: [12, 12] })
          .addTo(group);
        if (li === 0) markers.current.set(si, marker);
      });
    });
    const fit = () => {
      if (!alive) return;
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
            L.polyline(pts, { color: layer.color, weight: 5, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(group).bringToBack();
            fit();
          })
          .catch(() => alive && setFailed(true));
      }
    } else if (layers.length && !group.getLayers().length) setFailed(true);

    return () => {
      alive = false;
      clearTimeout(late);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markers.current = new Map();
    };
  }, [layers, t, fill, lockDrag]);

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
  }, [me, layers, t, fill, lockDrag]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !me || meSeq === undefined) return;
    // include the nearest shown stops so the user sees both themselves and where to walk
    const pts: L.LatLngTuple[] = [[me.lat, me.lon]];
    for (const l of layers) for (const s of l.stops.slice(0, 3)) if (s.lat !== undefined && s.lon !== undefined) pts.push([s.lat, s.lon]);
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16, animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meSeq]);

  // tapping a stop in the list: pan to it, highlight it and open its popup (with the selected trip's time)
  const seq = focus?.seq;
  const stopIndex = focus?.stopIndex;
  useEffect(() => {
    const map = mapRef.current;
    for (const [i, m] of markers.current) m.setStyle({ radius: i === stopIndex ? 9 : 5, fillColor: i === stopIndex ? m.options.color : '#fff' });
    if (!map || stopIndex === undefined) return;
    const m = markers.current.get(stopIndex);
    if (!m) return;
    m.bringToFront();
    // open the popup once the map has settled, so it pans into view instead of being cut off by the map's edge
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.6 });
    map.once('moveend', () => m.openPopup());
    const fallback = setTimeout(() => !m.isPopupOpen() && m.openPopup(), 900);
    return () => clearTimeout(fallback);
  }, [seq, stopIndex]);
  // another trip selected while a popup is open: refresh the time in it
  const times = focus?.times;
  useEffect(() => {
    if (stopIndex === undefined) return;
    const m = markers.current.get(stopIndex);
    if (m?.isPopupOpen()) m.getPopup()?.update();
  }, [times, stopIndex]);

  return (
    <div className={fill ? 'relative h-full w-full' : 'relative'}>
      <div
        ref={el}
        className={`isolate overflow-hidden bg-slate-200 dark:bg-slate-800 ${fill ? 'h-full w-full' : 'h-72 w-full rounded-2xl border border-slate-200/70 dark:border-slate-700/70'}`}
        style={{ touchAction: lockDrag ? 'pan-y' : undefined }}
      />
      {onLocate && (
        <button
          type="button"
          onClick={onLocate}
          disabled={locating}
          aria-label={t('locateMe')}
          title={t('locateMe')}
          className="absolute right-3 top-3 z-500 flex size-10 items-center justify-center rounded-xl bg-white text-sky-700 shadow-md ring-1 ring-slate-200 disabled:opacity-60 dark:bg-slate-900 dark:text-sky-300 dark:ring-slate-700"
        >
          <svg viewBox="0 0 24 24" className={`size-5 ${locating ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
          </svg>
        </button>
      )}
      {lockDrag && <p className="mt-1.5 px-1 text-xs text-slate-500">{t('mapHint')}</p>}
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
