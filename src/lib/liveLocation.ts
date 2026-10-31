// Live position on a Leaflet map: watchPosition feeds a pulsing dot with an accuracy circle. The watch starts by itself when the map appears
// (quietly: the view stays where it is, a refusal shows nothing); the locate button then makes the map follow the dot until the reader drags
// it away, and shows why the position is missing. The watch is cleared when the component using it unmounts.
import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { reducedMotion } from './motion';

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
  /** the watch was started by the map itself, not by the button: its failure is not reported */
  const quiet = useRef(false);
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
    if (jump) m.flyTo([f.lat, f.lon], Math.max(m.getZoom(), 15), { duration: 0.6, animate: !reducedMotion() });
    else m.panTo([f.lat, f.lon], { animate: !reducedMotion() });
  }, []);

  const locate = useCallback((auto = false) => {
    if (!('geolocation' in navigator)) return auto ? undefined : setStatus('unsupported');
    if (!auto) {
      quiet.current = false;
      setFollow(true);
    }
    if (watchId.current !== null) {
      if (!auto && last.current) center(last.current, true);
      return;
    }
    quiet.current = auto;
    if (!auto) setStatus('busy');
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
        // a quiet watch that has no fix yet keeps waiting for one (only a refused permission ends it)
        if (quiet.current && e.code !== 1) return;
        if (e.code === 1 || !last.current) {
          stop();
          setFollow(false);
          // a quiet start that failed: the button tries again and says what is wrong
          setStatus(quiet.current ? 'idle' : e.code === 1 ? 'denied' : 'error');
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
    locate(true);
    const off = () => setFollow(false);
    map.on('dragstart', off);
    return () => {
      map.off('dragstart', off);
    };
  }, [map, setFollow, locate]);

  const has = fix !== null;
  useEffect(() => {
    if (!map || !last.current) return;
    const f = last.current;
    const marker = L.marker([f.lat, f.lon], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 1000, keyboard: false }).bindTooltip(label);
    // an SVG overlay lets the taps through; on the map's own canvas (preferCanvas) the ring lay over the stops and lines of the network map and swallowed them
    const ring = L.circle([f.lat, f.lon], { renderer: L.svg(), radius: Math.min(f.acc, 500), color: '#2563eb', weight: 1, fillOpacity: 0.08, interactive: false });
    let added = false;
    // the dot is a nicety: a map that is not ready yet (no panes / view) or already gone must never take the page down with it (Error Boundary)
    const add = () => {
      if (added || !live(map)) return;
      try {
        if (!map.getPane('markerPane') || !map.getPane('overlayPane')) return;
        marker.addTo(map);
        ring.addTo(map);
        dot.current = { marker, ring };
        added = true;
      } catch {
        marker.remove();
        ring.remove();
      }
    };
    try {
      map.whenReady(add);
    } catch {
      /* the map is gone */
    }
    return () => {
      added = true; // a late whenReady must not add it any more
      try {
        marker.remove();
        ring.remove();
      } catch {
        /* the map is gone */
      }
      dot.current = null;
    };
  }, [map, has, label]);
  useEffect(() => {
    if (!fix || !dot.current) return;
    try {
      dot.current.marker.setLatLng([fix.lat, fix.lon]);
      dot.current.ring.setLatLng([fix.lat, fix.lon]).setRadius(Math.min(fix.acc, 500));
    } catch {
      /* the map is gone */
    }
  }, [fix]);

  return { status, fix, following, locate: () => locate() };
}
