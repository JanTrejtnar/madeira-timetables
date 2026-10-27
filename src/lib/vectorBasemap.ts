// The vector basemap drawn from the offline pack (protomaps-leaflet renders the tiles of the PMTiles archive on canvases inside Leaflet).
// Loaded on demand by basemap.ts, only when a pack is installed, so neither this library nor pmtiles is part of the first screen.
import type L from 'leaflet';
import { leafletLayer } from 'protomaps-leaflet';
import { PMTiles } from 'pmtiles';
import { installedSource } from './offlineMaps';
import { live } from './liveLocation';

const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &middot; <a href="https://protomaps.com">Protomaps</a>';
const isDark = () => document.documentElement.classList.contains('dark');

/** Adds the offline basemap (light or dark flavour, following the app's theme) to `map`; rejects when the pack is missing or unreadable. */
export async function addVectorBasemap(map: L.Map): Promise<void> {
  const archive = new PMTiles(await installedSource());
  const header = await archive.getHeader(); // a damaged archive fails here, before anything is drawn
  if (!live(map)) return; // the map was closed while the pack was being opened
  const make = (dark: boolean) => leafletLayer({ url: archive, flavor: dark ? 'dark' : 'light', attribution: ATTRIBUTION, maxZoom: 19, maxDataZoom: header.maxZoom, updateWhenZooming: false }) as unknown as L.GridLayer; // protomaps-leaflet's own typing is a loose object type
  let dark = isDark();
  let layer = make(dark);
  layer.addTo(map);
  // the theme can change while the map is open (Settings, or the system switching to dark)
  const watch = new MutationObserver(() => {
    if (isDark() === dark || !live(map)) return;
    dark = isDark();
    map.removeLayer(layer);
    layer = make(dark);
    layer.addTo(map);
  });
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  map.on('unload', () => watch.disconnect());
}
