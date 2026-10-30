import L from 'leaflet';

/** Radius (px) of the area that reacts to a tap on a stop: ~40 px across, the size of a finger. */
export const STOP_HIT_RADIUS = 20;

// A circle marker whose hit test on the canvas is at least STOP_HIT_RADIUS wide, however small the dot is drawn.
// (A canvas renderer's `tolerance` would widen the lines that share the canvas too.)
const TapCircleMarker = L.CircleMarker.extend({
  _containsPoint(this: { _point: L.Point; _radius: number; _clickTolerance(): number }, p: L.Point): boolean {
    return p.distanceTo(this._point) <= Math.max(this._radius + this._clickTolerance(), STOP_HIT_RADIUS);
  },
});

/** `L.circleMarker` with the enlarged tap area. */
export const tapMarker = (latlng: L.LatLngExpression, options?: L.CircleMarkerOptions): L.CircleMarker => new (TapCircleMarker as unknown as new (l: L.LatLngExpression, o?: L.CircleMarkerOptions) => L.CircleMarker)(latlng, options);
