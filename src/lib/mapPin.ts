import L from 'leaflet';
import type { MapPin } from '../types';

/** Red map pin with the letter of the field it belongs to (A = from, B = to). */
export function pinIcon(kind: MapPin['kind']): L.DivIcon {
  const svg = `<svg width="28" height="38" viewBox="0 0 28 38" aria-hidden="true"><path d="M14 37C14 37 2 23 2 14a12 12 0 0 1 24 0c0 9-12 23-12 23z" fill="#dc2626" stroke="#fff" stroke-width="2"/><text x="14" y="19" text-anchor="middle" font-size="12" font-weight="700" font-family="system-ui,sans-serif" fill="#fff">${kind === 'from' ? 'A' : 'B'}</text></svg>`;
  return L.divIcon({ className: 'picked-pin', html: svg, iconSize: [28, 38], iconAnchor: [14, 37], tooltipAnchor: [12, -24] });
}

/** Adds the pin and, when it has a stop, the thin dashed line to it. */
export function drawPin(into: L.LayerGroup, pin: MapPin, label: string): void {
  if (pin.stop) L.polyline([[pin.lat, pin.lon], [pin.stop.lat, pin.stop.lon]], { color: '#dc2626', weight: 2.5, opacity: 0.8, dashArray: '4 6', interactive: false }).addTo(into);
  L.marker([pin.lat, pin.lon], { icon: pinIcon(pin.kind), zIndexOffset: 900, keyboard: false }).bindTooltip(label).addTo(into);
}
