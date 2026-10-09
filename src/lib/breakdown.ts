import type { Circuit, Comp, ICDef, Wire } from './types';
import { uid } from './types';
import { TYPES, pinsOf } from './defs';
import { titleOf, layoutOf, bbox, snap, G } from './geometry';
import { minimize } from './boolean';

/**
 * Gate-level expansions of the complex built-in components, and the two operations
 * built on them:
 *
 *  - `breakDown`: the component is deleted and its internals are put out on the canvas,
 *    wired into the surrounding circuit (custom ICs are inlined the same way).
 *  - `customize`: the component is turned into an editable custom IC whose definition is
 *    the expansion, keeping its id, position, rotation and pin order.
 *
 * Expansions go one level at a time: smaller complex parts (fulladder, dff, mux,
 * decoder...) may appear as intermediate steps and can themselves be broken down further.
 */

export interface Sig { id: string; pin: string | number }

const COL_W = 200;   // horizontal pitch between layout columns
const GAP = 2 * G;   // vertical gap between stacked components

class Net {
  comps: Comp[] = [];
  wires: Wire[] = [];
  maxCol = -1;
  private colY = new Map<number, number>();

  private height(type: string, props: Record<string, any>): number {
    const fake: Comp = { id: '_m', type, x: 0, y: 0, rot: 0, name: '', props };
    return layoutOf(fake, {}).H;
  }

  add(type: string, col: number, props: Record<string, any> = {}, name = '', id = uid('b')): string {
    const base = TYPES[type] ? JSON.parse(JSON.stringify(TYPES[type].defaults)) : {};
    const p = { ...base, ...props };
    const y = this.colY.get(col) ?? 0;
    this.colY.set(col, y + Math.max(this.height(type, p), 2 * G) + GAP);
    if (col >= 0) this.maxCol = Math.max(this.maxCol, col);
    this.comps.push({ id, type, x: col * COL_W, y, rot: 0, name, props: p });
    return id;
  }

  /** Resolves a pin name against the component's ins/outs; numeric indices pass through. */
  private pinIdx(s: Sig, kind: 'ins' | 'outs'): number {
    if (typeof s.pin === 'number') return s.pin;
    const c = this.comps.find((x) => x.id === s.id);
    if (!c) throw new Error(`breakdown: wire references unknown component ${s.id}`);
    const pins = pinsOf(c, {})[kind];
    const i = pins.findIndex((p) => p.name === s.pin);
    if (i < 0) throw new Error(`breakdown: no ${kind} pin "${s.pin}" on ${c.type}`);
    return i;
  }

  wire(from: Sig, to: Sig) {
    this.wires.push({ id: uid('bw'), from: { c: from.id, p: this.pinIdx(from, 'outs') }, to: { c: to.id, p: this.pinIdx(to, 'ins') } });
  }
}

/** Creates a gate of `type` with its inputs pre-wired to `ins` (pin names A,B,C… by index). */
function gate(n: Net, type: string, col: number, ins: Sig[], props: Record<string, any> = {}): Sig {
  const g = n.add(type, col, { n: ins.length, ...props });
  ins.forEach((s, i) => n.wire(s, { id: g, pin: i }));
  return { id: g, pin: 'Y' };
}

const not = (n: Net, col: number, a: Sig): Sig => {
  const g = n.add('not', col);
  n.wire(a, { id: g, pin: 'A' });
  return { id: g, pin: 'Y' };
};

function mux2(n: Net, col: number, d0: Sig, d1: Sig, sel: Sig): Sig {
  const m = n.add('mux', col, { s: 1 }); // s = select bits: 1 → 2 data inputs
  n.wire(d0, { id: m, pin: 0 });
  n.wire(d1, { id: m, pin: 1 });
  n.wire(sel, { id: m, pin: 'S' });
  return { id: m, pin: 'Y' };
}

const konst = (n: Net, v: number, col: number): Sig => ({ id: n.add('const', col, { w: 1, value: v }), pin: 'Q' });

/** Splits a bus signal into its 1-bit signals (identity for w=1). */
function bits(n: Net, src: Sig, w: number, col: number): Sig[] {
  if (w === 1) return [src];
  const sp = n.add('splitter', col, { w });
  n.wire(src, { id: sp, pin: 'Bus' });
  return Array.from({ length: w }, (_, i) => ({ id: sp, pin: i }));
}

/** Combines 1-bit signals into a bus (identity for a single signal). */
function bus(n: Net, sigs: Sig[], col: number): Sig {
  if (sigs.length === 1) return sigs[0];
  const m = n.add('merger', col, { w: sigs.length });
  sigs.forEach((s, i) => n.wire(s, { id: m, pin: i }));
  return { id: m, pin: 'Bus' };
}

/** Multi-input OR built from ≤8-input OR gates. */
function orTree(n: Net, sigs: Sig[], col: number): Sig {
  if (sigs.length <= 1) return sigs[0] ?? konst(n, 0, col);
  if (sigs.length <= 8) return gate(n, 'or', col, sigs);
  const mid = Math.ceil(sigs.length / 2);
  return gate(n, 'or', col, [orTree(n, sigs.slice(0, mid), col), orTree(n, sigs.slice(mid), col)]);
}

interface Ctx {
  n: Net;
  p: any;
  /** signal of original input pin k */
  in: (k: number) => Sig;
  /** destination of original output pin k */
  out: (k: number) => Sig;
}

const SEG7_TABLE = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];

/**
 * One-level expansions. Everything bottoms out at primitive gates, bus
 * splitters/mergers and constants; smaller complex components (fulladder,
 * dff, mux, decoder…) may appear as intermediate steps and can themselves
 * be broken down further.
 */
const EXPANSIONS: Record<string, (ctx: Ctx) => void> = {
  mux: ({ n, p, in: I, out: O }) => {
    const k = 1 << p.s, w = p.w;
    const dBits: Sig[][] = [];
    for (let j = 0; j < k; j++) dBits.push(bits(n, I(j), w, 0));
    const dec = n.add('decoder', 1, { n: p.s });
    n.wire(I(k), { id: dec, pin: 'A' });
    const perBit: Sig[][] = Array.from({ length: w }, () => []);
    for (let j = 0; j < k; j++)
      for (let b = 0; b < w; b++) {
        perBit[b].push(gate(n, 'and', 2, [dBits[j][b], { id: dec, pin: j }]));
      }
    n.wire(bus(n, perBit.map((t) => orTree(n, t, 3)), 4), O(0));
  },

  demux: ({ n, p, in: I, out: O }) => {
    const k = 1 << p.s, w = p.w;
    const dec = n.add('decoder', 1, { n: p.s });
    n.wire(I(1), { id: dec, pin: 'A' });
    const dBits = bits(n, I(0), w, 0);
    for (let j = 0; j < k; j++) {
      n.wire(bus(n, dBits.map((d) => gate(n, 'and', 2, [d, { id: dec, pin: j }])), 3), O(j));
    }
  },

  decoder: ({ n, p, in: I, out: O }) => {
    const k = 1 << p.n;
    const aB = bits(n, I(0), p.n, 0);
    const inv = aB.map((a) => not(n, 0, a));
    for (let j = 0; j < k; j++) {
      const ins: Sig[] = [I(1)]; // EN (defaults to 1 when unconnected via pin default)
      for (let i = 0; i < p.n; i++) ins.push((j >> i) & 1 ? aB[i] : inv[i]);
      n.wire(gate(n, 'and', 1, ins), O(j));
    }
  },

  encoder: ({ n, p, in: I, out: O }) => {
    const k = 1 << p.n;
    const yB: Sig[] = [];
    for (let j = 0; j < p.n; j++) {
      const terms: Sig[] = [];
      for (let i = 0; i < k; i++) if ((i >> j) & 1) terms.push(I(i));
      yB.push(orTree(n, terms, 0));
    }
    n.wire(bus(n, yB, 1), O(0));
  },

  penc: ({ n, p, in: I, out: O }) => {
    const k = 1 << p.n;
    const yB: Sig[] = [];
    for (let j = 0; j < p.n; j++) {
      const terms: Sig[] = [];
      for (let i = 0; i < k; i++) {
        if (!((i >> j) & 1)) continue;
        const higher: Sig[] = [];
        for (let h = i + 1; h < k; h++) higher.push(I(h));
        const ins: Sig[] = [I(i)];
        if (higher.length) ins.push(gate(n, 'nor', 0, higher)); // no higher input active
        terms.push(gate(n, 'and', 1, ins));
      }
      yB.push(orTree(n, terms, 2));
    }
    n.wire(bus(n, yB, 3), O(0));
    n.wire(orTree(n, Array.from({ length: k }, (_, i) => I(i)), 2), O(1)); // V
  },

  halfadder: ({ n, in: I, out: O }) => {
    n.wire(gate(n, 'xor', 0, [I(0), I(1)]), O(0));
    n.wire(gate(n, 'and', 0, [I(0), I(1)]), O(1));
  },

  fulladder: ({ n, in: I, out: O }) => {
    const x1 = gate(n, 'xor', 0, [I(0), I(1)]);
    n.wire(gate(n, 'xor', 1, [x1, I(2)]), O(0));
    n.wire(gate(n, 'or', 2, [gate(n, 'and', 1, [I(0), I(1)]), gate(n, 'and', 1, [x1, I(2)])]), O(1));
  },

  adder: ({ n, p, in: I, out: O }) => {
    const aB = bits(n, I(0), p.w, 0), bB = bits(n, I(1), p.w, 0);
    let carry = I(2);
    const sB: Sig[] = [];
    for (let i = 0; i < p.w; i++) {
      const fa = n.add('fulladder', 2);
      n.wire(aB[i], { id: fa, pin: 'A' });
      n.wire(bB[i], { id: fa, pin: 'B' });
      n.wire(carry, { id: fa, pin: 'Cin' });
      sB.push({ id: fa, pin: 'S' });
      carry = { id: fa, pin: 'Cout' };
    }
    n.wire(bus(n, sB, 3), O(0));
    n.wire(carry, O(1));
  },

  comparator: ({ n, p, in: I, out: O }) => {
    const w = p.w;
    const aB = bits(n, I(0), w, 0), bB = bits(n, I(1), w, 0);
    // A > B, A = B and A < B derived from the subtraction A + ~B + 1
    const nb = bB.map((b) => not(n, 1, b));
    const neqXor = aB.map((a, i) => gate(n, 'xor', 1, [a, bB[i]]));
    const add = n.add('adder', 2, { w });
    n.wire(I(0), { id: add, pin: 'A' });
    n.wire(bus(n, nb, 1), { id: add, pin: 'B' });
    n.wire(konst(n, 1, 2), { id: add, pin: 'Cin' });
    const neq = orTree(n, neqXor, 3); // some bit differs
    const eqG = not(n, 4, neq);       // A = B
    const gt = gate(n, 'and', 4, [{ id: add, pin: 'Cout' }, neq]); // A > B: A ≥ B and not equal
    const lt = gate(n, 'nor', 4, [gt, eqG]);
    n.wire(gt, O(0));
    n.wire(eqG, O(1));
    n.wire(lt, O(2));
  },

  alu: ({ n, p, in: I, out: O }) => {
    const w = p.w;
    const dec = n.add('decoder', 0, { n: 3 });
    n.wire(I(2), { id: dec, pin: 'A' });
    const op = (k: number): Sig => ({ id: dec, pin: k });
    const aB = bits(n, I(0), w, 1), bB = bits(n, I(1), w, 1);
    // one adder covers ADD and SUB: B' = SUB ? ~B : B, Cin = SUB
    const selB: Sig[] = [], andO: Sig[] = [], orO: Sig[] = [], xorO: Sig[] = [], notA: Sig[] = [];
    for (let i = 0; i < w; i++) {
      selB.push(mux2(n, 2, bB[i], not(n, 2, bB[i]), op(1)));
      andO.push(gate(n, 'and', 2, [aB[i], bB[i]]));
      orO.push(gate(n, 'or', 2, [aB[i], bB[i]]));
      xorO.push(gate(n, 'xor', 2, [aB[i], bB[i]]));
      notA.push(not(n, 2, aB[i]));
    }
    const add = n.add('adder', 3, { w });
    n.wire(I(0), { id: add, pin: 'A' });
    n.wire(bus(n, selB, 2), { id: add, pin: 'B' });
    n.wire(op(1), { id: add, pin: 'Cin' });
    const addS = bits(n, { id: add, pin: 'S' }, w, 4);
    // per-bit 8:1 output mux on OP: 0/1 = add result, 2..7 = logic ops / pass / shift / not
    const rB: Sig[] = [];
    for (let i = 0; i < w; i++) {
      const om = n.add('mux', 4, { s: 3 });
      n.wire(I(2), { id: om, pin: 'S' });
      n.wire(addS[i], { id: om, pin: 0 });
      n.wire(addS[i], { id: om, pin: 1 });
      n.wire(andO[i], { id: om, pin: 2 });
      n.wire(orO[i], { id: om, pin: 3 });
      n.wire(xorO[i], { id: om, pin: 4 });
      n.wire(bB[i], { id: om, pin: 5 });
      n.wire(i > 0 ? aB[i - 1] : konst(n, 0, 1), { id: om, pin: 6 }); // SHL
      n.wire(notA[i], { id: om, pin: 7 });
      rB.push({ id: om, pin: 'Y' });
    }
    n.wire(bus(n, rB, 5), O(0));
    n.wire(not(n, 6, orTree(n, rB, 5)), O(1)); // Z = result is zero
    const cAdd = gate(n, 'or', 5, [gate(n, 'and', 4, [op(0), { id: add, pin: 'Cout' }]), gate(n, 'and', 4, [op(1), not(n, 4, { id: add, pin: 'Cout' })])]);
    n.wire(gate(n, 'or', 6, [cAdd, gate(n, 'and', 5, [op(6), aB[w - 1]])]), O(2)); // C = carry / borrow / shifted-out MSB
  },

  srlatch: ({ n, in: I, out: O }) => {
    // Gated NOR latch: S' = S·R̄, R' = R·S̄ so the forbidden state S=R=1 holds the
    // stored bit while both outputs read 0 — exactly the built-in eval's semantics.
    const s = I(0), r = I(1);
    const ns = not(n, 0, s), nr = not(n, 0, r);
    const sp = gate(n, 'and', 1, [s, nr]);
    const rp = gate(n, 'and', 1, [r, ns]);
    const qn = n.add('nor', 2, { n: 2 }); // Q̄ (created first so power-up settles to Q=0)
    const qg = n.add('nor', 2, { n: 2 }); // Q
    n.wire(sp, { id: qn, pin: 0 });
    n.wire({ id: qg, pin: 'Y' }, { id: qn, pin: 1 });
    n.wire(rp, { id: qg, pin: 0 });
    n.wire({ id: qn, pin: 'Y' }, { id: qg, pin: 1 });
    const nbad = gate(n, 'nand', 1, [s, r]); // NAND(S,R) = NOT(S·R)
    n.wire(gate(n, 'and', 3, [{ id: qg, pin: 'Y' }, nbad]), O(0));
    n.wire(gate(n, 'and', 3, [{ id: qn, pin: 'Y' }, nbad]), O(1));
  },

  dlatch: ({ n, in: I, out: O }) => {
    const d = I(0), en = I(1);
    const sp = gate(n, 'and', 0, [d, en]);
    const rp = gate(n, 'and', 0, [not(n, 0, d), en]);
    const qn = n.add('nor', 1, { n: 2 }); // Q̄ = NOR(S, Q), created first for power-up Q=0
    const qg = n.add('nor', 1, { n: 2 }); // Q = NOR(R, Q̄)
    n.wire(sp, { id: qn, pin: 0 });
    n.wire({ id: qg, pin: 'Y' }, { id: qn, pin: 1 });
    n.wire(rp, { id: qg, pin: 0 });
    n.wire({ id: qn, pin: 'Y' }, { id: qg, pin: 1 });
    n.wire({ id: qg, pin: 'Y' }, O(0));
    n.wire({ id: qn, pin: 'Y' }, O(1));
  },

  dff: ({ n, in: I, out: O }) => {
    // Master-slave D flip-flop from primitive gates, with async CLR wired into both latch resets.
    const D = I(0), CLK = I(1), CLR = I(2);
    const nd = not(n, 0, D);
    const nc = not(n, 0, CLK);
    const sm = gate(n, 'and', 1, [D, nc]);               // master set
    const rm = gate(n, 'or', 1, [gate(n, 'and', 1, [nd, nc]), CLR]); // master reset
    const qbm = n.add('nor', 2, { n: 2 }); // master Q̄
    const qmg = n.add('nor', 2, { n: 2 }); // master Q
    n.wire(sm, { id: qbm, pin: 0 });
    n.wire({ id: qmg, pin: 'Y' }, { id: qbm, pin: 1 });
    n.wire(rm, { id: qmg, pin: 0 });
    n.wire({ id: qbm, pin: 'Y' }, { id: qmg, pin: 1 });
    const ss = gate(n, 'and', 3, [{ id: qmg, pin: 'Y' }, CLK]);           // slave set
    const rs = gate(n, 'or', 3, [gate(n, 'and', 3, [{ id: qbm, pin: 'Y' }, CLK]), CLR]); // slave reset
    const qb = n.add('nor', 4, { n: 2 }); // slave Q̄
    const qg = n.add('nor', 4, { n: 2 }); // slave Q
    n.wire(ss, { id: qb, pin: 0 });
    n.wire({ id: qg, pin: 'Y' }, { id: qb, pin: 1 });
    n.wire(rs, { id: qg, pin: 0 });
    n.wire({ id: qb, pin: 'Y' }, { id: qg, pin: 1 });
    n.wire({ id: qg, pin: 'Y' }, O(0));
    n.wire({ id: qb, pin: 'Y' }, O(1));
  },

  jkff: ({ n, in: I, out: O }) => {
    const d = n.add('dff', 2);
    n.wire(I(2), { id: d, pin: 'CLK' });
    n.wire(I(3), { id: d, pin: 'CLR' });
    // D = J·Q̄ + K̄·Q  (J=K=1 → D=Q̄ → toggle)
    n.wire(gate(n, 'or', 1, [gate(n, 'and', 0, [I(0), { id: d, pin: 1 }]), gate(n, 'and', 0, [not(n, 0, I(1)), { id: d, pin: 0 }])]), { id: d, pin: 'D' });
    n.wire({ id: d, pin: 0 }, O(0));
    n.wire({ id: d, pin: 1 }, O(1));
  },

  tff: ({ n, in: I, out: O }) => {
    const d = n.add('dff', 1);
    n.wire(I(1), { id: d, pin: 'CLK' });
    n.wire(I(2), { id: d, pin: 'CLR' });
    n.wire(gate(n, 'xor', 0, [I(0), { id: d, pin: 0 }]), { id: d, pin: 'D' });
    n.wire({ id: d, pin: 0 }, O(0));
    n.wire({ id: d, pin: 1 }, O(1));
  },

  reg: ({ n, p, in: I, out: O }) => {
    const dB = bits(n, I(0), p.w, 0);
    const qB: Sig[] = [];
    for (let i = 0; i < p.w; i++) {
      const d = n.add('dff', 2);
      n.wire(mux2(n, 1, { id: d, pin: 0 }, dB[i], I(2)), { id: d, pin: 'D' }); // EN=0 → hold
      n.wire(I(1), { id: d, pin: 'CLK' });
      n.wire(I(3), { id: d, pin: 'CLR' });
      qB.push({ id: d, pin: 0 });
    }
    n.wire(bus(n, qB, 3), O(0));
  },

  counter: ({ n, p, in: I, out: O }) => {
    const bcd = p.mode === 'bcd';
    const w = bcd ? 4 : p.w;
    const clk = I(0), en = I(1), clr = I(2), up = I(3), ld = I(4);
    const dB = bits(n, I(5), w, 0);
    const go = gate(n, 'or', 0, [ld, en]); // LD loads even when EN=0 (matches built-in eval)
    const dffs = Array.from({ length: w }, () => n.add('dff', 4));
    const qB = dffs.map((d) => ({ id: d, pin: 0 }));
    let f0: Sig | null = null, zdn: Sig | null = null, nine: Sig | null = null, zero: Sig | null = null;
    if (bcd) {
      const nq1 = not(n, 1, qB[1]);
      const nq2 = not(n, 1, qB[2]);
      const nup = not(n, 1, up);
      nine = gate(n, 'and', 2, [qB[3], nq2, nq1, qB[0]]);     // q == 9 (1001)
      zero = gate(n, 'nor', 2, [qB[0], qB[1], qB[2], qB[3]]); // q == 0
      zdn = gate(n, 'and', 2, [zero, nup]);                   // down-wrap 0 → 9
      f0 = not(n, 2, gate(n, 'or', 2, [gate(n, 'and', 2, [nine, up]), zdn])); // force 0000: up-wrap 9 → 0 and down-wrap 0 → 9
      // clamp D to 9 on load (Math.min(d, 9))
      const clamp = gate(n, 'and', 1, [dB[3], gate(n, 'or', 0, [dB[2], dB[1]])]);
      const ncl = not(n, 1, clamp);
      dB[0] = gate(n, 'or', 1, [dB[0], clamp]);
      dB[1] = gate(n, 'and', 1, [dB[1], ncl]);
      dB[2] = gate(n, 'and', 1, [dB[2], ncl]);
    }
    const chain: Sig[] = [konst(n, 1, 0)]; // carry / borrow chain: c_0 = 1
    for (let i = 0; i < w; i++) {
      const t = gate(n, 'xnor', 1, [qB[i], up]); // up: t=q, down: t=~q
      chain.push(gate(n, 'and', 1, [t, chain[i]]));
      let next = gate(n, 'xor', 2, [qB[i], chain[i]]);
      if (bcd) {
        next = gate(n, 'and', 3, [next, f0!]);
        if (i === 0 || i === 3) next = gate(n, 'or', 3, [next, zdn!]); // 0000 → 1001
      }
      const mL = mux2(n, 3, next, dB[i], ld);
      n.wire(mux2(n, 3, qB[i], mL, go), { id: dffs[i], pin: 'D' });
      n.wire(clk, { id: dffs[i], pin: 'CLK' });
      n.wire(clr, { id: dffs[i], pin: 'CLR' });
    }
    n.wire(bus(n, qB, 5), O(0));
    n.wire(bcd ? mux2(n, 4, zero!, nine!, up) : chain[w], O(1)); // terminal count
  },

  shiftreg: ({ n, p, in: I, out: O }) => {
    const w = p.w;
    const si = I(0), clk = I(1), en = I(2), clr = I(3), dir = I(4);
    const dffs = Array.from({ length: w }, () => n.add('dff', 2));
    const qB = dffs.map((d) => ({ id: d, pin: 0 }));
    for (let i = 0; i < w; i++) {
      const left = i > 0 ? qB[i - 1] : si;               // DIR=0: SI enters at bit 0
      const right = i < w - 1 ? qB[i + 1] : si;          // DIR=1: SI enters at bit w-1
      const d = mux2(n, 1, left, right, dir);
      n.wire(mux2(n, 1, qB[i], d, en), { id: dffs[i], pin: 'D' });
      n.wire(clk, { id: dffs[i], pin: 'CLK' });
      n.wire(clr, { id: dffs[i], pin: 'CLR' });
    }
    n.wire(bus(n, qB, 3), O(0));
    n.wire(mux2(n, 2, qB[w - 1], qB[0], dir), O(1)); // SO = DIR ? Q0 : Q[w-1]
  },

  seg7dec: ({ n, in: I, out: O }) => {
    // Minimal SOP per segment, derived from the built-in lookup table via Quine–McCluskey.
    const dB = bits(n, I(0), 4, 0);
    const inv = dB.map((b) => not(n, 0, b));
    for (let seg = 0; seg < 7; seg++) {
      const minterms: number[] = [];
      for (let d = 0; d < 16; d++) if ((SEG7_TABLE[d] >> seg) & 1) minterms.push(d);
      const terms: Sig[] = [];
      for (const imp of minimize(minterms)) {
        const ins: Sig[] = [];
        for (let i = 0; i < 4; i++) {
          const bit = 1 << i; // QM var j is minterm bit (n-1-j) → input bit i lives at minterm bit 1<<i
          if (imp.dc & bit) continue;
          ins.push((imp.v & bit) ? dB[i] : inv[i]);
        }
        terms.push(ins.length ? gate(n, 'and', 1, ins) : konst(n, 1, 1));
      }
      n.wire(orTree(n, terms, 2), O(seg));
    }
  },
};

/** Complex built-in parts, plus any custom IC, can be taken apart. */
export const isBreakable = (c: Comp, defs?: Record<string, ICDef>): boolean =>
  c.type === 'ic' ? !defs || !!defs[c.props.def] : !!EXPANSIONS[c.type];

/** Builds the gate-level ICDef for a built-in complex component (the def is not registered anywhere). */
function expand(t: Comp, defs: Record<string, ICDef>): ICDef {
  const { ins, outs } = pinsOf(t, defs);
  const net = new Net();
  const pinIn = ins.map((pin) => ({ id: uid('b'), pin }));
  const pinOut = outs.map((pin) => ({ id: uid('b'), pin }));
  // boundary comps exist before the expansion runs so wires can resolve pin names against them
  pinIn.forEach((pi) => net.add('pin_in', -1, { w: pi.pin.w, ...(pi.pin.def !== undefined ? { def: pi.pin.def } : {}) }, pi.pin.name, pi.id));
  const outIds = new Set(pinOut.map((po) => po.id));
  pinOut.forEach((po) => net.add('pin_out', -2, { w: po.pin.w }, po.pin.name, po.id));
  EXPANSIONS[t.type]({
    n: net,
    p: t.props,
    in: (k) => ({ id: pinIn[k].id, pin: 'out' }),
    out: (k) => ({ id: pinOut[k].id, pin: 'in' }),
  });
  // move the output pins just past the last logic column
  const outCol = (net.maxCol + 1) * COL_W;
  net.comps.forEach((cm) => { if (outIds.has(cm.id)) cm.x = outCol; });
  return {
    id: uid('ic'),
    name: titleOf(t, defs),
    comps: net.comps,
    wires: net.wires,
    inputs: pinIn.map((pi) => ({ id: pi.id, label: pi.pin.name, w: pi.pin.w })),
    outputs: pinOut.map((po) => ({ id: po.id, label: po.pin.name, w: po.pin.w })),
  };
}

// ---------------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------------

interface Rect { x0: number; y0: number; x1: number; y1: number }

/**
 * Finds a spot for a w×h block as close as possible to (ax, ay) that does not overlap
 * any obstacle; falls back to the space below everything.
 */
function findSpot(w: number, h: number, ax: number, ay: number, obstacles: Rect[]): { x: number; y: number } {
  const free = (x: number, y: number) =>
    obstacles.every((o) => x + w + G <= o.x0 || o.x1 + G <= x || y + h + G <= o.y0 || o.y1 + G <= y);
  if (free(ax, ay)) return { x: ax, y: ay };
  const STEP = 2 * G;
  for (let r = 1; r <= 14; r++) {
    const ring: [number, number][] = [];
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++) if (Math.max(Math.abs(i), Math.abs(j)) === r) ring.push([i, j]);
    ring.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
    for (const [i, j] of ring) if (free(ax + i * STEP, ay + j * STEP)) return { x: ax + i * STEP, y: ay + j * STEP };
  }
  return { x: ax, y: snap(Math.max(ay, ...obstacles.map((o) => o.y1)) + 3 * G) };
}

// ---------------------------------------------------------------------------------
// Inlining an IC instance
// ---------------------------------------------------------------------------------

type PinRef = { c: string; p: number };

/**
 * Replaces the instance `ic` by the contents of `def`, wired straight into the
 * surrounding circuit. The IC's boundary pins disappear: whatever drove input k now
 * drives the internal consumers of pin k directly, and the internal driver of output
 * m now drives whatever the IC's output m fed.
 *
 * Unconnected inputs keep their meaning: pin_in's default (or 0) is materialised as a
 * constant wherever the internal consumer's own pin default would differ.
 */
function flatten(c: Circuit, ic: Comp, def: ICDef): { circuit: Circuit; placed: string[]; count: number } {
  const defs = c.defs;
  const inIdx = new Map(def.inputs.map((p, k) => [p.id, k]));
  const outIdx = new Map(def.outputs.map((p, k) => [p.id, k]));
  const body = def.comps.filter((x) => x.type !== 'pin_in' && x.type !== 'pin_out' && !inIdx.has(x.id) && !outIdx.has(x.id));
  const bodyById = new Map(body.map((x) => [x.id, x]));
  const newId = new Map(body.map((x) => [x.id, uid('c')]));
  const inComp = def.inputs.map((p) => def.comps.find((x) => x.id === p.id));

  const extIn = def.inputs.map((_p, k) => c.wires.find((w) => w.to.c === ic.id && w.to.p === k));
  const extOut = def.outputs.map((_p, m) => c.wires.filter((w) => w.from.c === ic.id && w.from.p === m && w.to.c !== ic.id));
  const untouched = c.wires.filter((w) => w.from.c !== ic.id && w.to.c !== ic.id);

  // geometry: block bbox in the def's own coordinates (constants for unconnected pins sit to its left)
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const x of body) {
    const b = bbox(x, layoutOf(x, defs));
    bx0 = Math.min(bx0, b.x0); by0 = Math.min(by0, b.y0); bx1 = Math.max(bx1, b.x1); by1 = Math.max(by1, b.y1);
  }
  if (!body.length) { bx0 = by0 = 0; bx1 = by1 = 2 * G; }

  const extra: Comp[] = [];
  const consts = new Map<string, PinRef>();
  const mkConst = (value: number, w: number): PinRef => {
    const key = `${w}:${value}`;
    let r = consts.get(key);
    if (!r) {
      r = { c: uid('c'), p: 0 };
      consts.set(key, r);
      extra.push({ id: r.c, type: 'const', x: bx0 - 6 * G, y: by0 + (extra.length * 3 + 1) * G, rot: 0, name: '', props: { w, value } });
    }
    return r;
  };

  // what drives output pin m inside the def: a body component pin, an input pin (pass-through), or nothing
  type Src = { c: string; p: number } | { pin: number } | null;
  const outSrc: Src[] = def.outputs.map(() => null);
  const innerWires: Wire[] = [];
  const fed: { k: number; to: PinRef; label?: string }[] = [];
  for (const w of def.wires) {
    const fromIn = inIdx.get(w.from.c);
    if (fromIn === undefined && !bodyById.has(w.from.c)) continue;
    const toOut = outIdx.get(w.to.c);
    if (toOut !== undefined) { outSrc[toOut] = fromIn !== undefined ? { pin: fromIn } : { c: w.from.c, p: w.from.p }; continue; }
    if (!bodyById.has(w.to.c)) continue;
    const to = { c: newId.get(w.to.c)!, p: w.to.p };
    if (fromIn !== undefined) fed.push({ k: fromIn, to, label: w.label });
    else innerWires.push({ id: uid('w'), from: { c: newId.get(w.from.c)!, p: w.from.p }, to, ...(w.label ? { label: w.label } : {}) });
  }

  // resolving signals across the boundary (consumerDef: the consumer's own pin default, null = always materialise)
  const ownDefault = (comp: Comp | undefined, p: number): number => (comp ? pinsOf(comp, defs).ins[p]?.def ?? 0 : 0);
  const inSource = (k: number, consumerDef: number | null, depth: number): PinRef | null => {
    const ext = extIn[k];
    if (ext) return extSource(ext.from, depth);
    const v = (inComp[k]?.props.def as number | undefined) ?? 0;
    return consumerDef === v ? null : mkConst(v, def.inputs[k].w);
  };
  const outSource = (m: number, consumerDef: number | null, depth: number): PinRef | null => {
    const s = outSrc[m];
    if (!s) return consumerDef === 0 ? null : mkConst(0, def.outputs[m].w);
    if ('pin' in s) return depth > 6 ? mkConst(0, def.outputs[m].w) : inSource(s.pin, consumerDef, depth + 1);
    return { c: newId.get(s.c)!, p: s.p };
  };
  // an external wire may come from the IC itself (output fed back into one of its own inputs)
  const extSource = (from: PinRef, depth: number): PinRef | null =>
    from.c !== ic.id ? from : depth > 6 ? mkConst(0, def.outputs[from.p]?.w ?? 1) : outSource(from.p, null, depth + 1);

  const wires: Wire[] = [...untouched, ...innerWires];
  const byNewId = new Map(body.map((x) => [newId.get(x.id)!, x]));
  for (const f of fed) {
    const src = inSource(f.k, ownDefault(byNewId.get(f.to.c), f.to.p), 0);
    const label = f.label ?? extIn[f.k]?.label;
    if (src) wires.push({ id: uid('w'), from: src, to: f.to, ...(label ? { label } : {}) });
  }
  const outside = new Map(c.comps.map((x) => [x.id, x]));
  extOut.forEach((list, m) => {
    for (const e of list) {
      const src = outSource(m, ownDefault(outside.get(e.to.c), e.to.p), 0);
      if (src) wires.push({ ...e, from: src });
    }
  });

  // probes on the IC follow the signal they were watching
  const probes = c.probes.flatMap((p) => {
    if (p.comp !== ic.id) return [p];
    const ext = p.kind === 'in' ? extIn[p.pin] : undefined;
    const s = p.kind === 'out' ? outSource(p.pin, null, 0) : ext ? extSource(ext.from, 0) : null;
    return s ? [{ ...p, comp: s.c, pin: s.p, kind: 'out' as const }] : [];
  });

  // placement: as close to the IC as possible without covering anything
  const all = [...body, ...extra];
  let rx0 = bx0, ry0 = by0, ry1 = by1;
  if (extra.length) { rx0 = bx0 - 6 * G; ry0 = Math.min(by0, extra[0].y); ry1 = Math.max(by1, extra[extra.length - 1].y + 2 * G); }
  const obstacles: Rect[] = c.comps
    .filter((x) => x.id !== ic.id)
    .map((x) => bbox(x, layoutOf(x, defs)));
  const spot = findSpot(bx1 - rx0, ry1 - ry0, snap(ic.x), snap(ic.y), obstacles);
  const dx = snap(spot.x - rx0), dy = snap(spot.y - ry0);
  const placedComps: Comp[] = all.map((x) => ({
    ...x,
    id: newId.get(x.id) ?? x.id,
    x: x.x + dx,
    y: x.y + dy,
    props: JSON.parse(JSON.stringify(x.props)),
  }));

  const rest = c.comps.filter((x) => x.id !== ic.id);
  let nextDefs = defs;
  // an auto-generated def nobody else uses any more is just clutter
  if (def.auto) {
    const usedElsewhere =
      rest.some((x) => x.type === 'ic' && x.props.def === def.id) ||
      Object.values(defs).some((d) => d.id !== def.id && d.comps.some((x) => x.type === 'ic' && x.props.def === def.id));
    if (!usedElsewhere) { nextDefs = { ...defs }; delete nextDefs[def.id]; }
  }
  return {
    circuit: { comps: [...rest, ...placedComps], wires, defs: nextDefs, probes },
    placed: placedComps.map((x) => x.id),
    count: all.length,
  };
}

// ---------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------

export interface BreakResult {
  circuit?: Circuit;
  error?: string;
  /** labels of the components that were taken apart */
  broken: string[];
  /** total number of components the replacements expand to */
  total: number;
  /** ids of the components that now sit where the originals were */
  placed: string[];
}

/**
 * "Break down": each selected component is deleted and its internals are put out on
 * the canvas, wired into the surrounding circuit. Built-in complex parts expand one
 * level (adder → full adders, register → flip-flops, D-FF → latches/gates…); a custom
 * IC is inlined exactly as it was defined.
 */
export function breakDown(c: Circuit, ids: string[]): BreakResult {
  const sel = new Set(ids);
  const targets = c.comps.filter((x) => sel.has(x.id) && isBreakable(x, c.defs));
  if (!targets.length)
    return { error: 'Nothing selected can be broken down — gates, I/O, bus and memory parts are already primitive.', broken: [], total: 0, placed: [] };
  let cur = c;
  const broken: string[] = [];
  const placed: string[] = [];
  let total = 0;
  for (const t of targets) {
    const def = t.type === 'ic' ? cur.defs[t.props.def] : expand(t, cur.defs);
    const r = flatten(cur, t, def);
    cur = r.circuit;
    placed.push(...r.placed);
    total += r.count;
    broken.push(titleOf(t, c.defs));
  }
  return { circuit: cur, broken, total, placed };
}

export interface CustomizeResult { circuit?: Circuit; defId?: string; name?: string; error?: string }

/**
 * "Edit IC internals" on a built-in complex part: the part turns into a custom IC with
 * the same id, position, rotation and pin order (so wires and probes stay valid) whose
 * definition is the part's gate-level expansion. The new IC shows up in the palette.
 */
export function customize(c: Circuit, id: string): CustomizeResult {
  const t = c.comps.find((x) => x.id === id);
  if (!t || !EXPANSIONS[t.type])
    return { error: 'Only complex built-in parts (counters, adders, flip-flops, decoders…) can be turned into an editable IC.' };
  const def = expand(t, c.defs);
  const base = `${def.name} (custom)`;
  const taken = new Set(Object.values(c.defs).map((d) => d.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  def.name = name;
  return {
    circuit: { ...c, comps: c.comps.map((x) => (x.id === id ? { ...x, type: 'ic', props: { def: def.id } } : x)), defs: { ...c.defs, [def.id]: def } },
    defId: def.id,
    name,
  };
}
