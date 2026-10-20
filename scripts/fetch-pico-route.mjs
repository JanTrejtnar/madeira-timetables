// One-off helper: road geometry for the Pico do Areeiro shuttle via the public OSRM demo server (OpenStreetMap data).
// The result is committed as data/shapes/9001.json so build:data needs no network. Waypoints are the stops with OSM coordinates.
import { readFileSync, writeFileSync } from 'node:fs';
// the first waypoint is the official position of the Teleférico-Término stop (GTFS code 4A), so the drawn line leaves the pin
const gtfs = JSON.parse(readFileSync(new URL('../data/gtfs/stops.json', import.meta.url), 'utf8'));
const start = gtfs.stops.find((x) => x.code === '4A');
if (!start) throw new Error('GTFS stop 4A not found; run npm run fetch:gtfs');
const W = [[start.lat, start.lon], [32.6539, -16.9119], [32.6767, -16.9029], [32.6855, -16.9010], [32.7127, -16.8878], [32.7357, -16.9287]];
const url = `https://router.project-osrm.org/route/v1/driving/${W.map(([a, b]) => `${b},${a}`).join(';')}?overview=full&geometries=geojson`;
const j = await (await fetch(url)).json();
if (j.code !== 'Ok') throw new Error(JSON.stringify(j).slice(0, 200));
const poly = j.routes[0].geometry.coordinates.map(([lon, lat]) => [+lat.toFixed(5), +lon.toFixed(5)]);
// OSRM snaps the waypoint to the road (some metres away): start the line exactly on the stop
poly.unshift([+start.lat.toFixed(6), +start.lon.toFixed(6)]);
writeFileSync(new URL('../data/shapes/9001.json', import.meta.url), JSON.stringify(poly));
console.log(poly.length, 'points', (j.routes[0].distance / 1000).toFixed(1), 'km');
// the way down uses the same road reversed (9002)
writeFileSync(new URL('../data/shapes/9002.json', import.meta.url), JSON.stringify([...poly].reverse()));
