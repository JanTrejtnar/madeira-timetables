// A canvas layer removed after its map (React cleanups run one after another) makes Leaflet schedule a redraw of a renderer that has no context any more:
// "Cannot read properties of undefined (reading 'save')". The redraw of a removed renderer is a no-op.
import L from 'leaflet';

type Redraw = { _ctx?: unknown; _redrawRequest?: number | null; _redraw(): void };
const proto = L.Canvas.prototype as unknown as Redraw;
const redraw = proto._redraw;
proto._redraw = function (this: Redraw) {
  if (!this._ctx) {
    this._redrawRequest = null;
    return;
  }
  redraw.call(this);
};
