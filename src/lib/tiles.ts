import L from 'leaflet';

/** OpenStreetMap standard tiles (no API key), shown as they are in the light theme and inverted by CSS in the dark theme (`.dark .osm-tiles`, only this layer). */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function osmTiles(): L.TileLayer {
  return L.tileLayer(TILE_URL, {
    maxZoom: 19,
    updateWhenZooming: false,
    className: 'osm-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
}
