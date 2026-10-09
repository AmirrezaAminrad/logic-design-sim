import { describe, expect, it } from 'vitest';
import { TB, mk } from './helpers';

const both = (f: (a: number, b: number) => void) => { for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) f(a, b); };

/** Two switches feeding a 2-input gate; returns out values for each input pair. */
function gate2(type: string, props: Record<string, any> = {}) {
  const t = new TB();
  t.add('switch', 0, 0, {}, 'A');
  t.add('switch', 0, 60, {}, 'B');
  t.add(type, 100, 0, props, 'G');
  t.w('A', 'Q', 'G', 'A');
  t.w('B', 'Q', 'G', 'B');
  const { out, setIn } = mk(t.circuit());
  return (a: number, b: number) => { setIn('A', a); setIn('B', b); return out('G'); };
}

describe('logic gates', () => {
  it('AND', () => {
    const g = gate2('and');
    both((a, b) => expect(g(a, b)).toBe(a & b));
  });
  it('OR', () => {
    const g = gate2('or');
    both((a, b) => expect(g(a, b)).toBe(a | b));
  });
  it('NAND', () => {
    const g = gate2('nand');
    both((a, b) => expect(g(a, b)).toBe(1 - (a & b)));
  });
  it('NOR', () => {
    const g = gate2('nor');
    both((a, b) => expect(g(a, b)).toBe(1 - (a | b)));
  });
  it('XOR / XNOR', () => {
    const x = gate2('xor');
    const n = gate2('xnor');
    both((a, b) => { expect(x(a, b)).toBe(a ^ b); expect(n(a, b)).toBe(1 - (a ^ b)); });
  });
  it('NOT / Buffer', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'A');
    t.add('not', 100, 0, {}, 'N');
    t.add('buf', 100, 60, {}, 'F');
    t.w('A', 'Q', 'N', 'A');
    t.w('A', 'Q', 'F', 'A');
    const { out, setIn } = mk(t.circuit());
    setIn('A', 0); expect(out('N')).toBe(1); expect(out('F')).toBe(0);
    setIn('A', 1); expect(out('N')).toBe(0); expect(out('F')).toBe(1);
  });
  it('3-input AND folds correctly', () => {
    const t = new TB();
    for (const n of ['A', 'B', 'C']) t.add('switch', 0, 0, {}, n);
    t.add('and', 100, 0, { n: 3 }, 'G');
    t.w('A', 'Q', 'G', 'A'); t.w('B', 'Q', 'G', 'B'); t.w('C', 'Q', 'G', 'C');
    const { out, setIn } = mk(t.circuit());
    setIn('A', 1); setIn('B', 1); setIn('C', 0); expect(out('G')).toBe(0);
    setIn('C', 1); expect(out('G')).toBe(1);
    setIn('B', 0); expect(out('G')).toBe(0);
  });
  it('multi-bit gate width (OR w=4)', () => {
    const t = new TB();
    t.add('numin', 0, 0, { w: 4, value: 0b1010 }, 'A');
    t.add('numin', 0, 60, { w: 4, value: 0b0110 }, 'B');
    t.add('or', 100, 0, { w: 4 }, 'G');
    t.w('A', 'Q', 'G', 'A'); t.w('B', 'Q', 'G', 'B');
    const { out } = mk(t.circuit());
    expect(out('G')).toBe(0b1110);
  });
});

describe('mux / demux / decoders', () => {
  it('mux 4:1 selects D address', () => {
    const t = new TB();
    for (let i = 0; i < 4; i++) t.add('numin', 0, i * 40, { w: 3, value: i + 1 }, 'D' + i);
    t.add('numin', 0, 200, { w: 2, value: 0 }, 'S');
    t.add('mux', 200, 0, { s: 2, w: 3 }, 'M');
    for (let i = 0; i < 4; i++) t.w('D' + i, 'Q', 'M', 'D' + i);
    t.w('S', 'Q', 'M', 'S');
    const { out, byName, e } = mk(t.circuit());
    for (let s = 0; s < 4; s++) {
      byName.get('S')!.props.value = s;
      e.sync(t.circuit());
      expect(out('M')).toBe(s + 1);
    }
  });
  it('mux 8:1', () => {
    const t = new TB();
    for (let i = 0; i < 8; i++) t.add('switch', 0, i * 40, {}, 'D' + i);
    t.add('numin', 0, 400, { w: 3, value: 5 }, 'S');
    t.add('mux', 200, 0, { s: 3 }, 'M');
    for (let i = 0; i < 8; i++) t.w('D' + i, 'Q', 'M', 'D' + i);
    t.w('S', 'Q', 'M', 'S');
    const { out } = mk(t.circuit());
    expect(out('M')).toBe(0); // all switches off
  });
  it('demux routes to exactly one output', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'D');
    t.add('numin', 0, 60, { w: 2, value: 2 }, 'S');
    t.add('demux', 200, 0, { s: 2 }, 'X');
    t.w('D', 'Q', 'X', 'D');
    t.w('S', 'Q', 'X', 'S');
    const { out, setIn } = mk(t.circuit());
    setIn('D', 1);
    expect([0, 1, 2, 3].map((k) => out('X', k))).toEqual([0, 0, 1, 0]);
    setIn('D', 0);
    expect([0, 1, 2, 3].map((k) => out('X', k))).toEqual([0, 0, 0, 0]);
  });
  it('decoder one-hot with EN gate', () => {
    const t = new TB();
    t.add('numin', 0, 0, { w: 2, value: 3 }, 'A');
    t.add('switch', 0, 80, {}, 'EN');
    t.add('decoder', 200, 0, { n: 2 }, 'D');
    t.w('A', 'Q', 'D', 'A');
    t.w('EN', 'Q', 'D', 'EN');
    const { out, setIn } = mk(t.circuit());
    setIn('EN', 1);
    expect([0, 1, 2, 3].map((k) => out('D', k))).toEqual([0, 0, 0, 1]);
    setIn('EN', 0);
    expect([0, 1, 2, 3].map((k) => out('D', k))).toEqual([0, 0, 0, 0]);
  });
  it('encoder turns one-hot into index', () => {
    const t = new TB();
    for (let i = 0; i < 4; i++) t.add('switch', 0, i * 40, {}, 'I' + i);
    t.add('encoder', 200, 0, { n: 2 }, 'E');
    for (let i = 0; i < 4; i++) t.w('I' + i, 'Q', 'E', 'I' + i);
    const { out, setIn } = mk(t.circuit());
    setIn('I2', 1);
    expect(out('E')).toBe(2);
  });
  it('priority encoder picks highest active + valid', () => {
    const t = new TB();
    for (let i = 0; i < 4; i++) t.add('switch', 0, i * 40, {}, 'I' + i);
    t.add('penc', 200, 0, { n: 2 }, 'P');
    for (let i = 0; i < 4; i++) t.w('I' + i, 'Q', 'P', 'I' + i);
    const { out, setIn } = mk(t.circuit());
    setIn('I0', 1); setIn('I3', 1);
    expect(out('P', 0)).toBe(3); // Y
    expect(out('P', 1)).toBe(1); // V
    setIn('I3', 0); setIn('I0', 0);
    expect(out('P', 1)).toBe(0); // nothing active → V=0
    expect(out('P', 0)).toBe(0);
  });
});

describe('arithmetic', () => {
  it('half adder', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'A'); t.add('switch', 0, 60, {}, 'B');
    t.add('halfadder', 200, 0, {}, 'H');
    t.w('A', 'Q', 'H', 'A'); t.w('B', 'Q', 'H', 'B');
    const { out, setIn } = mk(t.circuit());
    both((a, b) => { setIn('A', a); setIn('B', b); expect(out('H', 0)).toBe(a ^ b); expect(out('H', 1)).toBe(a & b); });
  });
  it('full adder exhaustively', () => {
    const t = new TB();
    for (const n of ['A', 'B', 'C']) t.add('switch', 0, 0, {}, n);
    t.add('fulladder', 200, 0, {}, 'F');
    t.w('A', 'Q', 'F', 'A'); t.w('B', 'Q', 'F', 'B'); t.w('C', 'Q', 'F', 'Cin');
    const { out, setIn } = mk(t.circuit());
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let ci = 0; ci < 2; ci++) {
      setIn('A', a); setIn('B', b); setIn('C', ci);
      expect(out('F', 0)).toBe((a + b + ci) & 1);
      expect(out('F', 1)).toBe(a + b + ci > 1 ? 1 : 0);
    }
  });
  it('4-bit adder matches arithmetic for all 256+128 input combos', () => {
    const t = new TB();
    t.add('numin', 0, 0, { w: 4, value: 0 }, 'A');
    t.add('numin', 0, 60, { w: 4, value: 0 }, 'B');
    t.add('switch', 0, 120, {}, 'Ci');
    t.add('adder', 200, 0, { w: 4 }, 'AD');
    t.w('A', 'Q', 'AD', 'A'); t.w('B', 'Q', 'AD', 'B'); t.w('Ci', 'Q', 'AD', 'Cin');
    const { out, setIn } = mk(t.circuit());
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (const ci of [0, 1]) {
      setIn('A', a); setIn('B', b); setIn('Ci', ci);
      const sum = a + b + ci;
      expect(out('AD', 0)).toBe(sum & 15);
      expect(out('AD', 1)).toBe(sum > 15 ? 1 : 0);
    }
  });
  it('comparator', () => {
    const t = new TB();
    t.add('numin', 0, 0, { w: 4, value: 5 }, 'A');
    t.add('numin', 0, 60, { w: 4, value: 5 }, 'B');
    t.add('comparator', 200, 0, { w: 4 }, 'C');
    t.w('A', 'Q', 'C', 'A'); t.w('B', 'Q', 'C', 'B');
    const { out, setIn } = mk(t.circuit());
    expect([out('C', 0), out('C', 1), out('C', 2)]).toEqual([0, 1, 0]);
    setIn('A', 9); expect([out('C', 0), out('C', 1), out('C', 2)]).toEqual([1, 0, 0]);
    setIn('A', 2); expect([out('C', 0), out('C', 1), out('C', 2)]).toEqual([0, 0, 1]);
  });
  it('ALU all 8 operations', () => {
    const t = new TB();
    t.add('numin', 0, 0, { w: 4, value: 6 }, 'A');
    t.add('numin', 0, 60, { w: 4, value: 3 }, 'B');
    t.add('numin', 0, 120, { w: 3, value: 0 }, 'OP');
    t.add('alu', 200, 0, { w: 4 }, 'U');
    t.w('A', 'Q', 'U', 'A'); t.w('B', 'Q', 'U', 'B'); t.w('OP', 'Q', 'U', 'OP');
    const { out, setIn } = mk(t.circuit());
    const expectR = (r: number, c: number) => { expect(out('U', 0)).toBe(r & 15); expect(out('U', 2)).toBe(c); };
    setIn('OP', 0); expectR(6 + 3, 0);          // ADD
    setIn('OP', 1); expectR((6 - 3) & 15, 0);   // SUB
    setIn('OP', 2); expectR(6 & 3, 0);          // AND
    setIn('OP', 3); expectR(6 | 3, 0);          // OR
    setIn('OP', 4); expectR(6 ^ 3, 0);          // XOR
    setIn('OP', 5); expectR(3, 0);              // PASS B
    setIn('OP', 6); expectR((6 << 1) & 15, 0);  // SHL
    setIn('OP', 7); expectR(~6 & 15, 0);        // NOT A
    setIn('A', 0); setIn('OP', 3);              // OR → 3
    expect(out('U', 1)).toBe(0);
    setIn('B', 0);                              // OR → 0 → Z flag
    expect(out('U', 1)).toBe(1);
    setIn('A', 9); setIn('B', 12); setIn('OP', 0);
    expect(out('U', 0)).toBe(5); expect(out('U', 2)).toBe(1); // ADD wraps, carry
  });
});

describe('buses', () => {
  it('splitter + merger round-trip', () => {
    const t = new TB();
    t.add('numin', 0, 0, { w: 4, value: 0b1100 }, 'N');
    t.add('splitter', 100, 0, { w: 4 }, 'SP');
    t.add('merger', 300, 0, { w: 4 }, 'MG');
    t.w('N', 'Q', 'SP', 'Bus');
    for (let i = 0; i < 4; i++) t.w('SP', 'b' + i, 'MG', 'b' + i);
    const { out } = mk(t.circuit());
    expect(out('MG')).toBe(0b1100);
    expect(out('SP', 0)).toBe(0);
    expect(out('SP', 3)).toBe(1);
  });
  it('slice extracts a field', () => {
    const t = new TB();
    t.add('numin', 0, 0, { w: 8, value: 0b10110011 }, 'N');
    t.add('slice', 100, 0, { w: 8, lo: 4, n: 3 }, 'S');
    t.w('N', 'Q', 'S', 'In');
    const { out } = mk(t.circuit());
    expect(out('S')).toBe(0b011);
  });
});
