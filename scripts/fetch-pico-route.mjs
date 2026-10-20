// One-off helper: road geometry for the Pico do Areeiro shuttle via the public OSRM demo server (OpenStreetMap data).
// The result is committed as data/shapes/9001.json so build:data needs no network. Waypoints are the stops with OSM coordinates.
import { writeFileSync } from 'node:fs';
const W = [[32.6482, -16.9045], [32.6539, -16.9119], [32.6767, -16.9029], [32.6855, -16.9010], [32.7127, -16.8878], [32.7357, -16.9287]];
const url = `https://router.project-osrm.org/route/v1/driving/${W.map(([a, b]) => `${b},${a}`).join(';')}?overview=full&geometries=geojson`;
const j = await (await fetch(url)).json();
if (j.code !== 'Ok') throw new Error(JSON.stringify(j).slice(0, 200));
const poly = j.routes[0].geometry.coordinates.map(([lon, lat]) => [+lat.toFixed(5), +lon.toFixed(5)]);
writeFileSync(new URL('../data/shapes/9001.json', import.meta.url), JSON.stringify(poly));
console.log(poly.length, 'points', (j.routes[0].distance / 1000).toFixed(1), 'km');
// the way down uses the same road reversed (9002)
writeFileSync(new URL('../data/shapes/9002.json', import.meta.url), JSON.stringify([...poly].reverse()));
