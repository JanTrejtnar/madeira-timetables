// One file with every route geometry, for the offline map pack: the client downloads it in a single request and unpacks it into the route cache
// (319 separate files would be 319 requests). { "<shapeId>": ["<shapeRev>", [[lat, lon], ...]] } – the revision is the cache key of the route
// (dir.shapeRev, the content hash of public/data/shapes/<id>.json), so the unpacked entries are exactly what a normal fetch of the route would have stored.
// shapes-all.meta.json is the small file the settings page reads before the download: { rev, count, raw, bytes } (bytes = what travels, gzipped).
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/** @param {Map<number, string>} shapeRev shapeId -> revision of every route a direction uses @param {string} outDir public/data */
export async function buildShapesPack(shapeRev, outDir) {
  const all = {};
  for (const id of [...shapeRev.keys()].sort((a, b) => a - b)) {
    all[id] = [shapeRev.get(id), JSON.parse(await readFile(path.join(outDir, 'shapes', `${id}.json`), 'utf8'))];
  }
  const text = JSON.stringify(all);
  const meta = {
    rev: createHash('sha1').update(text).digest('hex').slice(0, 8),
    count: shapeRev.size,
    raw: Buffer.byteLength(text),
    bytes: gzipSync(text, { level: 9 }).length,
  };
  await writeFile(path.join(outDir, 'shapes-all.json'), text);
  await writeFile(path.join(outDir, 'shapes-all.meta.json'), JSON.stringify(meta));
  return meta;
}
