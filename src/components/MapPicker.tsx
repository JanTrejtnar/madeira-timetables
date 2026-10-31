import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import '../lib/leafletGuard';
import { addBasemap } from '../lib/basemap';
import { useT } from '../i18n';
import { useBackToClose } from '../lib/backClose';
import { useFocusScope } from '../lib/focusScope';
import { reducedMotion } from '../lib/motion';
import { pinIcon } from '../lib/mapPin';
import { PICK_RADIUS_M, nearestNode } from '../lib/network';
import { fetchFoot } from '../lib/foot';
import type { Picked } from '../lib/plannerForm';
import type { Shared } from './common';
import { Icon } from './Icons';

/** How far from the tapped point a stop is still accepted. */

interface Props {
  shared: Shared;
  /** "From" / "To": which field is being filled */
  title: string;
  kind: 'from' | 'to';
  current: Picked;
  onPick: (v: Picked) => void;
  onClose: () => void;
}

type Found = { name: string; key: string; lat: number; lon: number; metres: number };

/** SVG of the pin hanging in the middle of the map (same shape as the planner's A / B pins). */
const pinHtml = (kind: 'from' | 'to') => (pinIcon(kind).options.html as string) ?? '';

/**
 * Full-screen map with a pin hanging in the middle: the traveller moves the map under it (more exact than a finger on a small
 * screen), the nearest stop within 1 km is shown below and "Select this point" fills it into the planner field.
 */
export function MapPicker({ shared, title, kind, current, onPick, onClose }: Props) {
  const { t } = useT();
  useBackToClose(true, onClose);
  const el = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useFocusScope(dialog, true);
  const [res, setRes] = useState<Found | 'none' | null>(null);
  const centre = useRef<{ lat: number; lon: number } | null>(null);
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
    const map = L.map(container, { zoomControl: true, zoomAnimation: !reducedMotion() });
    addBasemap(map);
    const layer = L.layerGroup().addTo(map);
    // start on the pin already set, else the stop in the field, else the user's position, else the island
    const startNode = current.key ? net.nodes.find((n) => n.key === current.key && n.lat !== undefined) : undefined;
    if (current.pt) map.setView([current.pt.lat, current.pt.lon], 16);
    else if (startNode?.lat !== undefined && startNode.lon !== undefined) map.setView([startNode.lat, startNode.lon], 16);
    else if (userPos) map.setView([userPos.lat, userPos.lon], 15);
    else map.setView([32.75, -16.95], 10);

    let token = 0;
    let footTimer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const c = map.getCenter();
      const mine = ++token;
      clearTimeout(footTimer);
      centre.current = { lat: c.lat, lon: c.lng };
      layer.clearLayers();
      const hit = nearestNode(net, c.lat, c.lng, PICK_RADIUS_M);
      if (!hit || hit.node.lat === undefined || hit.node.lon === undefined) return setRes('none');
      const { lat, lon, name, key } = hit.node;
      const straight = L.polyline([[c.lat, c.lng], [lat, lon]], { color: '#dc2626', weight: 2.5, opacity: 0.8, dashArray: '4 6', interactive: false }).addTo(layer);
      // once the map rests, the walk along the streets replaces the straight line (and the distance becomes the real one)
      footTimer = setTimeout(() => {
        void fetchFoot({ lat: c.lat, lon: c.lng }, { lat, lon }).then((r) => {
          if (!r || mine !== token) return;
          straight.remove();
          L.polyline(r.pts, { color: '#dc2626', weight: 3.5, opacity: 0.9, dashArray: '1 7', lineCap: 'round', interactive: false }).addTo(layer);
          setRes((cur) => (cur && cur !== 'none' && cur.key === key ? { ...cur, metres: r.m } : cur));
        });
      }, 350);
      L.circleMarker([lat, lon], { radius: 9, color: '#0f172a', weight: 3, fillColor: '#0ea5e9', fillOpacity: 1 }).bindTooltip(name, { permanent: true, direction: 'top', offset: [0, -8] }).addTo(layer);
      setRes({ name, key, lat, lon, metres: Math.round(hit.metres) });
    };
    let raf = 0;
    const onMove = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    map.on('move', onMove);
    map.on('click', (e: L.LeafletMouseEvent) => map.panTo(e.latlng, { animate: !reducedMotion() }));
    update();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);
    const late = setTimeout(() => map.invalidateSize(), 200);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(footTimer);
      token++;
      clearTimeout(late);
      ro.disconnect();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net]);

  const confirm = () => {
    if (!res || res === 'none' || !centre.current) return;
    pickRef.current({ text: res.name, key: res.key, pt: { lat: +centre.current.lat.toFixed(5), lon: +centre.current.lon.toFixed(5) } });
    onClose();
  };

  return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={`${t('pickOnMap')}: ${title}`} className="fixed inset-0 z-1000 flex flex-col bg-white pt-safe dark:bg-slate-900" data-testid="map-picker">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200/70 px-3 py-2 dark:border-slate-700">
        <Icon name="map" className="size-5 text-sky-600" />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          {t('pickOnMap')} · {title}
        </h2>
        <button onClick={onClose} className="h-10 rounded-xl px-4 text-sm font-semibold text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800">
          {t('pickDone')}
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={el} className="isolate absolute inset-0 bg-slate-200 dark:bg-slate-800" data-testid="map-picker-map" />
        {/* the pin's tip is the exact centre of the map; a dot marks the spot under it */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10" data-testid="map-picker-crosshair" aria-hidden="true">
          <span className="absolute -left-1 -top-1 size-2 rounded-full bg-slate-900/70 ring-2 ring-white/80" />
          <span className="absolute -left-3.5 -top-9.5 drop-shadow-md" dangerouslySetInnerHTML={{ __html: pinHtml(kind) }} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
          <button
            type="button"
            onClick={confirm}
            disabled={!res || res === 'none'}
            data-testid="map-picker-confirm"
            className="pointer-events-auto h-12 rounded-full bg-sky-600 px-6 text-base font-semibold text-white shadow-lg active:bg-sky-700 disabled:bg-slate-400 disabled:opacity-90"
          >
            {t('pickConfirm')}
          </button>
        </div>
      </div>
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
