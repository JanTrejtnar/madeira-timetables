import { describe, expect, it } from 'vitest';
import { onRequestPlaces, viaAt, withVia } from '../src/lib/via';
import type { Direction, Line, ViaPlace } from '../src/types';

const stop = (name: string, lon: number) => ({ code: null, name, lat: 32.8, lon });
const place = (name: string, lon: number, at: number): ViaPlace => ({ name, lat: 32.8, lon, source: 'manual', after: { 0: 0 }, at: { 0: at } });
const dir = { stops: [stop('A', -16.9), stop('B', -16.8)] } as unknown as Direction;
// the note names the places against the direction of travel (X is further along the road than Y)
const mk = (x: ViaPlace, y: ViaPlace) => ({ via: { n: [x, y] } }) as unknown as Line;

describe('Via places of one stretch are ordered along the route, not by the words of the note', () => {
  it('reversed note text is put into physical order', () => {
    const line = mk(place('X', -16.84, 80), place('Y', -16.88, 20));
    expect([...viaAt(line, 0, dir, ['n']).get(0)!].map((c) => c.place.name)).toEqual(['Y', 'X']);
    const r = withVia(line, 0, dir, ['n'], ['10:00', '10:30']);
    expect(r.stops.map((s) => s.name)).toEqual(['A', 'Y', 'X', 'B']);
    expect(r.viaTimes[1]! < r.viaTimes[2]!).toBe(true);
  });
  it('the other direction (reversed polyline positions) reverses the order', () => {
    const x = place('X', -16.84, 20);
    const y = place('Y', -16.88, 80);
    expect([...viaAt(mk(x, y), 0, dir, ['n']).get(0)!].map((c) => c.place.name)).toEqual(['X', 'Y']);
  });
  it('without polyline positions the printed order is kept', () => {
    const x = { ...place('X', -16.84, 0), at: undefined };
    const y = { ...place('Y', -16.88, 0), at: undefined };
    expect([...viaAt(mk(x, y), 0, dir, ['n']).get(0)!].map((c) => c.place.name)).toEqual(['X', 'Y']);
  });
});

describe('"Serviço a pedido" notes', () => {
  it('names the places of an on-request detour', () => {
    expect(onRequestPlaces('*Serviço a pedido: St. António e Ilha')).toEqual(['St. António', 'Ilha']);
    expect(onRequestPlaces('*Serviço a pedido: Ilha, A. Marques, Silveira, St. António e S. Roque do Faial')).toHaveLength(5);
    expect(onRequestPlaces('*Serviço a pedido: S. Roque do Faial')).toEqual(['S. Roque do Faial']);
  });
  it('ignores booking instructions and other notes', () => {
    expect(onRequestPlaces('*Serviço a pedido: Os clientes deverão efectuar a marcação através do número 291 201 150.')).toBeNull();
    expect(onRequestPlaces('Via Ilha e St. António')).toBeNull();
  });
});
