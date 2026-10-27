import type L from 'leaflet';
import { offlineMapInstalled } from './offlineMaps';
import { osmTiles } from './tiles';

/**
 * The base layer of every map: the offline pack (vector tiles from Cache Storage) when one is installed on this device, else the online
 * OpenStreetMap tiles. If the pack cannot be read after all, the online tiles take over.
 */
export function addBasemap(map: L.Map): void {
  if (!offlineMapInstalled()) {
    osmTiles().addTo(map);
    return;
  }
  void import('./vectorBasemap').then(({ addVectorBasemap }) => addVectorBasemap(map)).catch((e) => {
    console.warn('Offline map unusable, using the online tiles:', e);
    osmTiles().addTo(map);
  });
}
