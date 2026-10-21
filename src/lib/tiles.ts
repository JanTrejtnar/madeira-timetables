import L from 'leaflet';

/** OpenStreetMap standard tiles (no API key), darkened in CSS (`.dark-tiles`): lines and stops in bright colours stand out on it. */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function darkTiles(): L.TileLayer {
  return L.tileLayer(TILE_URL, {
    maxZoom: 19,
    updateWhenZooming: false,
    className: 'dark-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
}
