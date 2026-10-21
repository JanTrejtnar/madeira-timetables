import L from 'leaflet';
import type { MapPin } from '../types';

/** Red map pin with the letter of the field it belongs to (A = from, B = to). */
export function pinIcon(kind: MapPin['kind']): L.DivIcon {
  const svg = `<svg width="28" height="38" viewBox="0 0 28 38" aria-hidden="true"><path d="M14 37C14 37 2 23 2 14a12 12 0 0 1 24 0c0 9-12 23-12 23z" fill="#dc2626" stroke="#fff" stroke-width="2"/><text x="14" y="19" text-anchor="middle" font-size="12" font-weight="700" font-family="system-ui,sans-serif" fill="#fff">${kind === 'from' ? 'A' : 'B'}</text></svg>`;
  return L.divIcon({ className: 'picked-pin', html: svg, iconSize: [28, 38], iconAnchor: [14, 37], tooltipAnchor: [12, -24] });
}

const walkerIcon = L.divIcon({ className: 'walk-pin', html: '<span aria-hidden="true">🚶</span>', iconSize: [26, 26], iconAnchor: [13, 13] });
const metresBetween = (a: [number, number], b: [number, number]) => Math.hypot((a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180), (a[0] - b[0]) * 110540);

/**
 * Adds the pin (always: A / B stand for start and destination even when the stop is right there) and, when the stop is another place, the
 * walk to it: along the streets once the route is known, else a thin straight dashed line, with a walker in the middle.
 */
export function drawPin(into: L.LayerGroup, pin: MapPin, label: string, walkLabel = ''): void {
  const walk = (pin.path ?? (pin.stop ? [[pin.lat, pin.lon], [pin.stop.lat, pin.stop.lon]] : null)) as [number, number][] | null;
  if (walk && walk.length > 1 && metresBetween(walk[0], walk[walk.length - 1]) > 8) {
    L.polyline(walk, { color: '#0f172a', weight: 6, opacity: 0.45, lineCap: 'round', interactive: false }).addTo(into);
    L.polyline(walk, { color: '#fb7185', weight: 3.5, opacity: 1, dashArray: pin.path ? '1 7' : '5 7', lineCap: 'round', interactive: false }).addTo(into);
    L.marker(walk[Math.floor(walk.length / 2)], { icon: walkerIcon, zIndexOffset: 850, keyboard: false, interactive: false }).addTo(into).bindTooltip(walkLabel, { permanent: false });
  }
  L.marker([pin.lat, pin.lon], { icon: pinIcon(pin.kind), zIndexOffset: 900, keyboard: false }).bindTooltip(pin.label ?? label).addTo(into);
}
