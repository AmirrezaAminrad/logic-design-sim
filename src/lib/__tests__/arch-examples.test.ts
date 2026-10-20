import { describe, expect, it } from 'vitest';
import { Engine } from '../engine';
import { ARCH_TEMPLATES, MUX8_F_MINTERMS } from '../arch-examples';
import type { Circuit } from '../types';

function load(id: string) {
  const c: Circuit = ARCH_TEMPLATES.find((t) => t.id === 'ca-' + id)!.build();
  const e = new Engine();
  e.sync(c);
  const by = (n: string) => {
    const x = c.comps.find((q) => q.name === n);
    if (!x) throw new Error('no component ' + n);
    return x;
  };
  const set = (n: string, v: number) => { by(n).props.value = v; e.sync(c); };
  const out = (n: string, pin = 0) => e.outOf(by(n).id, pin);
  const sink = (n: string) => e.inOf(by(n).id, 0); // led / hexdisp value
  const cycle = (n = 1) => { for (let i = 0; i < n; i++) { e.halfStep(); e.halfStep(); } };
  return { c, e, set, out, sink, cycle, by };
}

describe('arch examples', () => {
  it('every slide circuit builds, settles and is stable', () => {
    expect(ARCH_TEMPLATES.length).toBeGreaterThanOrEqual(40);
    const ids = new Set<string>();
    for (const t of ARCH_TEMPLATES) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      const c = t.build();
      expect(c.comps.length).toBeGreaterThan(0);
      const e = new Engine();
      e.sync(c);
      e.settle();
      expect(e.unstable, t.id).toBeFalsy();
    }
  });

  it('logic gates', () => {
    const t = load('gates');
    for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      t.set('A', a); t.set('B', b);
      expect([t.sink('AND'), t.sink('OR'), t.sink('NAND'), t.sink('NOR'), t.sink('XOR'), t.sink('NOT A')])
        .toEqual([a & b, a | b, 1 - (a & b), 1 - (a | b), a ^ b, 1 - a]);
    }
  });

  it('K-map function matches its minterms and the simplified form', () => {
    const t = load('kmap3');
    for (let m = 0; m < 8; m++) {
      t.set('A', m >> 2); t.set('B', (m >> 1) & 1); t.set('C', m & 1);
      const want = [2, 3, 6].includes(m) ? 1 : 0;
      expect(t.sink('F = A\'BC\' + A\'BC + ABC\'')).toBe(want);
      expect(t.sink('F = A\'B + BC\' (simplified)')).toBe(want);
    }
  });

  it('4:1 mux (gates) and the 8:1 mux function', () => {
    const t = load('mux4');
    for (let s = 0; s < 4; s++) for (let d = 0; d < 16; d++) {
      for (let i = 0; i < 4; i++) t.set('D' + i, (d >> i) & 1);
      t.set('S1', s >> 1); t.set('S0', s & 1);
      expect(t.sink('F')).toBe((d >> s) & 1);
    }
    const f = load('mux8f');
    for (let m = 0; m < 16; m++) {
      f.set('A', m >> 3); f.set('B', (m >> 2) & 1); f.set('C', (m >> 1) & 1); f.set('D', m & 1);
      expect(f.sink('F')).toBe(MUX8_F_MINTERMS.includes(m) ? 1 : 0);
    }
  });

  it('32:1 mux built from four 8:1 muxes', () => {
    const t = load('mux32');
    const bytes = [0x12, 0x34, 0x56, 0x78];
    ['D0-7', 'D8-15', 'D16-23', 'D24-31'].forEach((n, i) => t.set(n, bytes[i]));
    for (let s = 0; s < 32; s++) {
      t.set('ABCDE', s);
      expect(t.sink('F')).toBe((bytes[s >> 3] >> (s & 7)) & 1);
    }
  });

  it('3:8 decoder (gates) and 5:32 decoder from 3:8 decoders', () => {
    const d = load('dec38');
    for (let v = 0; v < 8; v++) {
      d.set('A', v >> 2); d.set('B', (v >> 1) & 1); d.set('C', v & 1);
      for (let i = 0; i < 8; i++) expect(d.sink('D' + i)).toBe(i === v ? 1 : 0);
    }
    const t = load('dec532');
    for (let v = 0; v < 32; v++) {
      t.set('ABCDE', v);
      ['D0-7', 'D8-15', 'D16-23', 'D24-31'].forEach((n, i) => expect(t.sink(n)).toBe(i === v >> 3 ? 1 << (v & 7) : 0));
    }
  });

  it('half and full adders (three constructions)', () => {
    const h = load('ha');
    for (let m = 0; m < 4; m++) {
      h.set('A', m >> 1); h.set('B', m & 1);
      const s = (m >> 1) + (m & 1);
      expect([h.sink('Sum'), h.sink('Carry'), h.sink('S (HA block)'), h.sink('C (HA block)')]).toEqual([s & 1, s >> 1, s & 1, s >> 1]);
    }
    const g = load('fagates'), a = load('faha');
    for (let m = 0; m < 8; m++) {
      const [x, y, z] = [m >> 2, (m >> 1) & 1, m & 1], s = x + y + z;
      g.set('A', x); g.set('B', y); g.set('Cin', z);
      expect([g.sink('Sum'), g.sink('Cout')]).toEqual([s & 1, s >> 1]);
      a.set('x', x); a.set('y', y); a.set('z', z);
      expect([a.sink('S_F'), a.sink('C_F')]).toEqual([s & 1, s >> 1]);
    }
  });

  it('Example 5 (A+B / A−1) and Example 6 (2-bit adder-subtractor)', () => {
    const e5 = load('ex5'), e6 = load('ex6');
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      e5.set('A', a); e5.set('B', b); e6.set('A', a); e6.set('B', b);
      e5.set('M', 0); expect(e5.sink('OUT')).toBe((a + b) & 3);
      e5.set('M', 1); expect(e5.sink('OUT')).toBe((a - 1) & 3);
      e6.set('M', 0); expect(e6.sink('OUT')).toBe((a + b) & 3); expect(e6.sink('Cout')).toBe(a + b > 3 ? 1 : 0);
      e6.set('M', 1); expect(e6.sink('OUT')).toBe((a - b) & 3);
    }
  });

  it('JK flip-flop made from D + mux behaves like a JK', () => {
    const t = load('jkd');
    let q = 0;
    for (const [j, k] of [[1, 0], [0, 0], [0, 1], [1, 1], [1, 1], [0, 0], [1, 0], [0, 1]]) {
      t.set('J', j); t.set('K', k);
      t.cycle();
      q = j && k ? 1 - q : j ? 1 : k ? 0 : q;
      expect(t.sink('Q')).toBe(q);
    }
  });

  it('serial shift register shifts one place per clock', () => {
    const t = load('sipo');
    const bits = [1, 0, 1, 1, 0, 0, 0, 0, 0];
    const outs: number[] = [];
    for (const b of bits) { t.set('Serial In', b); t.cycle(); outs.push(t.sink('Serial Out')); }
    expect(outs.slice(4)).toEqual([1, 0, 1, 1, 0]); // 5 stages: input 1,0,1,1,0 appears 4 clocks later
  });

  it('parallel-load register captures D when Load=1', () => {
    const t = load('preg');
    t.set('D1-D8', 0xc3);
    t.cycle();
    expect(t.sink('Q (D01-D08)')).toBe(0xc3);
    t.set('Load', 0); t.set('D1-D8', 0x11); t.cycle();
    expect(t.sink('Q (D01-D08)')).toBe(0xc3);
  });

  it('bidirectional shift register: hold, right, left, parallel load', () => {
    const t = load('bidir');
    t.set('S1', 1); t.set('S0', 1); t.set('D1-D4', 0b1010); t.cycle();
    expect(t.sink('Q')).toBe(0b1010);
    t.set('S1', 0); t.set('S0', 1); t.set('Serial in (right shift)', 1); t.cycle(); // → 1101 (MSB side takes the serial input)
    expect(t.sink('Q')).toBe(0b1101);
    t.set('S1', 1); t.set('S0', 0); t.set('Serial in (left shift)', 0); t.cycle(); // ← 1010
    expect(t.sink('Q')).toBe(0b1010);
    t.set('S1', 0); t.set('S0', 0); t.cycle();
    expect(t.sink('Q')).toBe(0b1010);
  });

  it('4-bit JK counter counts 0..15 and wraps', () => {
    const t = load('cnt4');
    for (let i = 1; i <= 17; i++) { t.cycle(); expect(t.sink('COUNT')).toBe(i & 15); }
  });

  it('Example 8 up/down counter with enable', () => {
    const t = load('ex8cnt');
    const st = () => t.sink('Q_A') * 2 + t.sink('Q_B');
    t.set('E', 0); t.set('x', 1); t.cycle(3);
    expect(st()).toBe(0);
    t.set('E', 1);
    const up: number[] = []; for (let i = 0; i < 5; i++) { t.cycle(); up.push(st()); }
    expect(up).toEqual([1, 2, 3, 0, 1]);
    t.set('x', 0);
    const dn: number[] = []; for (let i = 0; i < 4; i++) { t.cycle(); dn.push(st()); }
    expect(dn).toEqual([0, 3, 2, 1]);
  });

  it('RAM/ROM blocks', () => {
    const t = load('mem');
    t.set('Address', 5); expect(t.sink('ROM out')).toBe(0x55);
    t.set('Write', 1); t.cycle(); expect(t.sink('RAM out')).toBe(0x42);
  });

  it('4096×8 memory: write/read across chip boundaries', () => {
    const t = load('mem4096');
    const wr = (a: number, v: number) => { t.set('A11..A0', a); t.set('Data in', v); t.set('Write', 1); t.cycle(); t.set('Write', 0); };
    wr(0x000, 0x11); wr(0x07f, 0x22); wr(0x080, 0x33); wr(0x800, 0x44); wr(0xf80, 0x55); wr(0xfff, 0x66);
    for (const [a, v] of [[0x000, 0x11], [0x07f, 0x22], [0x080, 0x33], [0x800, 0x44], [0xf80, 0x55], [0xfff, 0x66], [0x400, 0]]) {
      t.set('A11..A0', a);
      expect(t.sink('Data out')).toBe(v);
    }
  });

  it('ASM controller follows the state table', () => {
    const t = load('asm');
    const st = () => [0, 1, 2, 3].findIndex((i) => t.sink('M' + i) === 1);
    expect(st()).toBe(0);
    const next = (s: number, x: number) => [[1, 0], [1, 2], [3, 0], [1, 2]][s][x]; // [x=0 → , x=1 →]
    let s = 0;
    for (const x of [0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1]) {
      t.set('x', x); t.cycle();
      s = next(s, x);
      expect(st()).toBe(s);
    }
  });

  it('RTL 1: T1,T2 negate R1 (two\'s complement)', () => {
    const t = load('rtl1');
    t.set('INIT', 1); t.cycle(); t.set('INIT', 0);
    expect(t.sink('R1 =')).toBe(5);
    t.set('RESET (T0)', 1); t.set('RESET (T0)', 0);
    t.cycle(3);
    expect(t.sink('R1 =')).toBe((-5) & 15);
    t.cycle(3);
    expect(t.sink('R1 =')).toBe((-5) & 15); // counter parked at state 3
  });

  it('RTL 2 / 3 / 4 / 5 / 9 conditional register transfers', () => {
    const r2 = load('rtl2');
    r2.set('INIT', 1); r2.cycle(); r2.set('INIT', 0);
    r2.cycle(); expect(r2.sink('R1 =')).toBe(5);
    r2.set('y', 1); r2.cycle(); expect(r2.sink('R1 =')).toBe(4);

    const r3 = load('rtl3');
    r3.set('INIT', 1); r3.cycle(); r3.set('INIT', 0); r3.set('μ0', 1);
    r3.set('x', 1); r3.cycle(); expect(r3.sink('R1 =')).toBe(8);         // 5+3
    r3.set('x', 0); r3.cycle(); expect(r3.sink('R1 =')).toBe((8 + 12) & 15); // +R2'

    const r4 = load('rtl4');
    r4.set('INIT', 1); r4.cycle(); r4.set('INIT', 0);
    expect([r4.sink('R1 ='), r4.sink('R2 =')]).toEqual([6, 6]);
    r4.set('μ0', 1); r4.cycle(); expect(r4.sink('R1 =')).toBe(0);        // R1=R2 → R1−R2
    r4.set('μ0', 0); r4.set('μ1', 1); r4.cycle(); expect(r4.sink('R2 =')).toBe(0); // R1=0 → R2←R1

    const r5 = load('rtl5');
    r5.set('INIT', 1); r5.cycle(); r5.set('INIT', 0);
    r5.set('T0', 1); r5.cycle();           // R1=0 → R1←0, R3←0
    expect([r5.sink('R1 ='), r5.sink('R3 =')]).toEqual([0, 0]);

    const r9 = load('rtl9');
    r9.set('INIT', 1); r9.cycle(); r9.set('INIT', 0);
    r9.set('T', 1); r9.cycle(); expect(r9.sink('R3 =')).toBe((9 + (~2 & 15) + 1) & 15); // R1=0 → R2−R3 = 7
    r9.set('T', 0); r9.cycle(); expect(r9.sink('R1 =')).toBe(9);                // R1 ← R2
    r9.set('T', 1); r9.cycle(); expect(r9.sink('R3 =')).toBe((9 + (~7 & 15) + 1) & 15); // R1≠0 → R1−R3
  });

  it('bus examples', () => {
    const b2 = load('bus2');
    expect(b2.sink('BUS')).toBe(3); b2.set('x (0→R1, 1→R2)', 1); expect(b2.sink('BUS')).toBe(12);
    const b4 = load('bus4'), bd = load('busdec');
    for (let s = 0; s < 4; s++) {
      b4.set('S1', s >> 1); b4.set('S0', s & 1); expect(b4.sink('BUS')).toBe(1 << s);
      bd.set('S1', s >> 1); bd.set('S0', s & 1); expect(bd.sink('BUS')).toBe(1 << s);
    }
    bd.set('Enable', 0); expect(bd.sink('BUS')).toBe(0);
  });

  it('arithmetic circuits', () => {
    const a6 = load('arith6');
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) {
      a6.set('A', a); a6.set('B', b);
      a6.set('S', 1); expect(a6.sink('F')).toBe((a - b) & 15);
      for (const c of [0, 1]) { a6.set('S', 0); a6.set('C', c); expect(a6.sink('F')).toBe((a + c - 1) & 15); }
    }
    const ad = load('add4'), as = load('addsub4'), inc = load('inc4');
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) {
      ad.set('A', a); ad.set('B', b);
      expect(ad.sink('S') + 16 * ad.sink('C4')).toBe(a + b);
      as.set('A', a); as.set('B', b);
      as.set('M (0=add, 1=subtract)', 0); expect(as.sink('S')).toBe((a + b) & 15);
      as.set('M (0=add, 1=subtract)', 1); expect(as.sink('S')).toBe((a - b) & 15);
    }
    for (let a = 0; a < 16; a++) { inc.set('A', a); expect(inc.sink('A + 1')).toBe((a + 1) & 15); expect(inc.sink('C4')).toBe(a === 15 ? 1 : 0); }
    const u = load('unit7');
    for (let a = 0; a < 16; a++) for (const b of [0, 3, 9, 15]) {
      u.set('A', a); u.set('B', b);
      const want = [(a + b), a + 1, a - 1, a - b];
      for (let sc = 0; sc < 4; sc++) {
        u.set('S', sc >> 1); u.set('Cin', sc & 1);
        expect(u.sink('D  (00: A+B · 01: A+1 · 10: A−1 · 11: A−B)')).toBe(want[sc] & 15);
      }
    }
    const t2 = load('arith2');
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let s = 0; s < 4; s++) for (const ci of [0, 1]) {
      t2.set('A', a); t2.set('B', b); t2.set('S1', s >> 1); t2.set('S0', s & 1); t2.set('Cin', ci);
      const bb = [b, ~b & 3, 0, 3][s];
      expect(t2.sink('D') + 4 * t2.sink('Cout')).toBe(a + bb + ci);
    }
  });

  it('logic stage and shifter', () => {
    const l = load('logic1');
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let s = 0; s < 4; s++) {
      l.set('A', a); l.set('B', b); l.set('S1', s >> 1); l.set('S0', s & 1);
      expect(l.sink('E (S: 00 AND · 01 OR · 10 XOR · 11 NOT)')).toBe([a & b, a | b, a ^ b, 1 - a][s]);
    }
    const sh = load('shifter');
    sh.set('A0-A3', 0b0110); sh.set('Serial in I_R', 1); sh.set('Serial in I_L', 0);
    sh.set('S (0=right, 1=left)', 0); expect(sh.sink('H0-H3')).toBe(0b1101); // I_R A0 A1 A2 → bit0=I_R
    sh.set('S (0=right, 1=left)', 1); expect(sh.sink('H0-H3')).toBe(0b0011);
  });

  it('4-bit ALU: arithmetic, logic and shifts', () => {
    const t = load('alu');
    const sel = (s3: number, s2: number, s1: number, s0: number) => { t.set('S3', s3); t.set('S2', s2); t.set('S1', s1); t.set('S0', s0); };
    for (const [a, b] of [[6, 3], [9, 12], [15, 1], [0, 0]]) {
      t.set('A', a); t.set('B', b);
      t.set('Cin (arith)', 0);
      sel(0, 0, 0, 0); expect(t.sink('F')).toBe((a + b) & 15);
      sel(0, 0, 0, 1); expect(t.sink('F')).toBe((a + (~b & 15)) & 15);
      sel(0, 0, 1, 1); expect(t.sink('F')).toBe((a - 1) & 15);
      t.set('Cin (arith)', 1); sel(0, 0, 0, 1); expect(t.sink('F')).toBe((a - b) & 15);
      sel(0, 1, 0, 0); expect(t.sink('F')).toBe(a & b);
      sel(0, 1, 0, 1); expect(t.sink('F')).toBe(a | b);
      sel(0, 1, 1, 0); expect(t.sink('F')).toBe(a ^ b);
      sel(0, 1, 1, 1); expect(t.sink('F')).toBe(~a & 15);
      sel(1, 0, 0, 0); expect(t.sink('F')).toBe(a >> 1);
      sel(1, 1, 0, 0); expect(t.sink('F')).toBe((a << 1) & 15);
    }
  });

  it('chained R1−R2 with carry flip-flop, and Example 8 x,y select', () => {
    const t = load('chain');
    expect([t.sink('OUT'), t.sink('Cout')]).toEqual([(9 + 8) & 15, 1]); // Cin=0: 1001+1000
    t.cycle();
    expect([t.sink('OUT'), t.sink('Cout')]).toEqual([(9 + 8 + 1) & 15, 1]); // Cin=1 now
    const r = load('rtl8');
    for (const [x, y, want] of [[0, 0, 7 - 3], [0, 1, 7], [1, 0, (14 - 3) & 15], [1, 1, 15]]) {
      r.set('x', x); r.set('y', y);
      expect(r.sink('R3 (next)')).toBe(want);
    }
  });

  it('clock-count example leaves R1 = 1', () => {
    const t = load('clk5');
    t.set('INIT', 1); t.cycle(); t.set('INIT', 0);
    expect(t.sink('R1 =')).toBe(6);
    t.set('RESET (T0)', 1); t.set('RESET (T0)', 0);
    t.cycle(5);
    expect(t.sink('R1 =')).toBe(1);
    expect(t.sink('R2 =')).toBe(5);
  });

  it('algebra examples: both sides of every identity agree for all inputs', () => {
    const pairs = (id: string, vars: string[], names: [string, string][]) => {
      const t = load(id);
      for (let m = 0; m < 1 << vars.length; m++) {
        vars.forEach((v, i) => t.set(v, (m >> (vars.length - 1 - i)) & 1));
        for (const [l, r] of names) expect(t.sink(l), `${id} m=${m} ${l}`).toBe(t.sink(r));
      }
    };
    pairs('alg1a', ['A', 'B', 'C'], [["A'B + ABC' + ABC", 'B (simplified)']]);
    pairs('alg1b', ['A', 'B', 'C'], [["ABC' + B'C' + A'BC' + AC'", "C' (simplified)"]]);
    pairs('alg1c', ['C', 'D'], [["C'D' + C'D + C", '1 (simplified)']]);
    pairs('minmax', ['x', 'y', 'z'], [['Σm(0,1,7)', 'ΠM(2,3,4,5,6)']]);
    pairs('kmap4', ['A', 'B', 'C', 'D'], [['F = Σm(0,2,5,8,9,12,13,14,15)', "F = A(B+C') + A'B'D' + A'BC'D (K-map groups)"]]);
    const laws = load('laws');
    const names = ["De Morgan: (AB)' | A'+B'", "De Morgan: (A+B)' | A'B'", 'Distributive: A(B+C) | AB+AC', 'Distributive: A+BC | (A+B)(A+C)', 'Absorption: A+AB | A', "Inverse: A+A' | 1", "Inverse: A·A' | 0"];
    for (let m = 0; m < 8; m++) {
      ['A', 'B', 'C'].forEach((v, i) => laws.set(v, (m >> (2 - i)) & 1));
      for (const n of names) expect(laws.sink(n + ' (LHS)'), n).toBe(laws.sink(n + ' (RHS)'));
    }
  });

  it('minterm/maxterm and K-map outputs equal the stated functions', () => {
    const t = load('minmax');
    for (let m = 0; m < 8; m++) {
      ['x', 'y', 'z'].forEach((v, i) => t.set(v, (m >> (2 - i)) & 1));
      expect(t.sink('Σm(0,1,7)')).toBe([0, 1, 7].includes(m) ? 1 : 0);
    }
    const k = load('kmap4');
    for (let m = 0; m < 16; m++) {
      ['A', 'B', 'C', 'D'].forEach((v, i) => k.set(v, (m >> (3 - i)) & 1));
      expect(k.sink('F = Σm(0,2,5,8,9,12,13,14,15)')).toBe(MUX8_F_MINTERMS.includes(m) ? 1 : 0);
    }
  });
});
