/** Ramer-Douglas-Peucker on [lat, lon] points; `tol` in degrees (0.0003 is about 30 m). Keeps the first and last point. */
export function simplify(pts: readonly [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let farD = t2;
    const [ay, ax] = pts[a];
    const [by, bx] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [py, px] = pts[i];
      let u = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const ex = ax + u * dx - px;
      const ey = ay + u * dy - py;
      const d = ex * ex + ey * ey;
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
