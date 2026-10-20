import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { useT } from '../i18n';
import { drawPin } from '../lib/mapPin';
import { nearestNode } from '../lib/network';
import type { Picked } from '../lib/plannerForm';
import type { Shared } from './common';
import { Icon } from './Icons';

/** How far from the tapped point a stop is still accepted. */
export const PICK_RADIUS_M = 1000;

interface Props {
  shared: Shared;
  /** "From" / "To": which field is being filled */
  title: string;
  kind: 'from' | 'to';
  current: Picked;
  onPick: (v: Picked) => void;
  onClose: () => void;
}

/** Full-screen map: tap anywhere and the nearest stop (within 1 km) is filled into the planner field. */
export function MapPicker({ shared, title, kind, current, onPick, onClose }: Props) {
  const { t } = useT();
  const el = useRef<HTMLDivElement>(null);
  const [res, setRes] = useState<{ name: string; metres: number } | 'none' | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const { net, userPos } = shared;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const container = el.current;
    if (!container) return;
    const map = L.map(container, { zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    const label = t('pickedPoint');
    const show = (lat: number, lon: number, stop: { lat: number; lon: number; name: string } | null) => {
      layer.clearLayers();
      drawPin(layer, { kind, lat, lon, stop: stop ?? undefined }, label);
      if (stop) L.circleMarker([stop.lat, stop.lon], { radius: 9, color: '#0284c7', weight: 3, fillColor: '#0ea5e9', fillOpacity: 1 }).bindTooltip(stop.name, { permanent: true, direction: 'top', offset: [0, -8] }).addTo(layer);
    };
    // start on the pin already set, else the stop in the field, else the user's position, else the island
    const startNode = current.key ? net.nodes.find((n) => n.key === current.key && n.lat !== undefined) : undefined;
    if (current.pt) {
      const hit = nearestNode(net, current.pt.lat, current.pt.lon, PICK_RADIUS_M);
      map.setView([current.pt.lat, current.pt.lon], 16);
      show(current.pt.lat, current.pt.lon, hit && hit.node.lat !== undefined && hit.node.lon !== undefined ? { lat: hit.node.lat, lon: hit.node.lon, name: hit.node.name } : null);
    } else if (startNode?.lat !== undefined && startNode.lon !== undefined) {
      map.setView([startNode.lat, startNode.lon], 15);
      layer.clearLayers();
      L.circleMarker([startNode.lat, startNode.lon], { radius: 9, color: '#0284c7', weight: 3, fillColor: '#0ea5e9', fillOpacity: 1 }).bindTooltip(startNode.name, { permanent: true, direction: 'top', offset: [0, -8] }).addTo(layer);
    } else if (userPos) map.setView([userPos.lat, userPos.lon], 14);
    else map.setView([32.75, -16.95], 10);

    map.on('click', (e: L.LeafletMouseEvent) => {
      const hit = nearestNode(net, e.latlng.lat, e.latlng.lng, PICK_RADIUS_M);
      if (!hit || hit.node.lat === undefined || hit.node.lon === undefined) {
        show(e.latlng.lat, e.latlng.lng, null);
        setRes('none');
        return;
      }
      show(e.latlng.lat, e.latlng.lng, { lat: hit.node.lat, lon: hit.node.lon, name: hit.node.name });
      setRes({ name: hit.node.name, metres: Math.round(hit.metres) });
      pickRef.current({ text: hit.node.name, key: hit.node.key, pt: { lat: +e.latlng.lat.toFixed(5), lon: +e.latlng.lng.toFixed(5) } });
    });
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);
    const late = setTimeout(() => map.invalidateSize(), 200);
    return () => {
      clearTimeout(late);
      ro.disconnect();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`${t('pickOnMap')}: ${title}`} className="fixed inset-0 z-1000 flex flex-col bg-white pt-safe dark:bg-slate-900" data-testid="map-picker">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200/70 px-3 py-2 dark:border-slate-700">
        <Icon name="map" className="size-5 text-sky-600" />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          {t('pickOnMap')} · {title}
        </h2>
        <button onClick={onClose} className="h-10 rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white active:bg-sky-700">
          {t('pickDone')}
        </button>
      </div>
      <div ref={el} className="isolate min-h-0 flex-1 bg-slate-200 dark:bg-slate-800" data-testid="map-picker-map" />
      <p className="shrink-0 border-t border-slate-200/70 px-4 py-3 pb-safe text-sm dark:border-slate-700" data-testid="map-picker-result" aria-live="polite">
        {res === null ? (
          <span className="text-slate-500 dark:text-slate-400">{t('pickHint')}</span>
        ) : res === 'none' ? (
          <span className="text-amber-700 dark:text-amber-300">{t('pickNone', { m: PICK_RADIUS_M })}</span>
        ) : (
          <span>
            <b className="font-semibold">{res.name}</b> <span className="text-slate-500 dark:text-slate-400">· {t('pickNear', { m: res.metres })}</span>
          </span>
        )}
      </p>
    </div>
  );
}
