import { describe, expect, it } from 'vitest';
import { route, type PinPos } from '../geometry';

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const OFFSETS: [number, number][] = [[200, 0], [-200, 0], [0, 200], [0, -200], [200, 100], [-200, -100], [20, 20], [0, 0], [-40, 20]];

describe('route', () => {
  for (const [adx, ady] of DIRS) for (const [bdx, bdy] of DIRS) for (const [ox, oy] of OFFSETS) for (const lane of [0, 1, 2]) {
    it(`a(${adx},${ady}) -> b(${bdx},${bdy}) @ (${ox},${oy}) lane ${lane}`, () => {
      const a: PinPos = { x: 100, y: 100, dx: adx, dy: ady };
      const b: PinPos = { x: 100 + ox, y: 100 + oy, dx: bdx, dy: bdy };
      const pts = route(a, b, lane);
      expect(pts[0]).toEqual([a.x, a.y]);
      expect(pts[pts.length - 1]).toEqual([b.x, b.y]);
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        expect(x0 === x1 || y0 === y1, 'segment is axis-aligned').toBe(true);
      }
      // leaves the source pin in its own direction, and arrives against the target pin's direction
      expect(Math.sign(pts[1][0] - pts[0][0])).toBe(adx);
      expect(Math.sign(pts[1][1] - pts[0][1])).toBe(ady);
      const n = pts.length;
      expect(Math.sign(pts[n - 2][0] - pts[n - 1][0])).toBe(bdx);
      expect(Math.sign(pts[n - 2][1] - pts[n - 1][1])).toBe(bdy);
    });
  }
});
