// "Computer Architecture" example folder: every circuit drawn in the course slides
// (logic gates → combinational blocks → flip-flops/registers/memory → RTL datapaths → ALU).
import type { Circuit } from './types';
import { B } from './templates';
import type { Template } from './templates';

const sw = (b: B, n: string, x: number, y: number, v = 0) => b.add('switch', x, y, { value: v }, n);
const num = (b: B, n: string, x: number, y: number, w: number, v = 0) => b.add('numin', x, y, { w, value: v }, n);
const led = (b: B, n: string, x: number, y: number) => b.add('led', x, y, {}, n);
const hx = (b: B, n: string, x: number, y: number, w: number) => b.add('hexdisp', x, y, { w }, n);
const k = (b: B, x: number, y: number, w: number, v: number, n = '') => b.add('const', x, y, { w, value: v }, n);
const gate = (b: B, t: string, x: number, y: number, n = 2, w = 1) => b.add(t, x, y, { n, w });
const not = (b: B, x: number, y: number, w = 1) => b.add('not', x, y, { w });
const clock = (b: B, x: number, y: number) => b.add('clock', x, y, { freq: 1, period: 20 }, 'CLK');
const mux = (b: B, x: number, y: number, s = 1, w = 1, n = '') => b.add('mux', x, y, { s, w }, n);
const split = (b: B, x: number, y: number, w: number) => b.add('splitter', x, y, { w });
const merge = (b: B, x: number, y: number, w: number) => b.add('merger', x, y, { w });

/** Register with a manual-load path: INIT=1 loads the "init" number instead of the datapath value. */
function lreg(b: B, name: string, x: number, y: number, w: number, init: string, clk: string, val = 0) {
  const n = num(b, name + ' init', x, y + 100, w, val);
  const m = mux(b, x + 170, y, 1, w);
  const or = gate(b, 'or', x + 170, y + 130);
  const r = b.add('reg', x + 340, y, { w }, name);
  b.w(n, 'Q', m, 'D1'); b.w(init, 'Q', m, 'S'); b.w(m, 'Y', r, 'D'); b.w(clk, 'CLK', r, 'CLK');
  b.w(init, 'Q', or, 'A'); b.w(or, 'Y', r, 'EN');
  return { r, d: m, en: or }; // datapath → d.D0 ; control strobe → en.B
}

// ───────────── combinational ─────────────
function tGates(): Circuit {
  const b = new B();
  const a = sw(b, 'A', 40, 60), c = sw(b, 'B', 40, 200);
  ['and', 'or', 'nand', 'nor', 'xor'].forEach((t, i) => {
    const g = gate(b, t, 260, 40 + i * 90);
    b.w(a, 'Q', g, 'A'); b.w(c, 'Q', g, 'B');
    b.w(g, 'Y', led(b, t.toUpperCase(), 460, 50 + i * 90), 'A');
  });
  const n = not(b, 260, 500);
  b.w(a, 'Q', n, 'A'); b.w(n, 'Y', led(b, 'NOT A', 460, 510), 'A');
  return b.circuit();
}

function tKmap3(): Circuit {
  const b = new B();
  const A = sw(b, 'A', 40, 40), Bs = sw(b, 'B', 40, 140), C = sw(b, 'C', 40, 240);
  const nA = not(b, 200, 40), nC = not(b, 200, 240);
  b.w(A, 'Q', nA, 'A'); b.w(C, 'Q', nC, 'A');
  const m = [[nA, Bs, nC], [nA, Bs, C], [A, Bs, nC]].map((ins, i) => {
    const g = gate(b, 'and', 400, 40 + i * 90, 3);
    ins.forEach((s, j) => b.w(s, s === nA || s === nC ? 'Y' : 'Q', g, 'ABC'[j]));
    return g;
  });
  const or = gate(b, 'or', 600, 90, 3);
  m.forEach((g, i) => b.w(g, 'Y', or, 'ABC'[i]));
  b.w(or, 'Y', led(b, 'F = A\'BC\' + A\'BC + ABC\'', 780, 100), 'A');
  // simplified: F = A'B + BC'
  const s1 = gate(b, 'and', 400, 360), s2 = gate(b, 'and', 400, 450), so = gate(b, 'or', 600, 400);
  b.w(nA, 'Y', s1, 'A'); b.w(Bs, 'Q', s1, 'B'); b.w(Bs, 'Q', s2, 'A'); b.w(nC, 'Y', s2, 'B');
  b.w(s1, 'Y', so, 'A'); b.w(s2, 'Y', so, 'B');
  b.w(so, 'Y', led(b, 'F = A\'B + BC\' (simplified)', 780, 410), 'A');
  return b.circuit();
}

function tMux4Gates(): Circuit {
  const b = new B();
  const D = [0, 1, 2, 3].map((i) => sw(b, 'D' + i, 40, 40 + i * 80));
  const S1 = sw(b, 'S1', 40, 400), S0 = sw(b, 'S0', 40, 480);
  const n1 = not(b, 200, 400), n0 = not(b, 200, 480);
  b.w(S1, 'Q', n1, 'A'); b.w(S0, 'Q', n0, 'A');
  const or = gate(b, 'or', 620, 160, 4);
  [0, 1, 2, 3].forEach((i) => {
    const g = gate(b, 'and', 420, 40 + i * 90, 3);
    b.w(D[i], 'Q', g, 'A');
    if (i & 2) b.w(S1, 'Q', g, 'B'); else b.w(n1, 'Y', g, 'B');
    if (i & 1) b.w(S0, 'Q', g, 'C'); else b.w(n0, 'Y', g, 'C');
    b.w(g, 'Y', or, 'ABCD'[i]);
  });
  b.w(or, 'Y', led(b, 'F', 800, 170), 'A');
  return b.circuit();
}

export const MUX8_F_MINTERMS = [0, 2, 5, 8, 9, 12, 13, 14, 15];
function tMux8F(): Circuit {
  const b = new B();
  const A = sw(b, 'A', 40, 40), Bs = sw(b, 'B', 40, 140), C = sw(b, 'C', 40, 240), D = sw(b, 'D', 40, 340);
  const nA = not(b, 200, 40), one = k(b, 200, 120, 1, 1, '1'), zero = k(b, 200, 200, 1, 0, '0');
  b.w(A, 'Q', nA, 'A');
  const m = mux(b, 520, 100, 3, 1, 'MUX 8:1');
  // data row of the slide: 1, A, A', 0, A, 1, A, A  (indexed by B C D)
  const src: [string, string][] = [[one, 'Q'], [A, 'Q'], [nA, 'Y'], [zero, 'Q'], [A, 'Q'], [one, 'Q'], [A, 'Q'], [A, 'Q']];
  src.forEach(([id, pin], i) => b.w(id, pin, m, 'D' + i));
  const mg = merge(b, 360, 260, 3);
  b.w(D, 'Q', mg, 0); b.w(C, 'Q', mg, 1); b.w(Bs, 'Q', mg, 2);
  b.w(mg, 'Bus', m, 'S');
  b.w(m, 'Y', led(b, 'F', 720, 110), 'A');
  return b.circuit();
}

function tMux32(): Circuit {
  const b = new B();
  const data = [0, 1, 2, 3].map((i) => num(b, `D${i * 8}-${i * 8 + 7}`, 40, 40 + i * 120, 8, 0xA5 ^ (i * 0x3c)));
  const sel = num(b, 'ABCDE', 40, 560, 5, 0);
  const hi = b.add('slice', 260, 540, { w: 5, lo: 3, n: 2 }, 'A B'), lo = b.add('slice', 260, 640, { w: 5, lo: 0, n: 3 }, 'C D E');
  b.w(sel, 'Q', hi, 'In'); b.w(sel, 'Q', lo, 'In');
  const dec = b.add('decoder', 420, 500, { n: 2 });
  b.w(hi, 'Out', dec, 'A');
  const or = gate(b, 'or', 900, 200, 4);
  data.forEach((d, i) => {
    const sp = split(b, 240, 40 + i * 120, 8);
    const m = mux(b, 440, 40 + i * 120, 3, 1, `MUX 8:1 #${i}`);
    const g = gate(b, 'and', 680, 60 + i * 120);
    b.w(d, 'Q', sp, 'Bus');
    for (let j = 0; j < 8; j++) b.w(sp, j, m, 'D' + j);
    b.w(lo, 'Out', m, 'S');
    b.w(m, 'Y', g, 'A'); b.w(dec, 'Y' + i, g, 'B');
    b.w(g, 'Y', or, 'ABCD'[i]);
  });
  b.w(or, 'Y', led(b, 'F', 1060, 210), 'A');
  return b.circuit();
}

function tDec38(): Circuit {
  const b = new B();
  const S = ['A', 'B', 'C'].map((n, i) => sw(b, n, 40, 60 + i * 80));
  const N = S.map((s, i) => { const n = not(b, 200, 60 + i * 80); b.w(s, 'Q', n, 'A'); return n; });
  for (let d = 0; d < 8; d++) {
    const g = gate(b, 'and', 440, 20 + d * 70, 3);
    [2, 1, 0].forEach((bit, j) => { const i = 2 - bit; if ((d >> bit) & 1) b.w(S[i], 'Q', g, 'ABC'[j]); else b.w(N[i], 'Y', g, 'ABC'[j]); });
    b.w(g, 'Y', led(b, 'D' + d, 640, 30 + d * 70), 'A');
  }
  return b.circuit();
}

function tDec532(): Circuit {
  const b = new B();
  const sel = num(b, 'ABCDE', 40, 200, 5, 0);
  const hi = b.add('slice', 220, 120, { w: 5, lo: 3, n: 2 }, 'A B'), lo = b.add('slice', 220, 300, { w: 5, lo: 0, n: 3 }, 'C D E');
  b.w(sel, 'Q', hi, 'In'); b.w(sel, 'Q', lo, 'In');
  const d2 = b.add('decoder', 400, 100, { n: 2 }, '2→4');
  b.w(hi, 'Out', d2, 'A');
  for (let i = 0; i < 4; i++) {
    const d3 = b.add('decoder', 600, 40 + i * 130, { n: 3 }, `3→8 #${i}`);
    const mg = merge(b, 780, 40 + i * 130, 8);
    b.w(lo, 'Out', d3, 'A'); b.w(d2, 'Y' + i, d3, 'EN');
    for (let j = 0; j < 8; j++) b.w(d3, 'Y' + j, mg, j);
    b.w(mg, 'Bus', hx(b, `D${i * 8}-${i * 8 + 7}`, 940, 50 + i * 130, 8), 'A');
  }
  return b.circuit();
}

function tHalfAdderSlide(): Circuit {
  const b = new B();
  const a = sw(b, 'A', 40, 60), c = sw(b, 'B', 40, 180);
  const x = gate(b, 'xor', 240, 40), n = gate(b, 'and', 240, 160);
  b.w(a, 'Q', x, 'A'); b.w(c, 'Q', x, 'B'); b.w(a, 'Q', n, 'A'); b.w(c, 'Q', n, 'B');
  b.w(x, 'Y', led(b, 'Sum', 440, 50), 'A'); b.w(n, 'Y', led(b, 'Carry', 440, 170), 'A');
  const h = b.add('halfadder', 240, 320, {}, 'HA');
  b.w(a, 'Q', h, 'A'); b.w(c, 'Q', h, 'B');
  b.w(h, 'S', led(b, 'S (HA block)', 440, 320), 'A'); b.w(h, 'C', led(b, 'C (HA block)', 440, 400), 'A');
  return b.circuit();
}

function tFullAdderGates(): Circuit {
  const b = new B();
  const a = sw(b, 'A', 40, 40), c = sw(b, 'B', 40, 140), ci = sw(b, 'Cin', 40, 260);
  const x1 = gate(b, 'xor', 240, 60), x2 = gate(b, 'xor', 420, 100);
  b.w(a, 'Q', x1, 'A'); b.w(c, 'Q', x1, 'B'); b.w(x1, 'Y', x2, 'A'); b.w(ci, 'Q', x2, 'B');
  b.w(x2, 'Y', led(b, 'Sum', 600, 110), 'A');
  const g1 = gate(b, 'and', 240, 200), g2 = gate(b, 'and', 240, 280), g3 = gate(b, 'and', 240, 360), or = gate(b, 'or', 420, 280, 3);
  b.w(a, 'Q', g1, 'A'); b.w(c, 'Q', g1, 'B'); b.w(a, 'Q', g2, 'A'); b.w(ci, 'Q', g2, 'B'); b.w(c, 'Q', g3, 'A'); b.w(ci, 'Q', g3, 'B');
  b.w(g1, 'Y', or, 'A'); b.w(g2, 'Y', or, 'B'); b.w(g3, 'Y', or, 'C');
  b.w(or, 'Y', led(b, 'Cout', 600, 290), 'A');
  return b.circuit();
}

function tFullAdderHA(): Circuit {
  const b = new B();
  const x = sw(b, 'x', 40, 40), y = sw(b, 'y', 40, 140), z = sw(b, 'z', 40, 260);
  const h1 = b.add('halfadder', 220, 60, {}, 'HA 1'), h2 = b.add('halfadder', 400, 120, {}, 'HA 2'), or = gate(b, 'or', 600, 200);
  b.w(x, 'Q', h1, 'A'); b.w(y, 'Q', h1, 'B'); b.w(h1, 'S', h2, 'A'); b.w(z, 'Q', h2, 'B');
  b.w(h1, 'C', or, 'A'); b.w(h2, 'C', or, 'B');
  b.w(h2, 'S', led(b, 'S_F', 600, 110), 'A'); b.w(or, 'Y', led(b, 'C_F', 780, 210), 'A');
  return b.circuit();
}

function tEx5(): Circuit {
  const b = new B();
  const A = num(b, 'A', 40, 40, 2, 1), Bn = num(b, 'B', 40, 160, 2, 1), M = sw(b, 'M', 40, 300);
  const sa = split(b, 220, 40, 2), sb = split(b, 220, 160, 2);
  b.w(A, 'Q', sa, 'Bus'); b.w(Bn, 'Q', sb, 'Bus');
  const c0 = k(b, 220, 340, 1, 0, '0'), c1 = k(b, 220, 400, 1, 1, '1');
  const m0 = mux(b, 400, 160), m1 = mux(b, 400, 260);
  b.w(sb, 0, m0, 'D0'); b.w(c0, 'Q', m0, 'D1'); b.w(M, 'Q', m0, 'S');
  b.w(sb, 1, m1, 'D0'); b.w(c1, 'Q', m1, 'D1'); b.w(M, 'Q', m1, 'S');
  const f0 = b.add('fulladder', 580, 40, {}, 'FA0'), f1 = b.add('fulladder', 580, 200, {}, 'FA1');
  b.w(sa, 0, f0, 'A'); b.w(m0, 'Y', f0, 'B'); b.w(M, 'Q', f0, 'Cin');
  b.w(sa, 1, f1, 'A'); b.w(m1, 'Y', f1, 'B'); b.w(f0, 'Cout', f1, 'Cin');
  const mg = merge(b, 760, 100, 2);
  b.w(f0, 'S', mg, 0); b.w(f1, 'S', mg, 1);
  b.w(mg, 'Bus', hx(b, 'OUT', 920, 110, 2), 'A'); b.w(f1, 'Cout', led(b, 'Cout', 760, 260), 'A');
  return b.circuit();
}

function tEx6(): Circuit {
  const b = new B();
  const A = num(b, 'A', 40, 40, 2, 3), Bn = num(b, 'B', 40, 160, 2, 1), M = sw(b, 'M', 40, 300);
  const sa = split(b, 220, 40, 2), sb = split(b, 220, 160, 2);
  b.w(A, 'Q', sa, 'Bus'); b.w(Bn, 'Q', sb, 'Bus');
  const mg = merge(b, 1000, 120, 2);
  let carry = M;
  let cpin: string | number = 'Q';
  for (let i = 0; i < 2; i++) {
    const x = gate(b, 'xor', 400, 140 + i * 200);
    b.w(sb, i, x, 'A'); b.w(M, 'Q', x, 'B');
    const h1 = b.add('halfadder', 580, 60 + i * 200, {}, `HA ${i}a`), h2 = b.add('halfadder', 740, 60 + i * 200, {}, `HA ${i}b`), or = gate(b, 'or', 900, 100 + i * 200);
    b.w(sa, i, h1, 'A'); b.w(x, 'Y', h1, 'B'); b.w(h1, 'S', h2, 'A'); b.w(carry, cpin, h2, 'B');
    b.w(h1, 'C', or, 'A'); b.w(h2, 'C', or, 'B'); b.w(h2, 'S', mg, i);
    carry = or; cpin = 'Y';
  }
  b.w(mg, 'Bus', hx(b, 'OUT', 1140, 120, 2), 'A'); b.w(carry, cpin, led(b, 'Cout', 1060, 330), 'A');
  return b.circuit();
}

// ───────────── sequential ─────────────
function tFlipFlops(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40);
  // clocked SR flip-flop (SR latch gated by CLK)
  const S = sw(b, 'S', 40, 140), R = sw(b, 'R', 40, 220);
  const gs = gate(b, 'and', 200, 140), gr = gate(b, 'and', 200, 220), sr = b.add('srlatch', 360, 170, {}, 'SR FF');
  b.w(S, 'Q', gs, 'A'); b.w(clk, 'CLK', gs, 'B'); b.w(R, 'Q', gr, 'A'); b.w(clk, 'CLK', gr, 'B');
  b.w(gs, 'Y', sr, 'S'); b.w(gr, 'Y', sr, 'R');
  b.w(sr, 'Q', led(b, 'SR Q', 540, 170), 'A'); b.w(sr, 1, led(b, 'SR Q̅', 540, 230), 'A');
  const J = sw(b, 'J', 40, 340), K = sw(b, 'K', 40, 420), jk = b.add('jkff', 360, 340, {}, 'JK FF');
  b.w(J, 'Q', jk, 'J'); b.w(K, 'Q', jk, 'K'); b.w(clk, 'CLK', jk, 'CLK');
  b.w(jk, 'Q', led(b, 'JK Q', 540, 340), 'A'); b.w(jk, 1, led(b, 'JK Q̅', 540, 400), 'A');
  const D = sw(b, 'D', 40, 540), d = b.add('dff', 360, 540, {}, 'D FF');
  b.w(D, 'Q', d, 'D'); b.w(clk, 'CLK', d, 'CLK');
  b.w(d, 'Q', led(b, 'D Q', 540, 540), 'A'); b.w(d, 1, led(b, 'D Q̅', 540, 600), 'A');
  // T flip-flop, and T made from a JK with J=K=T
  const T = sw(b, 'T', 40, 700), t = b.add('tff', 360, 700, {}, 'T FF'), tj = b.add('jkff', 360, 860, {}, 'T from JK');
  b.w(T, 'Q', t, 'T'); b.w(clk, 'CLK', t, 'CLK');
  b.w(T, 'Q', tj, 'J'); b.w(T, 'Q', tj, 'K'); b.w(clk, 'CLK', tj, 'CLK');
  b.w(t, 'Q', led(b, 'T Q', 540, 700), 'A'); b.w(tj, 'Q', led(b, 'T(JK) Q', 540, 860), 'A');
  return b.circuit();
}

function tJkFromD(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), J = sw(b, 'J', 40, 160), K = sw(b, 'K', 40, 260);
  const mg = merge(b, 200, 200, 2); b.w(K, 'Q', mg, 0); b.w(J, 'Q', mg, 1);
  const d = b.add('dff', 560, 160, {}, 'D FF'), m = mux(b, 380, 120, 2, 1, 'MUX 4:1');
  const z = k(b, 200, 360, 1, 0, '0'), o = k(b, 200, 420, 1, 1, '1');
  b.w(d, 'Q', m, 'D0'); b.w(z, 'Q', m, 'D1'); b.w(o, 'Q', m, 'D2'); b.w(d, 1, m, 'D3');
  b.w(mg, 'Bus', m, 'S'); b.w(m, 'Y', d, 'D'); b.w(clk, 'CLK', d, 'CLK');
  b.w(d, 'Q', led(b, 'Q', 740, 160), 'A'); b.w(d, 1, led(b, 'Q̅', 740, 230), 'A');
  return b.circuit();
}

function tEx8Ripple(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 140), one = k(b, 300, 330, 1, 1, '1');
  const f = [0, 1, 2].map((i) => b.add('jkff', 400 + i * 220, 140, {}, `FF${i + 1}`));
  const or = gate(b, 'or', 220, 60);
  b.w(f[2], 'Q', or, 'A'); b.w(f[2], 1, or, 'B');
  b.w(or, 'Y', f[0], 'J'); b.w(f[2], 1, f[0], 'K'); b.w(clk, 'CLK', f[0], 'CLK');
  for (const i of [1, 2]) {
    b.w(one, 'Q', f[i], 'J'); b.w(one, 'Q', f[i], 'K'); b.w(f[i - 1], 'Q', f[i], 'CLK');
  }
  f.forEach((x, i) => b.w(x, 'Q', led(b, i === 2 ? 'out (Q3)' : `Q${i + 1}`, 480 + i * 220, 60 + (i === 2 ? 0 : 0)), 'A'));
  b.probe(clk, 0, 'CLK'); f.forEach((x, i) => b.probe(x, 0, `Q${i + 1}`));
  return b.circuit();
}

function tShiftSerial(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 200), si = sw(b, 'Serial In', 40, 100);
  let prev = si, pin: string | number = 'Q';
  for (let i = 0; i < 5; i++) {
    const d = b.add('dff', 240 + i * 180, 100, {}, `FF${i + 1}`);
    b.w(prev, pin, d, 'D'); b.w(clk, 'CLK', d, 'CLK');
    b.w(d, 'Q', led(b, `Q${i + 1}`, 280 + i * 180, 220), 'A');
    prev = d; pin = 'Q';
  }
  b.w(prev, 'Q', led(b, 'Serial Out', 1160, 110), 'A');
  b.probe(clk, 0, 'CLK'); b.probe(si, 0, 'Serial In');
  return b.circuit();
}

function tParallelReg(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), load = sw(b, 'Load', 40, 140, 1), data = num(b, 'D1-D8', 40, 260, 8, 0x5a);
  const g = gate(b, 'and', 240, 80), sp = split(b, 240, 260, 8), mg = merge(b, 900, 200, 8);
  b.w(clk, 'CLK', g, 'A'); b.w(load, 'Q', g, 'B'); b.w(data, 'Q', sp, 'Bus');
  for (let i = 0; i < 8; i++) {
    const d = b.add('dff', 440 + (i % 4) * 100, 60 + Math.floor(i / 4) * 200, {}, `FF${i}`);
    b.w(sp, i, d, 'D'); b.w(g, 'Y', d, 'CLK'); b.w(d, 'Q', mg, i);
  }
  b.w(mg, 'Bus', hx(b, 'Q (D01-D08)', 1060, 210, 8), 'A');
  return b.circuit();
}

function tBidir(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), clr = sw(b, 'Clear', 40, 130), S1 = sw(b, 'S1', 40, 220), S0 = sw(b, 'S0', 40, 300);
  const sir = sw(b, 'Serial in (right shift)', 40, 400), sil = sw(b, 'Serial in (left shift)', 40, 480), par = num(b, 'D1-D4', 40, 580, 4, 0xa);
  const sp = split(b, 220, 580, 4), sel = merge(b, 220, 250, 2), qm = merge(b, 940, 200, 4);
  b.w(S0, 'Q', sel, 0); b.w(S1, 'Q', sel, 1); b.w(par, 'Q', sp, 'Bus');
  const ff: string[] = [];
  for (let i = 0; i < 4; i++) ff.push(b.add('dff', 760, 60 + i * 130, {}, `Q${i + 1}`)); // Q1 = MSB
  ff.forEach((d, i) => {
    const m = mux(b, 560, 40 + i * 130, 2, 1, `MUX ${i + 1}`);
    b.w(d, 'Q', m, 'D0');
    if (i === 0) b.w(sir, 'Q', m, 'D1'); else b.w(ff[i - 1], 'Q', m, 'D1'); // shift right
    if (i === 3) b.w(sil, 'Q', m, 'D2'); else b.w(ff[i + 1], 'Q', m, 'D2'); // shift left
    b.w(sp, 3 - i, m, 'D3'); b.w(sel, 'Bus', m, 'S');
    b.w(m, 'Y', d, 'D'); b.w(clk, 'CLK', d, 'CLK'); b.w(clr, 'Q', d, 'CLR');
    b.w(d, 'Q', qm, 3 - i);
  });
  b.w(qm, 'Bus', hx(b, 'Q', 1080, 210, 4), 'A');
  return b.circuit();
}

function tSyncCounter(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 140), clr = sw(b, 'Clear', 40, 240), high = k(b, 40, 340, 1, 1, 'High');
  const mg = merge(b, 1000, 160, 4);
  let enable = high, epin: string | number = 'Q';
  for (let i = 0; i < 4; i++) {
    const f = b.add('jkff', 240 + i * 190, 140, {}, `FF${i}`);
    b.w(enable, epin, f, 'J'); b.w(enable, epin, f, 'K'); b.w(clk, 'CLK', f, 'CLK'); b.w(clr, 'Q', f, 'CLR');
    b.w(f, 'Q', led(b, `Q${i}`, 300 + i * 190, 330), 'A'); b.w(f, 'Q', mg, i);
    if (i < 3) {
      const g = gate(b, 'and', 380 + i * 190, 40);
      b.w(enable, epin, g, 'A'); b.w(f, 'Q', g, 'B');
      enable = g; epin = 'Y';
    }
  }
  b.w(mg, 'Bus', hx(b, 'COUNT', 1160, 170, 4), 'A');
  b.probe(clk, 0, 'CLK');
  return b.circuit();
}

function tEx8Counter(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), E = sw(b, 'E', 40, 160), x = sw(b, 'x', 40, 260);
  const fa = b.add('jkff', 560, 120, {}, 'A'), fb = b.add('jkff', 560, 320, {}, 'B');
  const xn = gate(b, 'xnor', 240, 260), an = gate(b, 'and', 400, 200);
  b.w(x, 'Q', xn, 'A'); b.w(fb, 'Q', xn, 'B'); b.w(E, 'Q', an, 'A'); b.w(xn, 'Y', an, 'B');
  b.w(an, 'Y', fa, 'J'); b.w(an, 'Y', fa, 'K'); b.w(E, 'Q', fb, 'J'); b.w(E, 'Q', fb, 'K');
  b.w(clk, 'CLK', fa, 'CLK'); b.w(clk, 'CLK', fb, 'CLK');
  b.w(fa, 'Q', led(b, 'Q_A', 740, 120), 'A'); b.w(fb, 'Q', led(b, 'Q_B', 740, 320), 'A');
  b.probe(clk, 0, 'CLK'); b.probe(fa, 0, 'A'); b.probe(fb, 0, 'B');
  return b.circuit();
}

function tMemBlocks(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), addr = num(b, 'Address', 40, 140, 4, 3), din = num(b, 'Data in', 40, 260, 8, 0x42), we = sw(b, 'Write', 40, 380);
  const ram = b.add('ram', 300, 140, { a: 4, w: 8 }, 'RAM 2^k × n');
  b.w(addr, 'Q', ram, 'ADDR'); b.w(din, 'Q', ram, 'DIN'); b.w(we, 'Q', ram, 'WE'); b.w(clk, 'CLK', ram, 'CLK');
  b.w(ram, 'DOUT', hx(b, 'RAM out', 520, 150, 8), 'A');
  const rom = b.add('rom', 300, 340, { a: 4, w: 8, data: [0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff] }, 'ROM 2^k × m');
  b.w(addr, 'Q', rom, 'ADDR');
  b.w(rom, 'DATA', hx(b, 'ROM out', 520, 350, 8), 'A');
  return b.circuit();
}

function tMem4096(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), addr = num(b, 'A11..A0', 40, 140, 12, 0), din = num(b, 'Data in', 40, 260, 8, 0), we = sw(b, 'Write', 40, 380);
  const lo = b.add('slice', 220, 140, { w: 12, lo: 0, n: 7 }, 'A6..A0'), mid = b.add('slice', 220, 240, { w: 12, lo: 7, n: 4 }, 'A10..A7'), top = b.add('slice', 220, 340, { w: 12, lo: 11, n: 1 }, 'A11');
  [lo, mid, top].forEach((s) => b.w(addr, 'Q', s, 'In'));
  // 5→32 decoder built from two 4→16 decoders enabled by A11
  const nt = not(b, 380, 340); b.w(top, 'Out', nt, 'A');
  const d0 = b.add('decoder', 420, 140, { n: 4 }, 'DEC A11=0'), d1 = b.add('decoder', 420, 440, { n: 4 }, 'DEC A11=1');
  b.w(mid, 'Out', d0, 'A'); b.w(mid, 'Out', d1, 'A'); b.w(nt, 'Y', d0, 'EN'); b.w(top, 'Out', d1, 'EN');
  const zero = k(b, 640, 40, 8, 0, '0');
  const ors = [0, 1, 2, 3].map((q) => gate(b, 'or', 1500, 160 + q * 300, 8, 8));
  for (let c = 0; c < 32; c++) {
    const sel: [string, string] = c < 16 ? [d0, 'Y' + c] : [d1, 'Y' + (c - 16)];
    const col = c % 8, row = Math.floor(c / 8);
    const ram = b.add('ram', 700 + col * 100, 80 + row * 300, { a: 7, w: 8 }, `RAM ${c}`);
    const ge = gate(b, 'and', 700 + col * 100, 200 + row * 300);
    const m = mux(b, 700 + col * 100, 250 + row * 300, 1, 8);
    b.w(lo, 'Out', ram, 'ADDR'); b.w(din, 'Q', ram, 'DIN'); b.w(clk, 'CLK', ram, 'CLK');
    b.w(we, 'Q', ge, 'A'); b.w(sel[0], sel[1], ge, 'B'); b.w(ge, 'Y', ram, 'WE');
    b.w(zero, 'Q', m, 'D0'); b.w(ram, 'DOUT', m, 'D1'); b.w(sel[0], sel[1], m, 'S');
    b.w(m, 'Y', ors[row], 'ABCDEFGH'[col]);
  }
  const fin = gate(b, 'or', 1700, 400, 4, 8);
  ors.forEach((o, i) => b.w(o, 'Y', fin, 'ABCD'[i]));
  b.w(fin, 'Y', hx(b, 'Data out', 1860, 410, 8), 'A');
  return b.circuit();
}

function tAsmFsm(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), rst = sw(b, 'RESET', 40, 130), x = sw(b, 'x', 40, 230);
  const nx = not(b, 200, 230); b.w(x, 'Q', nx, 'A');
  const m1 = mux(b, 400, 60, 2, 1, 'next Q0'), m2 = mux(b, 400, 260, 2, 1, 'next Q1'), z = k(b, 200, 380, 1, 0, '0');
  [0, 1, 2, 3].forEach((i) => b.w(nx, 'Y', m1, 'D' + i));
  b.w(z, 'Q', m2, 'D0'); b.w(x, 'Q', m2, 'D1'); b.w(nx, 'Y', m2, 'D2'); b.w(x, 'Q', m2, 'D3');
  const q0 = b.add('dff', 600, 60, {}, 'Q0'), q1 = b.add('dff', 600, 260, {}, 'Q1');
  b.w(m1, 'Y', q0, 'D'); b.w(m2, 'Y', q1, 'D');
  [q0, q1].forEach((q) => { b.w(clk, 'CLK', q, 'CLK'); b.w(rst, 'Q', q, 'CLR'); });
  const mg = merge(b, 760, 160, 2); b.w(q0, 'Q', mg, 0); b.w(q1, 'Q', mg, 1);
  b.w(mg, 'Bus', m1, 'S'); b.w(mg, 'Bus', m2, 'S');
  const dec = b.add('decoder', 900, 140, { n: 2 }, 'Dec');
  b.w(mg, 'Bus', dec, 'A');
  for (let i = 0; i < 4; i++) b.w(dec, 'Y' + i, led(b, 'M' + i, 1080, 60 + i * 70), 'A');
  b.probe(clk, 0, 'CLK'); b.probe(q0, 0, 'Q0'); b.probe(q1, 0, 'Q1');
  return b.circuit();
}

// ───────────── RTL datapaths ─────────────
function tRtl1(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), init = sw(b, 'INIT', 40, 130), rst = sw(b, 'RESET (T0)', 40, 560);
  const R1 = lreg(b, 'R1', 300, 40, 4, init, clk, 5);
  // T sequencer: counter stops at state 3 so each pass runs T1 then T2 once
  const ct = b.add('counter', 300, 560, { w: 2 }, 'T counter'), dec = b.add('decoder', 520, 560, { n: 2 }, 'T decode'), stop = not(b, 440, 700);
  b.w(clk, 'CLK', ct, 'CLK'); b.w(rst, 'Q', ct, 'CLR'); b.w(ct, 'Q', dec, 'A'); b.w(dec, 'Y3', stop, 'A'); b.w(stop, 'Y', ct, 'EN');
  const f = k(b, 300, 280, 4, 15, '1111'), one = k(b, 300, 340, 4, 1, '1');
  const nr = gate(b, 'xor', 480, 260, 2, 4), inc = b.add('adder', 480, 360, { w: 4 }, 'R1 + 1');
  const m = mux(b, 680, 300, 1, 4, 'T2 ? R1+1 : R1⊕1111');
  b.w(R1.r, 'Q', nr, 'A'); b.w(f, 'Q', nr, 'B'); b.w(R1.r, 'Q', inc, 'A'); b.w(one, 'Q', inc, 'B');
  b.w(nr, 'Y', m, 'D0'); b.w(inc, 'S', m, 'D1'); b.w(dec, 'Y2', m, 'S'); b.w(m, 'Y', R1.d, 'D0');
  const en = gate(b, 'or', 680, 480); b.w(dec, 'Y1', en, 'A'); b.w(dec, 'Y2', en, 'B'); b.w(en, 'Y', R1.en, 'B');
  b.w(R1.r, 'Q', hx(b, 'R1 =', 900, 50, 4), 'A');
  return b.circuit();
}

function tRtl2(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), init = sw(b, 'INIT', 40, 130), x = sw(b, 'x', 40, 400), y = sw(b, 'y', 40, 480);
  const R1 = lreg(b, 'R1', 300, 40, 4, init, clk, 5);
  const dec = k(b, 300, 280, 4, 15, '1111'), add = b.add('adder', 480, 260, { w: 4 }, 'R1 − 1');
  b.w(R1.r, 'Q', add, 'A'); b.w(dec, 'Q', add, 'B'); b.w(add, 'S', R1.d, 'D0');
  const or = gate(b, 'or', 480, 440); b.w(x, 'Q', or, 'A'); b.w(y, 'Q', or, 'B'); b.w(or, 'Y', R1.en, 'B');
  b.w(R1.r, 'Q', hx(b, 'R1 =', 760, 50, 4), 'A');
  return b.circuit();
}

function tRtl3(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), init = sw(b, 'INIT', 40, 130), x = sw(b, 'x', 40, 400), M0 = sw(b, 'μ0', 40, 480), R2 = num(b, 'R2', 40, 300, 4, 3);
  const R1 = lreg(b, 'R1', 300, 40, 4, init, clk, 5);
  const f = k(b, 300, 280, 4, 15, '1111'), nr2 = gate(b, 'xor', 480, 260, 2, 4), m = mux(b, 660, 260, 1, 4, 'x ? R2 : R2\'');
  b.w(R2, 'Q', nr2, 'A'); b.w(f, 'Q', nr2, 'B'); b.w(nr2, 'Y', m, 'D0'); b.w(R2, 'Q', m, 'D1'); b.w(x, 'Q', m, 'S');
  const add = b.add('adder', 840, 120, { w: 4 }, 'R1 + (…)');
  b.w(R1.r, 'Q', add, 'A'); b.w(m, 'Y', add, 'B'); b.w(add, 'S', R1.d, 'D0'); b.w(M0, 'Q', R1.en, 'B');
  b.w(R1.r, 'Q', hx(b, 'R1 =', 1000, 50, 4), 'A');
  return b.circuit();
}

function tRtl4(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), init = sw(b, 'INIT', 40, 130), M0 = sw(b, 'μ0', 40, 560), M1 = sw(b, 'μ1', 40, 640);
  const R1 = lreg(b, 'R1', 300, 40, 4, init, clk, 6), R2 = lreg(b, 'R2', 300, 400, 4, init, clk, 6);
  const f = k(b, 560, 260, 4, 15, '1111'), zero = k(b, 560, 560, 4, 0, '0000');
  const eq = b.add('comparator', 560, 100, { w: 4 }, 'R1 = R2'), nr2 = gate(b, 'xor', 560, 330, 2, 4), mb = mux(b, 740, 330, 1, 4, 'eq ? R2\' : R2');
  b.w(R1.r, 'Q', eq, 'A'); b.w(R2.r, 'Q', eq, 'B');
  b.w(R2.r, 'Q', nr2, 'A'); b.w(f, 'Q', nr2, 'B'); b.w(R2.r, 'Q', mb, 'D0'); b.w(nr2, 'Y', mb, 'D1'); b.w(eq, 1, mb, 'S');
  const add = b.add('adder', 920, 200, { w: 4 }, 'R1 ± R2');
  b.w(R1.r, 'Q', add, 'A'); b.w(mb, 'Y', add, 'B'); b.w(eq, 1, add, 'Cin'); b.w(add, 'S', R1.d, 'D0'); b.w(M0, 'Q', R1.en, 'B');
  // μ1: if (R1 = 0) then R2 ← R1 else R2 ← 0
  const z = b.add('comparator', 560, 440, { w: 4 }, 'R1 = 0'), m2 = mux(b, 740, 440, 1, 4, 'R1=0 ? R1 : 0');
  b.w(R1.r, 'Q', z, 'A'); b.w(zero, 'Q', z, 'B'); b.w(zero, 'Q', m2, 'D0'); b.w(R1.r, 'Q', m2, 'D1'); b.w(z, 1, m2, 'S');
  b.w(m2, 'Y', R2.d, 'D0'); b.w(M1, 'Q', R2.en, 'B');
  b.w(R1.r, 'Q', hx(b, 'R1 =', 1100, 50, 4), 'A'); b.w(R2.r, 'Q', hx(b, 'R2 =', 1100, 400, 4), 'A');
  return b.circuit();
}

function tRtl5(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), init = sw(b, 'INIT', 40, 130), T0 = sw(b, 'T0', 40, 640), T1 = sw(b, 'T1', 40, 720);
  const R1 = lreg(b, 'R1', 300, 40, 4, init, clk, 0), R2 = lreg(b, 'R2', 300, 400, 4, init, clk, 5), R3 = lreg(b, 'R3', 300, 600, 4, init, clk, 0);
  const zero = k(b, 560, 260, 4, 0, '0000');
  const c1 = b.add('comparator', 560, 120, { w: 4 }, 'R1 = 0'), c2 = b.add('comparator', 560, 400, { w: 4 }, 'R2 = 0'), z = gate(b, 'or', 760, 260);
  b.w(R1.r, 'Q', c1, 'A'); b.w(zero, 'Q', c1, 'B'); b.w(R2.r, 'Q', c2, 'A'); b.w(zero, 'Q', c2, 'B');
  b.w(c1, 1, z, 'A'); b.w(c2, 1, z, 'B');
  const m = mux(b, 900, 260, 1, 4, '(R1=0 ∨ R2=0) ? 0 : R2');
  b.w(R2.r, 'Q', m, 'D0'); b.w(zero, 'Q', m, 'D1'); b.w(z, 'Y', m, 'S');
  b.w(m, 'Y', R1.d, 'D0'); b.w(m, 'Y', R3.d, 'D0');
  const e1 = gate(b, 'or', 560, 680), nT1 = not(b, 400, 780), e3 = gate(b, 'or', 560, 760);
  b.w(T0, 'Q', e1, 'A'); b.w(T1, 'Q', e1, 'B'); b.w(e1, 'Y', R1.en, 'B');
  b.w(T1, 'Q', nT1, 'A'); b.w(T0, 'Q', e3, 'A'); b.w(nT1, 'Y', e3, 'B'); b.w(e3, 'Y', R3.en, 'B');
  [R1, R2, R3].forEach((r, i) => b.w(r.r, 'Q', hx(b, 'R' + (i + 1) + ' =', 1100, 50 + i * 200, 4), 'A'));
  return b.circuit();
}

function tBusMux2(): Circuit {
  const b = new B();
  const R1 = num(b, 'R1', 40, 40, 4, 0x3), R2 = num(b, 'R2', 40, 160, 4, 0xc), x = sw(b, 'x (0→R1, 1→R2)', 40, 280);
  const m = mux(b, 300, 80, 1, 4, 'bus mux');
  b.w(R1, 'Q', m, 'D0'); b.w(R2, 'Q', m, 'D1'); b.w(x, 'Q', m, 'S');
  b.w(m, 'Y', hx(b, 'BUS', 500, 90, 4), 'A');
  return b.circuit();
}

function tBusMux4(): Circuit {
  const b = new B();
  const names = ['A', 'B', 'C', 'D'], vals = [0x1, 0x2, 0x4, 0x8];
  const regs = names.map((n, i) => num(b, 'Reg ' + n, 40, 40 + i * 100, 4, vals[i]));
  const S1 = sw(b, 'S1', 40, 460), S0 = sw(b, 'S0', 40, 540), sel = merge(b, 220, 480, 2), m = mux(b, 380, 160, 2, 4, '4-bit 4:1 mux');
  b.w(S0, 'Q', sel, 0); b.w(S1, 'Q', sel, 1); b.w(sel, 'Bus', m, 'S');
  regs.forEach((r, i) => b.w(r, 'Q', m, 'D' + i));
  b.w(m, 'Y', hx(b, 'BUS', 580, 170, 4), 'A');
  return b.circuit();
}

function tBusDec(): Circuit {
  const b = new B();
  const regs = ['A', 'B', 'C', 'D'].map((n, i) => num(b, 'Reg ' + n, 40, 40 + i * 110, 4, [1, 2, 4, 8][i]));
  const S1 = sw(b, 'S1', 40, 500), S0 = sw(b, 'S0', 40, 580), en = sw(b, 'Enable', 40, 660, 1), sel = merge(b, 220, 520, 2);
  const dec = b.add('decoder', 380, 520, { n: 2 }); const z = k(b, 380, 40, 4, 0, '0');
  b.w(S0, 'Q', sel, 0); b.w(S1, 'Q', sel, 1); b.w(sel, 'Bus', dec, 'A'); b.w(en, 'Q', dec, 'EN');
  const or = gate(b, 'or', 800, 200, 4, 4);
  regs.forEach((r, i) => {
    // a three-state buffer, modelled as "drive the bus or drive 0"
    const m = mux(b, 600, 40 + i * 110, 1, 4, `driver ${'ABCD'[i]}`);
    b.w(z, 'Q', m, 'D0'); b.w(r, 'Q', m, 'D1'); b.w(dec, 'Y' + i, m, 'S'); b.w(m, 'Y', or, 'ABCD'[i]);
  });
  b.w(or, 'Y', hx(b, 'BUS', 960, 210, 4), 'A');
  return b.circuit();
}

// ───────────── arithmetic / ALU ─────────────
function tArithEx6(): Circuit {
  const b = new B();
  const A = num(b, 'A', 40, 40, 4, 5), Bn = num(b, 'B', 40, 140, 4, 3), C = sw(b, 'C', 40, 260), S = sw(b, 'S', 40, 340);
  const f = k(b, 220, 40, 4, 15, '1111'), nb = gate(b, 'xor', 220, 140, 2, 4), mb = mux(b, 400, 100, 1, 4, 'B input'), or = gate(b, 'or', 400, 300);
  b.w(Bn, 'Q', nb, 'A'); b.w(f, 'Q', nb, 'B'); b.w(f, 'Q', mb, 'D0'); b.w(nb, 'Y', mb, 'D1'); b.w(S, 'Q', mb, 'S');
  b.w(S, 'Q', or, 'A'); b.w(C, 'Q', or, 'B');
  const add = b.add('adder', 580, 120, { w: 4 }, 'FA chain');
  b.w(A, 'Q', add, 'A'); b.w(mb, 'Y', add, 'B'); b.w(or, 'Y', add, 'Cin');
  b.w(add, 'S', hx(b, 'F', 760, 120, 4), 'A'); b.w(add, 'Cout', led(b, 'Cout', 760, 220), 'A');
  return b.circuit();
}

/** n-bit chain of per-bit cells; cell(i, carryId, carryPin) returns {s, c} component refs. */
function tAdder4(): Circuit {
  const b = new B();
  const A = num(b, 'A', 40, 40, 4, 9), Bn = num(b, 'B', 40, 160, 4, 5), C0 = sw(b, 'C0', 40, 300);
  const sa = split(b, 200, 40, 4), sb = split(b, 200, 160, 4), mg = merge(b, 980, 160, 4);
  b.w(A, 'Q', sa, 'Bus'); b.w(Bn, 'Q', sb, 'Bus');
  let c = C0, cp: string | number = 'Q';
  for (let i = 0; i < 4; i++) {
    const f = b.add('fulladder', 760 - i * 190, 100 + (i % 2) * 140, {}, `FA${i}`);
    b.w(sa, i, f, 'A'); b.w(sb, i, f, 'B'); b.w(c, cp, f, 'Cin'); b.w(f, 'S', mg, i);
    c = f; cp = 'Cout';
  }
  b.w(mg, 'Bus', hx(b, 'S', 1140, 170, 4), 'A'); b.w(c, cp, led(b, 'C4', 980, 330), 'A');
  return b.circuit();
}

function tAddSub4(): Circuit {
  const b = new B();
  const A = num(b, 'A', 40, 40, 4, 9), Bn = num(b, 'B', 40, 160, 4, 5), M = sw(b, 'M (0=add, 1=subtract)', 40, 300);
  const sa = split(b, 200, 40, 4), sb = split(b, 200, 160, 4), mg = merge(b, 1000, 160, 4);
  b.w(A, 'Q', sa, 'Bus'); b.w(Bn, 'Q', sb, 'Bus');
  let c = M, cp: string | number = 'Q';
  for (let i = 0; i < 4; i++) {
    const x = gate(b, 'xor', 380 + i * 0, 120 + i * 90 - 60);
    b.w(sb, i, x, 'A'); b.w(M, 'Q', x, 'B');
    const f = b.add('fulladder', 560 + i * 110, 60 + i * 90, {}, `FA${i}`);
    b.w(sa, i, f, 'A'); b.w(x, 'Y', f, 'B'); b.w(c, cp, f, 'Cin'); b.w(f, 'S', mg, i);
    c = f; cp = 'Cout';
  }
  b.w(mg, 'Bus', hx(b, 'S', 1160, 170, 4), 'A'); b.w(c, cp, led(b, 'C4', 1000, 360), 'A');
  return b.circuit();
}

function tIncrementer(): Circuit {
  const b = new B();
  const A = num(b, 'A', 40, 40, 4, 9), one = k(b, 40, 200, 1, 1, '1');
  const sa = split(b, 200, 40, 4), mg = merge(b, 900, 160, 4);
  b.w(A, 'Q', sa, 'Bus');
  let c = one, cp: string | number = 'Q';
  for (let i = 0; i < 4; i++) {
    const h = b.add('halfadder', 380 + i * 130, 60 + i * 70, {}, `HA${i}`);
    b.w(sa, i, h, 'A'); b.w(c, cp, h, 'B'); b.w(h, 'S', mg, i);
    c = h; cp = 'C';
  }
  b.w(mg, 'Bus', hx(b, 'A + 1', 1060, 170, 4), 'A'); b.w(c, cp, led(b, 'C4', 900, 330), 'A');
  return b.circuit();
}

function tArith2Stage(): Circuit {
  const b = new B();
  const A = num(b, 'A', 40, 40, 2, 1), Bn = num(b, 'B', 40, 140, 2, 2), S1 = sw(b, 'S1', 40, 260), S0 = sw(b, 'S0', 40, 340), Cin = sw(b, 'Cin', 40, 440);
  const sa = split(b, 200, 40, 2), sb = split(b, 200, 140, 2), sel = merge(b, 200, 280, 2), mg = merge(b, 940, 120, 2);
  b.w(A, 'Q', sa, 'Bus'); b.w(Bn, 'Q', sb, 'Bus'); b.w(S0, 'Q', sel, 0); b.w(S1, 'Q', sel, 1);
  const z = k(b, 200, 480, 1, 0, '0'), o = k(b, 200, 540, 1, 1, '1');
  let c = Cin, cp: string | number = 'Q';
  for (let i = 0; i < 2; i++) {
    const nb = not(b, 380, 140 + i * 300), m = mux(b, 520, 100 + i * 300, 2, 1, `4×1 MUX ${i}`), f = b.add('fulladder', 740, 100 + i * 300, {}, `FA${i}`);
    b.w(sb, i, nb, 'A'); b.w(sb, i, m, 'D0'); b.w(nb, 'Y', m, 'D1'); b.w(z, 'Q', m, 'D2'); b.w(o, 'Q', m, 'D3'); b.w(sel, 'Bus', m, 'S');
    b.w(sa, i, f, 'A'); b.w(m, 'Y', f, 'B'); b.w(c, cp, f, 'Cin'); b.w(f, 'S', mg, i);
    c = f; cp = 'Cout';
  }
  b.w(mg, 'Bus', hx(b, 'D', 1100, 130, 2), 'A'); b.w(c, cp, led(b, 'Cout', 940, 380), 'A');
  return b.circuit();
}

function tLogicStage(): Circuit {
  const b = new B();
  const A = sw(b, 'A', 40, 40, 1), Bs = sw(b, 'B', 40, 140), S1 = sw(b, 'S1', 40, 260), S0 = sw(b, 'S0', 40, 340);
  const sel = merge(b, 200, 280, 2); b.w(S0, 'Q', sel, 0); b.w(S1, 'Q', sel, 1);
  const m = mux(b, 520, 100, 2, 1, 'logic 4×1');
  (['and', 'or', 'xor'] as const).forEach((t, i) => { const g = gate(b, t, 340, 40 + i * 80); b.w(A, 'Q', g, 'A'); b.w(Bs, 'Q', g, 'B'); b.w(g, 'Y', m, 'D' + i); });
  const n = not(b, 340, 280); b.w(A, 'Q', n, 'A'); b.w(n, 'Y', m, 'D3'); b.w(sel, 'Bus', m, 'S');
  b.w(m, 'Y', led(b, 'E (S: 00 AND · 01 OR · 10 XOR · 11 NOT)', 700, 110), 'A');
  return b.circuit();
}

function tShifter(): Circuit {
  const b = new B();
  const A = num(b, 'A0-A3', 40, 40, 4, 6), S = sw(b, 'S (0=right, 1=left)', 40, 160), IR = sw(b, 'Serial in I_R', 40, 260), IL = sw(b, 'Serial in I_L', 40, 340);
  const sa = split(b, 220, 40, 4), mg = merge(b, 760, 120, 4);
  b.w(A, 'Q', sa, 'Bus');
  for (let i = 0; i < 4; i++) {
    const m = mux(b, 480, 40 + i * 100, 1, 1, `H${i}`);
    if (i === 0) b.w(IR, 'Q', m, 'D0'); else b.w(sa, i - 1, m, 'D0');
    if (i === 3) b.w(IL, 'Q', m, 'D1'); else b.w(sa, i + 1, m, 'D1');
    b.w(S, 'Q', m, 'S'); b.w(m, 'Y', mg, i);
  }
  b.w(mg, 'Bus', hx(b, 'H0-H3', 920, 130, 4), 'A');
  return b.circuit();
}

function tAlu4(): Circuit {
  const b = new B();
  const A = num(b, 'A', 40, 40, 4, 6), Bn = num(b, 'B', 40, 140, 4, 3);
  const S = [0, 1, 2, 3].map((i) => sw(b, 'S' + i, 40, 260 + i * 70)), cin = sw(b, 'Cin (arith)', 40, 560);
  // arithmetic: B-input select via {S1,S0}: 00 B · 01 B' · 10 0 · 11 1…1
  const s10 = merge(b, 200, 300, 2); b.w(S[0], 'Q', s10, 0); b.w(S[1], 'Q', s10, 1);
  const s32 = merge(b, 200, 400, 2); b.w(S[2], 'Q', s32, 0); b.w(S[3], 'Q', s32, 1);
  const f = k(b, 380, 40, 4, 15, '1111'), z = k(b, 380, 100, 4, 0, '0000'), nb = gate(b, 'xor', 380, 150, 2, 4);
  b.w(Bn, 'Q', nb, 'A'); b.w(f, 'Q', nb, 'B');
  const mb = mux(b, 560, 60, 2, 4, 'B select'), add = b.add('adder', 740, 60, { w: 4 }, 'arithmetic');
  b.w(Bn, 'Q', mb, 'D0'); b.w(nb, 'Y', mb, 'D1'); b.w(z, 'Q', mb, 'D2'); b.w(f, 'Q', mb, 'D3'); b.w(s10, 'Bus', mb, 'S');
  b.w(A, 'Q', add, 'A'); b.w(mb, 'Y', add, 'B'); b.w(cin, 'Q', add, 'Cin');
  // logic
  const ga = gate(b, 'and', 560, 260, 2, 4), go = gate(b, 'or', 560, 340, 2, 4), gx = gate(b, 'xor', 560, 420, 2, 4), gn = not(b, 560, 500, 4);
  [ga, go, gx].forEach((g) => { b.w(A, 'Q', g, 'A'); b.w(Bn, 'Q', g, 'B'); }); b.w(A, 'Q', gn, 'A');
  const ml = mux(b, 740, 300, 2, 4, 'logic select');
  b.w(ga, 'Y', ml, 'D0'); b.w(go, 'Y', ml, 'D1'); b.w(gx, 'Y', ml, 'D2'); b.w(gn, 'Y', ml, 'D3'); b.w(s10, 'Bus', ml, 'S');
  // shifts: shr A (serial in 0), shl A (serial in 0)
  const sa = split(b, 380, 600, 4), shr = merge(b, 560, 600, 4), shl = merge(b, 560, 720, 4), zb = k(b, 380, 700, 1, 0, '0');
  b.w(A, 'Q', sa, 'Bus');
  for (let i = 0; i < 4; i++) {
    if (i < 3) b.w(sa, i + 1, shr, i); else b.w(zb, 'Q', shr, i);
    if (i > 0) b.w(sa, i - 1, shl, i); else b.w(zb, 'Q', shl, i);
  }
  const out = mux(b, 960, 260, 2, 4, 'output select (S3 S2)');
  b.w(add, 'S', out, 'D0'); b.w(ml, 'Y', out, 'D1'); b.w(shr, 'Bus', out, 'D2'); b.w(shl, 'Bus', out, 'D3'); b.w(s32, 'Bus', out, 'S');
  b.w(out, 'Y', hx(b, 'F', 1140, 270, 4), 'A'); b.w(add, 'Cout', led(b, 'Cout', 920, 100), 'A');
  return b.circuit();
}

function tArithUnit7(): Circuit {
  const b = new B();
  const A = num(b, 'A', 40, 40, 4, 6), Bn = num(b, 'B', 40, 140, 4, 3), S = sw(b, 'S', 40, 260), Cin = sw(b, 'Cin', 40, 340);
  const sel = merge(b, 200, 280, 2); b.w(Cin, 'Q', sel, 0); b.w(S, 'Q', sel, 1);
  const f = k(b, 200, 440, 4, 15, '1111'), z = k(b, 200, 500, 4, 0, '0000'), nb = gate(b, 'xor', 380, 120, 2, 4);
  b.w(Bn, 'Q', nb, 'A'); b.w(f, 'Q', nb, 'B');
  const m = mux(b, 560, 80, 2, 4, '4×1 MUX'), add = b.add('adder', 740, 80, { w: 4 }, 'FA');
  b.w(Bn, 'Q', m, 'D0'); b.w(z, 'Q', m, 'D1'); b.w(f, 'Q', m, 'D2'); b.w(nb, 'Y', m, 'D3'); b.w(sel, 'Bus', m, 'S');
  b.w(A, 'Q', add, 'A'); b.w(m, 'Y', add, 'B'); b.w(Cin, 'Q', add, 'Cin');
  b.w(add, 'S', hx(b, 'D  (00: A+B · 01: A+1 · 10: A−1 · 11: A−B)', 920, 90, 4), 'A'); b.w(add, 'Cout', led(b, 'Cout', 920, 200), 'A');
  return b.circuit();
}

function tChainedSub(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), R1 = num(b, 'R1', 40, 140, 4, 9), R2 = num(b, 'R2', 40, 240, 4, 7), f = k(b, 40, 340, 4, 15, '1111');
  const x = gate(b, 'xor', 240, 240, 2, 4), add = b.add('adder', 420, 140, { w: 4 }, '4-bit adder'), cf = b.add('dff', 240, 400, {}, 'Cin flip-flop');
  b.w(R2, 'Q', x, 'A'); b.w(f, 'Q', x, 'B'); b.w(R1, 'Q', add, 'A'); b.w(x, 'Y', add, 'B'); b.w(cf, 'Q', add, 'Cin');
  b.w(add, 'Cout', cf, 'D'); b.w(clk, 'CLK', cf, 'CLK');
  b.w(add, 'S', hx(b, 'OUT', 600, 150, 4), 'A'); b.w(add, 'Cout', led(b, 'Cout', 600, 260), 'A'); b.w(cf, 'Q', led(b, 'Cin', 400, 420), 'A');
  return b.circuit();
}

function tRtl8(): Circuit {
  const b = new B();
  const R1 = num(b, 'R1', 40, 40, 4, 7), R2 = num(b, 'R2', 40, 200, 4, 3), x = sw(b, 'x', 40, 340), y = sw(b, 'y', 40, 420);
  const f = k(b, 220, 40, 4, 15, '1111'), nr2 = gate(b, 'xor', 220, 200, 2, 4);
  b.w(R2, 'Q', nr2, 'A'); b.w(f, 'Q', nr2, 'B');
  const ma = mux(b, 420, 60, 1, 4, 'x ? 1…1 : R1'), mb = mux(b, 420, 240, 1, 4, 'y ? 1…1 : R2\'');
  b.w(R1, 'Q', ma, 'D0'); b.w(f, 'Q', ma, 'D1'); b.w(x, 'Q', ma, 'S');
  b.w(nr2, 'Y', mb, 'D0'); b.w(f, 'Q', mb, 'D1'); b.w(y, 'Q', mb, 'S');
  const c = gate(b, 'or', 580, 420), add = b.add('adder', 600, 120, { w: 4 }, 'FA');
  // Cin = x̄ + y  (the slide's OR gate)
  const nx = not(b, 420, 480); b.w(x, 'Q', nx, 'A'); b.w(nx, 'Y', c, 'A'); b.w(y, 'Q', c, 'B');
  b.w(ma, 'Y', add, 'A'); b.w(mb, 'Y', add, 'B'); b.w(c, 'Y', add, 'Cin');
  b.w(add, 'S', hx(b, 'R3 (next)', 780, 130, 4), 'A');
  return b.circuit();
}

function tClockCount(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), init = sw(b, 'INIT', 40, 130), rst = sw(b, 'RESET (T0)', 40, 560);
  const ct = b.add('counter', 300, 560, { w: 3 }, 'T counter'), dec = b.add('decoder', 500, 560, { n: 3 }, 'T0…T4');
  b.w(clk, 'CLK', ct, 'CLK'); b.w(rst, 'Q', ct, 'CLR'); b.w(ct, 'Q', dec, 'A');
  // hold at T5 so the sequence runs once
  const t5 = not(b, 500, 760); b.w(dec, 'Y5', t5, 'A'); b.w(t5, 'Y', ct, 'EN');
  const R1 = lreg(b, 'R1', 300, 40, 4, init, clk, 6), R2 = b.add('reg', 560, 300, { w: 4 }, 'R2'), A = b.add('reg', 560, 140, { w: 4 }, 'A'), Bq = b.add('reg', 560, 460, { w: 4 }, 'B');
  const f = k(b, 300, 340, 4, 15, '1111'), nb = gate(b, 'xor', 300, 420, 2, 4), add = b.add('adder', 760, 260, { w: 4 }, 'A + B + Cin');
  b.w(R2, 'Q', nb, 'A'); b.w(f, 'Q', nb, 'B');
  // B input: T1 → 1…1, T3 → R2'
  const mbSel = gate(b, 'or', 440, 700), mB = mux(b, 360, 460, 1, 4, 'B source');
  b.w(R2, 'Q', nb, 'A');
  b.w(f, 'Q', mB, 'D0'); b.w(nb, 'Y', mB, 'D1'); b.w(dec, 'Y3', mB, 'S'); b.w(mB, 'Y', Bq, 'D');
  b.w(dec, 'Y1', mbSel, 'A'); b.w(dec, 'Y3', mbSel, 'B'); b.w(mbSel, 'Y', Bq, 'EN');
  b.w(R1.r, 'Q', A, 'D'); b.w(dec, 'Y0', A, 'EN');
  b.w(A, 'Q', add, 'A'); b.w(Bq, 'Q', add, 'B'); b.w(dec, 'Y4', add, 'Cin');
  // T2: R2 ← A + B ; T4: R1 ← A + B + 1
  b.w(add, 'S', R2, 'D'); b.w(dec, 'Y2', R2, 'EN');
  b.w(add, 'S', R1.d, 'D0'); b.w(dec, 'Y4', R1.en, 'B');
  for (const r of [A, Bq]) { b.w(clk, 'CLK', r, 'CLK'); }
  b.w(clk, 'CLK', R2, 'CLK');
  b.w(R1.r, 'Q', hx(b, 'R1 =', 960, 50, 4), 'A'); b.w(R2, 'Q', hx(b, 'R2 =', 960, 300, 4), 'A');
  return b.circuit();
}

function tRtl9(): Circuit {
  const b = new B();
  const clk = clock(b, 40, 40), init = sw(b, 'INIT', 40, 130), T = sw(b, 'T', 40, 600);
  const R1 = lreg(b, 'R1', 300, 40, 4, init, clk, 0), R3 = lreg(b, 'R3', 300, 400, 4, init, clk, 2), R2 = num(b, 'R2', 40, 300, 4, 9);
  const zero = k(b, 560, 40, 4, 0, '0000'), f = k(b, 560, 400, 4, 15, '1111');
  const z = b.add('comparator', 560, 120, { w: 4 }, 'R1 = 0'), m = mux(b, 740, 200, 1, 4, 'R1=0 ? R2 : R1'), nr3 = gate(b, 'xor', 740, 400, 2, 4);
  b.w(R1.r, 'Q', z, 'A'); b.w(zero, 'Q', z, 'B'); b.w(R1.r, 'Q', m, 'D0'); b.w(R2, 'Q', m, 'D1'); b.w(z, 1, m, 'S');
  b.w(R3.r, 'Q', nr3, 'A'); b.w(f, 'Q', nr3, 'B');
  const add = b.add('adder', 920, 260, { w: 4 }, 'FA'), one = k(b, 740, 520, 1, 1, '1');
  b.w(m, 'Y', add, 'A'); b.w(nr3, 'Y', add, 'B'); b.w(one, 'Q', add, 'Cin'); b.w(add, 'S', R3.d, 'D0'); b.w(T, 'Q', R3.en, 'B');
  // T̄: R1 ← R2
  const nT = not(b, 40, 680); b.w(T, 'Q', nT, 'A'); b.w(R2, 'Q', R1.d, 'D0'); b.w(nT, 'Y', R1.en, 'B');
  b.w(R1.r, 'Q', hx(b, 'R1 =', 1100, 50, 4), 'A'); b.w(R3.r, 'Q', hx(b, 'R3 =', 1100, 400, 4), 'A');
  return b.circuit();
}

// ───────────── Boolean algebra / truth tables / minterms ─────────────
type Ref = [string, string | number];
/** Tiny helper for LHS/RHS equivalence circuits: inputs are switches, results go to LEDs. */
class Alg {
  in: Record<string, string> = {};
  private neg: Record<string, string> = {};
  constructor(readonly b: B, names: string[]) {
    names.forEach((n, i) => { this.in[n] = sw(b, n, 40, 40 + i * 90); });
  }
  lit(l: string): Ref {
    if (!l.endsWith("'")) return [this.in[l], 'Q'];
    const v = l.slice(0, -1);
    if (!this.neg[v]) { this.neg[v] = not(this.b, 200, 60 + Object.keys(this.neg).length * 90); this.b.w(this.in[v], 'Q', this.neg[v], 'A'); }
    return [this.neg[v], 'Y'];
  }
  g(t: string, ins: Ref[], y: number, x = 420): Ref {
    const n = gate(this.b, t, x, y, ins.length);
    ins.forEach(([c, p], i) => this.b.w(c, p, n, 'ABCDEFGH'[i]));
    return [n, 'Y'];
  }
  /** sum of products, e.g. ["A'B", "AB'C"] */
  sop(terms: string[], y: number): Ref {
    const prods = terms.map((t, i) => {
      const lits = t.match(/[A-Z]'?/g)!.map((l) => this.lit(l));
      return lits.length === 1 ? lits[0] : this.g('and', lits, y + i * 70);
    });
    return prods.length === 1 ? prods[0] : this.g('or', prods, y + (terms.length - 1) * 35, 620);
  }
  out(r: Ref, name: string, y: number) { this.b.w(r[0], r[1], led(this.b, name, 820, y), 'A'); }
}

function tBoolLaws(): Circuit {
  const b = new B(), a = new Alg(b, ['A', 'B', 'C']);
  const L = (s: string) => a.lit(s), G = (t: string, i: Ref[], x = 420) => a.g(t, i, 0, x);
  const rows: [string, Ref, Ref][] = [
    ["De Morgan: (AB)' | A'+B'", G('nand', [L('A'), L('B')]), G('or', [L("A'"), L("B'")])],
    ["De Morgan: (A+B)' | A'B'", G('nor', [L('A'), L('B')]), G('and', [L("A'"), L("B'")])],
    ['Distributive: A(B+C) | AB+AC', G('and', [L('A'), G('or', [L('B'), L('C')])], 620), G('or', [G('and', [L('A'), L('B')]), G('and', [L('A'), L('C')])], 620)],
    ['Distributive: A+BC | (A+B)(A+C)', G('or', [L('A'), G('and', [L('B'), L('C')])], 620), G('and', [G('or', [L('A'), L('B')]), G('or', [L('A'), L('C')])], 620)],
    ['Absorption: A+AB | A', G('or', [L('A'), G('and', [L('A'), L('B')])], 620), L('A')],
    ["Inverse: A+A' | 1", G('or', [L('A'), L("A'")]), [k(b, 420, 0, 1, 1, '1'), 'Q']],
    ["Inverse: A·A' | 0", G('and', [L('A'), L("A'")]), [k(b, 420, 0, 1, 0, '0'), 'Q']],
  ];
  rows.forEach(([name, l, r], i) => { a.out(l, name + ' (LHS)', 20 + i * 110); a.out(r, name + ' (RHS)', 70 + i * 110); });
  return b.circuit();
}

function simplifyPair(terms: string[], simple: string, names: string[], full: string): Circuit {
  const b = new B(), a = new Alg(b, names);
  a.out(a.sop(terms, 20), full, 40);
  const lits = simple.match(/[A-Z]'?/g)!.map((l) => a.lit(l));
  a.out(lits.length > 1 ? a.g('and', lits, 360) : lits[0], simple + ' (simplified)', 380);
  return b.circuit();
}
const tAlg1a = () => simplifyPair(["A'B", "ABC'", 'ABC'], 'B', ['A', 'B', 'C'], "A'B + ABC' + ABC");
const tAlg1b = () => simplifyPair(["ABC'", "B'C'", "A'BC'", "AC'"], "C'", ['A', 'B', 'C'], "ABC' + B'C' + A'BC' + AC'");

function tAlgConst1(): Circuit {
  const b = new B(), a = new Alg(b, ['C', 'D']);
  a.out(a.sop(["C'D'", "C'D", 'C'], 20), "C'D' + C'D + C", 40);
  a.out([k(b, 420, 300, 1, 1, '1'), 'Q'], '1 (simplified)', 380);
  return b.circuit();
}

function tMinMax(): Circuit {
  // f(x,y,z) = Σm(0,1,7) = ΠM(2,3,4,5,6)
  const b = new B(), a = new Alg(b, ['x', 'y', 'z']);
  const bit = (m: number, i: number, one: boolean) => a.lit(((m >> (2 - i)) & 1) === (one ? 1 : 0) ? ['x', 'y', 'z'][i] : ['x', 'y', 'z'][i] + "'");
  const sop = a.g('or', [0, 1, 7].map((m, i) => a.g('and', [0, 1, 2].map((j) => bit(m, j, true)), 20 + i * 70)), 80, 620);
  // maxterm M_m is 0 only at row m: each literal is complemented when that bit of m is 1
  const pos = a.g('and', [2, 3, 4, 5, 6].map((m, i) => a.g('or', [0, 1, 2].map((j) => bit(m, j, false)), 320 + i * 70)), 460, 620);
  a.out(sop, 'Σm(0,1,7)', 90); a.out(pos, 'ΠM(2,3,4,5,6)', 470);
  return b.circuit();
}

function tKmap4(): Circuit {
  // F = Σm(0,2,5,8,9,12,13,14,15) = A(B+C') + A'B'D' + A'BC'D
  const b = new B(), a = new Alg(b, ['A', 'B', 'C', 'D']);
  const mt = (m: number) => ['A', 'B', 'C', 'D'].map((v, i) => a.lit((m >> (3 - i)) & 1 ? v : v + "'"));
  a.out(a.g('or', MUX8_F_MINTERMS.map((m, i) => a.g('and', mt(m), 20 + i * 70)), 300, 620), 'F = Σm(0,2,5,8,9,12,13,14,15)', 320);
  const t1 = a.g('and', [a.lit('A'), a.g('or', [a.lit('B'), a.lit("C'")], 700)], 700, 620);
  const t2 = a.g('and', [a.lit("A'"), a.lit("B'"), a.lit("D'")], 780), t3 = a.g('and', [a.lit("A'"), a.lit('B'), a.lit("C'"), a.lit('D')], 860);
  a.out(a.g('or', [t1, t2, t3], 780, 820), "F = A(B+C') + A'B'D' + A'BC'D (K-map groups)", 800);
  return b.circuit();
}

const F = 'Computer Architecture';
const t = (id: string, name: string, tag: string, desc: string, build: () => Circuit): Template => ({ id: 'ca-' + id, name, tag, desc, folder: F, build });
export const ARCH_TEMPLATES: Template[] = [
  t('laws', 'Boolean Laws (De Morgan, distributive …)', 'Algebra', 'Each law is built twice (left- and right-hand side); the paired LEDs always agree for every A, B, C. Use Truth table to prove it.', tBoolLaws),
  t('alg1a', "Example 1a: simplify A'B + ABC' + ABC", 'Algebra', 'The three-term expression and its simplified form B give the same LED for all inputs.', tAlg1a),
  t('alg1b', "Example 1b: simplify to C'", 'Algebra', "ABC' + B'C' + A'BC' + AC' collapses to C' (reconstructed from the slide's worked steps).", tAlg1b),
  t('alg1c', 'Example 1b: a sum that collapses to 1', 'Algebra', "C'D' + C'D + C = 1 for every input (a tautology).", tAlgConst1),
  t('minmax', 'Minterms vs Maxterms: Σm(0,1,7) = ΠM(2,3,4,5,6)', 'Algebra', 'f(x,y,z) as a sum of minterms and as a product of maxterms — identical outputs. Run Truth table to see the minterm numbers.', tMinMax),
  t('kmap4', '4-variable K-map function', 'Algebra', "F = Σm(0,2,5,8,9,12,13,14,15) as 9 minterms and as the K-map groups A(B+C') + A'B'D' + A'BC'D.", tKmap4),
  t('gates', 'Logic Gates', 'Combinational', 'AND, OR, NAND, NOR, XOR and NOT driven by two switches (slide: logic gates).', tGates),
  t('kmap3', '3-variable K-map function', 'Combinational', 'F = A\'BC\' + A\'BC + ABC\' (the 1-cells of the K-map) next to its simplified form A\'B + BC\' — both LEDs always agree.', tKmap3),
  t('mux4', '4-to-1 Multiplexer (gates)', 'Combinational', 'Two inverters, four AND3 gates and an OR: output = D(S1S0).', tMux4Gates),
  t('mux8f', 'MUX 8:1 implements F(A,B,C,D)', 'Combinational', 'Example 2: F = Σm(0,2,5,8,9,12,13,14,15) on one 8:1 mux — B,C,D select, data inputs are 1, A, A\', 0, A, 1, A, A.', tMux8F),
  t('mux32', '32-to-1 Mux from four 8:1 Muxes', 'Combinational', 'Example 3: the two top select bits (A,B) pick one of four 8:1 muxes through a 2→4 decoder and an OR; C,D,E feed all four muxes. Edit the four data bytes.', tMux32),
  t('dec38', '3-to-8 Decoder (gates)', 'Combinational', 'Three inverters and eight AND3 gates.', tDec38),
  t('dec532', '5-to-32 Decoder from 3→8 Decoders', 'Combinational', 'Example 4: a 2→4 decoder enables one of four 3→8 decoders (decoder EN pins). Set ABCDE and see which byte lights.', tDec532),
  t('ha', 'Half Adder (gates + block)', 'Combinational', 'S = A⊕B, C = AB — gate version beside the HA block symbol.', tHalfAdderSlide),
  t('fagates', 'Full Adder (gates)', 'Combinational', 'S = A⊕B⊕Cin, C = AB + A·Cin + B·Cin.', tFullAdderGates),
  t('faha', 'Full Adder from two Half Adders', 'Combinational', 'S_F = (x⊕y)⊕z, C_F = C₁ + C₂ — two HA blocks and an OR.', tFullAdderHA),
  t('ex5', 'Example 5: 2-bit A+B / A−1', 'Combinational', 'M=0: OUT = A+B. M=1: OUT = A−1 = A + 10₂ + 1 (muxes feed 0 and 1 into B, M drives the carry-in).', tEx5),
  t('ex6', 'Example 6: 2-bit Adder-Subtractor (half adders)', 'Combinational', 'M=0 adds, M=1 computes A−B = A + B\' + 1 using XORs on B, half-adder pairs and an OR per bit.', tEx6),
  t('ffs', 'Flip-flops: SR, JK, D, T', 'Sequential', 'Clocked SR (latch gated by CLK), JK, D and T flip-flops, plus a T flip-flop built from a JK with J=K=T. Click CLK to toggle it.', tFlipFlops),
  t('jkd', 'Example 7: JK Flip-flop from D + MUX', 'Sequential', 'A D flip-flop and a 4:1 mux whose inputs are Q, 0, 1, Q\' selected by {J,K}.', tJkFromD),
  t('ex8jk', 'Example 8: Three JK Flip-flops', 'Sequential', 'FF1 is clocked by CLK, FF2 by Q1, FF3 by Q2; J1 = Q3 + Q3\', K1 = Q3\'. Open the waveform viewer to draw the output pulses.', tEx8Ripple),
  t('sipo', 'Serial Shift Register (5 × D)', 'Sequential', 'Serial In → five D flip-flops → Serial Out; each clock shifts the data one place.', tShiftSerial),
  t('preg', 'Parallel-load Register (8 × D)', 'Sequential', 'Eight D flip-flops with a gated clock (CLK AND Load); D01–D08 load in parallel.', tParallelReg),
  t('bidir', 'Bidirectional Shift Register, parallel load', 'Sequential', 'Four D flip-flops behind 4:1 muxes. S1S0: 00 hold · 01 shift right · 10 shift left · 11 parallel load.', tBidir),
  t('cnt4', '4-bit Synchronous Binary Counter (JK)', 'Sequential', 'Four JK flip-flops, J=K from an AND chain of lower bits; counts 0–15 (waveforms: Q0 toggles every clock, Q3 every 8).', tSyncCounter),
  t('ex8cnt', 'Example 8: Up/Down Counter with Enable', 'Sequential', 'Two JK flip-flops: J_A = K_A = E·(x ⊙ B), J_B = K_B = E. E=0 holds; E=1,x=1 counts 00→01→10→11; x=0 counts down.', tEx8Counter),
  t('mem', 'RAM and ROM blocks', 'Memory', 'A 16×8 RAM (write with WE+clock) and a 16×8 ROM driven by the same address.', tMemBlocks),
  t('mem4096', 'Example 9: 4096×8 Memory from 128×8 RAMs', 'Memory', 'Address A11–A0: A6–A0 go to all 32 chips, A11–A7 pass through a 5→32 decoder (two 4→16 decoders) that selects one chip. Chip k spans addresses 128k … 128k+127.', tMem4096),
  t('asm', 'ASM Chart Controller (D flip-flops)', 'Sequential', 'Four-state controller M0–M3 from the ASM chart: two D flip-flops, two 4:1 muxes (inputs x\' / 0,x,x\',x) and a 2→4 decoder.', tAsmFsm),
  t('rtl1', 'RTL Example 1: R1 ← −R1 (T0,T1,T2)', 'RTL', 'T1: R1 ← R1 ⊕ 1111, T2: R1 ← R1 + 1. Press INIT with a clock edge to load R1, then RESET pulse and let the T counter run.', tRtl1),
  t('rtl2', 'RTL Example 2: x+y : R1 ← R1 − 1', 'RTL', 'R1 loads R1 + 1111 (= R1−1) when x OR y; otherwise holds.', tRtl2),
  t('rtl3', 'RTL Example 3: R1 ← R1 + R2 or R1 + R2\'', 'RTL', 'x=1: R1 ← R1 + R2, x=0: R1 ← R1 + R2\' ; load strobe μ0.', tRtl3),
  t('rtl4', 'RTL Example 4: conditional ± and clear', 'RTL', 'μ0: if R1=R2 then R1 ← R1−R2 else R1 ← R1+R2.  μ1: if R1=0 then R2 ← R1 else R2 ← 0.', tRtl4),
  t('rtl5', 'RTL Example 5: zero-test select', 'RTL', 'T0+T1: if R1=0 ∨ R2=0 then R1 ← 0 else R1 ← R2.  T0+T1\': the same condition for R3.', tRtl5),
  t('bus2', 'Bus with two Registers (multiplexer)', 'Bus', 'R1 and R2 onto one 4-bit bus through a 2:1 mux; x selects the source.', tBusMux2),
  t('bus4', 'Bus with four Registers (4×1 muxes)', 'Bus', 'Registers A–D onto a 4-bit bus; S1S0 select (one 4×1 mux per bit).', tBusMux4),
  t('busdec', 'Bus with Decoder and Three-state Buffers', 'Bus', 'A 2→4 decoder (with Enable) turns on exactly one register driver; drivers are modelled as "bus or 0" and ORed together.', tBusDec),
  t('arith6', 'Example 6: A+C−1 / A−B', 'Arithmetic', 'S=0: F = A + C − 1 (B input = 1111, carry = C). S=1: F = A − B = A + B\' + 1.', tArithEx6),
  t('add4', '4-bit Ripple-Carry Adder', 'Arithmetic', 'Four full adders chained C0→C4.', tAdder4),
  t('addsub4', '4-bit Adder-Subtractor', 'Arithmetic', 'XOR on each B bit with M and M into C0: M=0 → A+B, M=1 → A−B.', tAddSub4),
  t('inc4', '4-bit Incrementer', 'Arithmetic', 'Four half adders in a chain with 1 into the first: A + 1.', tIncrementer),
  t('arith2', 'Two-stage Arithmetic Circuit', 'Arithmetic', 'Mano arithmetic stage ×2: a 4×1 mux (B, B\', 0, 1) per bit selected by S1S0 plus Cin; add, add with carry, subtract, increment, decrement…', tArith2Stage),
  t('logic1', 'Logic Circuit stage', 'Arithmetic', 'One bit of the logic unit: AND, OR, XOR, NOT chosen by a 4×1 mux.', tLogicStage),
  t('shifter', 'Shifter (4 muxes)', 'Arithmetic', 'S=0 shifts right (H = I_R A0 A1 A2), S=1 shifts left (H = A1 A2 A3 I_L).', tShifter),
  t('alu', '4-bit ALU (arithmetic + logic + shift)', 'Arithmetic', 'S3S2 pick the unit (00 arithmetic, 01 logic, 10 shift right, 11 shift left); S1S0 pick the operation inside it (arithmetic: B, B\', 0, 1…1 with Cin).', tAlu4),
  t('unit7', 'Example 7: Arithmetic Unit table', 'Arithmetic', '(S,Cin): 00 → A+B, 01 → A+1, 10 → A−1, 11 → A−B — a 4×1 mux selects B, 0, 1…1 or B\'.', tArithUnit7),
  t('chain', 'Example 7: Chained R1−R2 with carry flip-flop', 'Arithmetic', 'R1=9, R2=7: first add Cin=0 → OUT=0001 (Cout=0), the next clock feeds Cout back as Cin. Watch OUT/Cout and the Cin flip-flop.', tChainedSub),
  t('rtl8', 'RTL Example 8: x,y select (R1−R2, R1, −2−R2, −1)', 'RTL', 'xy\': R3←R1−R2 ... : two muxes choose 1…1 or the operand, Cin = x\' + y.', tRtl8),
  t('clk5', 'Clock-count Example: R1 ← R1 − (R1 − 1) = 1', 'RTL', 'Five timing steps T0–T4 (A←R1; B←1…1; R2←A+B; B←R2\'; R1←A+B+1). Pulse RESET, press INIT once to load R1, then count the clocks.', tClockCount),
  t('rtl9', 'RTL Example: R1 / R2 / R3 with T', 'RTL', 'T\': R1 ← R2.  T: if R1=0 then R3 ← R2 − R3 else R3 ← R1 − R3.', tRtl9),
];
