import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { loadShape } from '../data';
import { useT } from '../i18n';
import { googleMapsUrl, mapyCzUrl } from '../lib/maps';
import type { MapLayer, Stop } from '../types';
import { iconSvg } from './Icons';

function popupContent(s: Stop, labels: { google: string; mapy: string }): HTMLElement {
  const box = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = s.name;
  box.appendChild(title);
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
}

export function RouteMap({ layers, fill = false }: Props) {
  const { t } = useT();
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // inline maps on touch screens: one finger scrolls the page, two fingers move the map
  const lockDrag = touch && !fill;

  useEffect(() => {
    const container = el.current;
    if (!container) return;
    setFailed(false);
    const map = L.map(container, { scrollWheelZoom: fill, dragging: !lockDrag, touchZoom: true, zoomControl: !lockDrag });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const group = L.featureGroup().addTo(map);
    let alive = true;

    for (const layer of layers) {
      for (const s of layer.stops) {
        if (s.lat === undefined || s.lon === undefined) continue;
        L.circleMarker([s.lat, s.lon], { radius: 5, color: layer.color, weight: 2.5, fillColor: '#fff', fillOpacity: 1 })
          .bindTooltip(s.name)
          .bindPopup(popupContent(s, { google: t('mapGoogle'), mapy: t('mapMapyCz') }))
          .addTo(group);
      }
    }
    const fit = () => {
      map.invalidateSize();
      const b = group.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [32, 32] });
      else map.setView([32.75, -16.95], 10);
    };
    fit();

    // The container may be laid out after the map is created (route change, fonts, orientation change).
    const ro = new ResizeObserver(() => map.invalidateSize());
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
    };
  }, [layers, t, fill, lockDrag]);

  return (
    <div className={fill ? 'relative h-full w-full' : ''}>
      <div
        ref={el}
        className={`isolate overflow-hidden bg-slate-200 dark:bg-slate-800 ${fill ? 'h-full w-full' : 'h-72 w-full rounded-2xl border border-slate-200/70 dark:border-slate-700/70'}`}
        style={{ touchAction: lockDrag ? 'pan-y' : undefined }}
      />
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
