import L from 'leaflet';

/** Dark, minimal base map (CartoDB Dark Matter): lines and stops in bright colours stand out on it. */
export const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

export function darkTiles(): L.TileLayer {
  return L.tileLayer(TILE_URL, {
    maxZoom: 19,
    updateWhenZooming: false,
    subdomains: 'abcd',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  });
}
