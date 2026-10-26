// Live position on a Leaflet map: watchPosition feeds a pulsing dot with an accuracy circle. The map follows the dot until the reader drags it away;
// the locate button switches following back on. The watch is cleared when the component using it unmounts.
import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';

export type LocStatus = 'idle' | 'busy' | 'on' | 'denied' | 'error' | 'unsupported';

export interface Fix {
  lat: number;
  lon: number;
  acc: number;
}

/** A map that was not removed and is still in the document: Leaflet throws (_leaflet_pos) on a removed map or a detached pane. */
export const live = (map: L.Map) => !!(map as unknown as { _mapPane?: unknown })._mapPane && map.getContainer().isConnected;

export function useLiveLocation(map: L.Map | null, label: string) {
  const [status, setStatus] = useState<LocStatus>('idle');
  const [fix, setFix] = useState<Fix | null>(null);
  const [following, setFollowing] = useState(false);
  const followRef = useRef(false);
  const watchId = useRef<number | null>(null);
  const last = useRef<Fix | null>(null);
  const mapRef = useRef(map);
  mapRef.current = map;
  const dot = useRef<{ marker: L.Marker; ring: L.Circle } | null>(null);

  const setFollow = useCallback((v: boolean) => {
    followRef.current = v;
    setFollowing(v);
  }, []);
  const stop = useCallback(() => {
    if (watchId.current !== null && 'geolocation' in navigator) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const center = useCallback((f: Fix, jump: boolean) => {
    const m = mapRef.current;
    if (!m || !live(m)) return;
    if (jump) m.flyTo([f.lat, f.lon], Math.max(m.getZoom(), 15), { duration: 0.6 });
    else m.panTo([f.lat, f.lon], { animate: true });
  }, []);

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) return setStatus('unsupported');
    setFollow(true);
    if (watchId.current !== null) {
      if (last.current) center(last.current, true);
      return;
    }
    setStatus('busy');
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const f = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
        const first = last.current === null;
        last.current = f;
        setFix(f);
        setStatus('on');
        if (followRef.current) center(f, first);
      },
      (e) => {
        if (e.code === 1 || !last.current) {
          stop();
          setFollow(false);
          setStatus(e.code === 1 ? 'denied' : 'error');
        }
        // a timeout or a lost signal while a position is known: keep the last dot and wait for the next fix
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  }, [center, setFollow, stop]);

  // a new map instance (the route changed): the old view is gone, so following stops; the dot is drawn again
  useEffect(() => {
    if (!map) return;
    setFollow(false);
    const off = () => setFollow(false);
    map.on('dragstart', off);
    return () => {
      map.off('dragstart', off);
    };
  }, [map, setFollow]);

  const has = fix !== null;
  useEffect(() => {
    if (!map || !last.current) return;
    const f = last.current;
    const marker = L.marker([f.lat, f.lon], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 1000, keyboard: false }).bindTooltip(label).addTo(map);
    const ring = L.circle([f.lat, f.lon], { radius: Math.min(f.acc, 500), color: '#2563eb', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
    dot.current = { marker, ring };
    return () => {
      marker.remove();
      ring.remove();
      dot.current = null;
    };
  }, [map, has, label]);
  useEffect(() => {
    if (!fix || !dot.current) return;
    dot.current.marker.setLatLng([fix.lat, fix.lon]);
    dot.current.ring.setLatLng([fix.lat, fix.lon]).setRadius(Math.min(fix.acc, 500));
  }, [fix]);

  return { status, fix, following, locate };
}
