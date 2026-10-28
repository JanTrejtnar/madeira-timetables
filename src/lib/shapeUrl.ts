/**
 * The URL (and so the cache key) of a route file. Its own module without imports: the offline pack (offlineMaps.ts) stores routes under the same
 * keys a normal fetch uses, and must not pull the dataset code into its chunk.
 */
export const shapeFileUrl = (shapeId: number, rev: string) => `${import.meta.env.BASE_URL}data/shapes/${shapeId}.json?v=${rev}`;
