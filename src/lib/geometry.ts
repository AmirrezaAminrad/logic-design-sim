import type { Comp, ICDef, Pin } from './types';
import { TYPES, pinsOf } from './defs';

export const G = 20;
export const snap = (v: number) => Math.round(v / G) * G;
const even = (n: number) => (n % 2 === 0 ? n : n + 1);

export interface Pt { x: number; y: number }
export interface Layout { W: number; H: number; ins: Pt[]; outs: Pt[]; inP: Pin[]; outP: Pin[]; title: string }
export interface PinPos { x: number; y: number; dx: number; dy: number }

const spacing = (n: number) => (n <= 2 ? 2 : 1);
const need = (n: number) => (n === 0 ? 0 : (n - 1) * spacing(n) + 2);

export function titleOf(c: Comp, defs: Record<string, ICDef>): string {
  if (c.type === 'ic') return defs[c.props.def]?.name ?? 'IC';
  const t = TYPES[c.type];
  if (!t) return c.type;
  return t.title ? t.title(c.props) : t.label;
}

export function layoutOf(c: Comp, defs: Record<string, ICDef>): Layout {
  const { ins, outs } = pinsOf(c, defs);
  const t = TYPES[c.type];
  const title = titleOf(c, defs);
  const H = even(Math.max(t?.minH ?? 4, need(ins.length), need(outs.length)));
  let Wu: number;
  if (t?.w) Wu = t.w;
  else {
    const li = Math.max(0, ...ins.map((p) => p.name.length));
    const lo = Math.max(0, ...outs.map((p) => p.name.length));
    Wu = even(Math.max(6, Math.ceil((Math.max(title.length * 8, 40) + (li + lo) * 6 + 24) / G)));
  }
  const place = (n: number): Pt[] => {
    const sp = spacing(n);
    const span = (n - 1) * sp;
    const off = Math.floor((H - span) / 2);
    return Array.from({ length: n }, (_, i) => ({ y: (off + i * sp) * G, x: 0 }));
  };
  const W = Wu * G;
  return {
    W, H: H * G,
    ins: place(ins.length).map((p) => ({ x: 0, y: p.y })),
    outs: place(outs.length).map((p) => ({ x: W, y: p.y })),
    inP: ins, outP: outs, title,
  };
}

const rotv = (x: number, y: number, r: number): [number, number] => {
  switch (((r % 4) + 4) % 4) {
    case 1: return [-y, x];
    case 2: return [-x, -y];
    case 3: return [y, -x];
    default: return [x, y];
  }
};

export function pinWorld(c: Comp, lay: Layout, kind: 'in' | 'out', idx: number): PinPos {
  const p = (kind === 'in' ? lay.ins : lay.outs)[idx] ?? { x: 0, y: 0 };
  const cx = lay.W / 2, cy = lay.H / 2;
  const [rx, ry] = rotv(p.x - cx, p.y - cy, c.rot);
  const [dx, dy] = rotv(kind === 'in' ? -1 : 1, 0, c.rot);
  return { x: c.x + cx + rx, y: c.y + cy + ry, dx, dy };
}

export function bbox(c: Comp, lay: Layout) {
  const odd = c.rot % 2 !== 0;
  const hw = (odd ? lay.H : lay.W) / 2, hh = (odd ? lay.W : lay.H) / 2;
  const cx = c.x + lay.W / 2, cy = c.y + lay.H / 2;
  return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
}

type P2 = [number, number];
const flip = (pts: P2[]): P2[] => pts.map(([x, y]) => [y, x]);

/** both pins horizontal: the vertical channel must lie ahead of both stubs, else U-turn over/under them */
function midHH(p1: P2, q1: P2, sa: number, sb: number, lane: number): P2[] {
  let lo = -Infinity, hi = Infinity;
  if (sa > 0) lo = Math.max(lo, p1[0]); else hi = Math.min(hi, p1[0]);
  if (sb > 0) lo = Math.max(lo, q1[0]); else hi = Math.min(hi, q1[0]);
  if (lo <= hi) {
    const mx = Math.min(hi, Math.max(lo, snap((p1[0] + q1[0]) / 2) + (lane - 1) * 4));
    return [[mx, p1[1]], [mx, q1[1]]];
  }
  const my = Math.abs(p1[1] - q1[1]) < G ? Math.min(p1[1], q1[1]) - 2 * G : snap((p1[1] + q1[1]) / 2);
  return [[p1[0], my], [q1[0], my]];
}

/** a horizontal, b vertical: take the elbow that is ahead of both stubs, else turn at a's stub instead */
function midHV(p1: P2, q1: P2, sa: number, sb: number): P2[] {
  const ok = (q1[0] - p1[0]) * sa >= 0 && (p1[1] - q1[1]) * sb >= 0;
  return ok ? [[q1[0], p1[1]]] : [[p1[0], q1[1]]];
}

/** `lane` (0..2) nudges the shared channel so wires from different sources don't merge into one line */
export function route(a: PinPos, b: PinPos, lane = 1): [number, number][] {
  const S = 20;
  const p1: P2 = [a.x + a.dx * S, a.y + a.dy * S];
  const q1: P2 = [b.x + b.dx * S, b.y + b.dy * S];
  const ah = a.dx !== 0, bh = b.dx !== 0;
  const pts: P2[] = [[a.x, a.y], p1];
  const fp1 = flip([p1])[0], fq1 = flip([q1])[0];
  if (ah && bh) pts.push(...midHH(p1, q1, a.dx, b.dx, lane));
  else if (!ah && !bh) pts.push(...flip(midHH(fp1, fq1, a.dy, b.dy, lane)));
  else if (ah) pts.push(...midHV(p1, q1, a.dx, b.dy));
  else pts.push(...flip(midHV(fp1, fq1, a.dy, b.dx)));
  pts.push(q1, [b.x, b.y]);
  const out: [number, number][] = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p);
  }
  return out;
}

export const pathD = (pts: [number, number][]) => pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');

export function midPoint(pts: [number, number][], minLen = 0): Pt {
  if (pts.length < 2) return { x: pts[0]?.[0] ?? 0, y: pts[0]?.[1] ?? 0 };
  const segLen = (i: number) => Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
  let best = -1, bi = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = segLen(i);
    if (l > best && (minLen === 0 || l >= minLen)) { best = l; bi = i; }
  }
  if (best < 0) {
    for (let i = 0; i < pts.length - 1; i++) {
      const l = segLen(i);
      if (l > best) { best = l; bi = i; }
    }
  }
  const ax = pts[bi][0], ay = pts[bi][1], bx = pts[bi + 1][0], by = pts[bi + 1][1];
  let mx = (ax + bx) / 2, my = (ay + by) / 2;
  // slide the label away from segment endpoints so pin/junction dots never cover it
  const ux = Math.sign(bx - ax), uy = Math.sign(by - ay);
  const distA = Math.abs(mx - ax) + Math.abs(my - ay);
  const distB = Math.abs(bx - mx) + Math.abs(by - my);
  const clear = 15;
  if (distA < clear && distA <= distB) {
    const push = Math.min(clear - distA, Math.max(0, distB - 2));
    mx += ux * push; my += uy * push;
  } else if (distB < clear) {
    const push = Math.min(clear - distB, Math.max(0, distA - 2));
    mx -= ux * push; my -= uy * push;
  }
  return { x: mx, y: my };
}
