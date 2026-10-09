import { describe, expect, it } from 'vitest';
import { Engine, truthTable } from '../engine';
import { delayOf } from '../defs';
import { packageSelection } from '../ic';
import { TB, mk } from './helpers';
import type { Circuit } from '../types';

function halfAdderCircuit(): Circuit {
  const t = new TB();
  t.add('switch', 0, 0, {}, 'A');
  t.add('switch', 0, 60, {}, 'B');
  t.add('xor', 200, 0, {}, 'X');
  t.add('and', 200, 80, {}, 'N');
  t.add('led', 400, 0, {}, 'Sum');
  t.add('led', 400, 80, {}, 'Carry');
  t.w('A', 'Q', 'X', 'A'); t.w('B', 'Q', 'X', 'B');
  t.w('A', 'Q', 'N', 'A'); t.w('B', 'Q', 'N', 'B');
  t.w('X', 'Y', 'Sum', 'A'); t.w('N', 'Y', 'Carry', 'A');
  return t.circuit();
}

describe('IC packaging', () => {
  it('packages a half adder into a 2-in/2-out IC', () => {
    const c = halfAdderCircuit();
    const r = packageSelection(c, c.comps.map((x) => x.id), 'HA');
    expect(r.error).toBeUndefined();
    const def = r.def!;
    expect(def.inputs.map((i) => i.label)).toEqual(['A', 'B']);
    expect(def.outputs.map((i) => i.label)).toEqual(['Sum', 'Carry']);
    // switches and LEDs were converted to pin_in / pin_out
    expect(def.comps.filter((x) => x.type === 'pin_in').length).toBe(2);
    expect(def.comps.filter((x) => x.type === 'pin_out').length).toBe(2);
    expect(def.comps.filter((x) => x.type === 'switch' || x.type === 'led').length).toBe(0);
  });
  it('nested ICs simulate correctly (full adder from two half-adder ICs)', () => {
    const haCirc = halfAdderCircuit();
    const ha = packageSelection(haCirc, haCirc.comps.map((x) => x.id), 'HA').def!;
    const t = new TB();
    t.add('switch', 0, 0, {}, 'A');
    t.add('switch', 0, 60, {}, 'B');
    t.add('switch', 0, 120, {}, 'Ci');
    const h1 = t.addDef(ha);
    const h2 = t.addDef(ha);
    t.add('or', 400, 0, {}, 'O');
    t.w('A', 'Q', h1, 'A'); t.w('B', 'Q', h1, 'B');
    t.w(h1, 'Sum', h2, 'A'); t.w('Ci', 'Q', h2, 'B');
    t.w(h1, 'Carry', 'O', 'A'); t.w(h2, 'Carry', 'O', 'B');
    const { out, setIn } = mk(t.circuit());
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let ci = 0; ci < 2; ci++) {
      setIn('A', a); setIn('B', b); setIn('Ci', ci);
      expect(out(h2, 0)).toBe((a + b + ci) & 1);       // h2.Sum
      expect(out('O', 0)).toBe(a + b + ci > 1 ? 1 : 0); // carry-out
    }
  });
  it('an IC can be packaged from an IC-containing circuit (depth-3 nesting)', () => {
    const haCirc = halfAdderCircuit();
    const ha = packageSelection(haCirc, haCirc.comps.map((x) => x.id), 'HA').def!;
    const t1 = new TB();
    t1.add('switch', 0, 0, {}, 'A');
    t1.add('switch', 0, 60, {}, 'B');
    t1.add('switch', 0, 120, {}, 'Ci');
    const h1 = t1.addDef(ha);
    const h2 = t1.addDef(ha);
    t1.add('or', 400, 0, {}, 'O');
    t1.add('led', 600, 0, {}, 'Sum');
    t1.add('led', 600, 80, {}, 'Cout');
    t1.w('A', 'Q', h1, 'A'); t1.w('B', 'Q', h1, 'B');
    t1.w(h1, 'Sum', h2, 'A'); t1.w('Ci', 'Q', h2, 'B');
    t1.w(h1, 'Carry', 'O', 'A'); t1.w(h2, 'Carry', 'O', 'B');
    t1.w(h2, 'Sum', 'Sum', 'A'); t1.w('O', 'Y', 'Cout', 'A');
    const c1 = t1.circuit();
    const fa = packageSelection(c1, c1.comps.map((x) => x.id), 'FA').def!;
    expect(fa.inputs.map((i) => i.label)).toEqual(['A', 'B', 'Ci']);
    expect(fa.comps.some((x) => x.type === 'ic')).toBe(true); // contains the HA ICs

    const t2 = new TB();
    t2.defs[ha.id] = ha; // a packaged def referencing nested ICs needs its dependencies present
    t2.add('switch', 0, 0, {}, 'A');
    t2.add('switch', 0, 60, {}, 'B');
    t2.add('switch', 0, 120, {}, 'Ci');
    const fa1 = t2.addDef(fa);
    t2.w('A', 'Q', fa1, 'A'); t2.w('B', 'Q', fa1, 'B'); t2.w('Ci', 'Q', fa1, 'Ci');
    const { out, setIn } = mk(t2.circuit());
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let ci = 0; ci < 2; ci++) {
      setIn('A', a); setIn('B', b); setIn('Ci', ci);
      expect(out(fa1, 0)).toBe((a + b + ci) & 1);
      expect(out(fa1, 1)).toBe(a + b + ci > 1 ? 1 : 0);
    }
  });
});

describe('truth table generation', () => {
  it('exhaustively simulates a selected half adder', () => {
    const c = halfAdderCircuit();
    const tt = truthTable(c, c.comps.map((x) => x.id));
    expect(tt.error).toBeUndefined();
    expect(tt.inCols.map((x) => x.label)).toEqual(['A', 'B']);
    expect(tt.rows).toEqual([
      { ins: [0, 0], outs: [0, 0] },
      { ins: [0, 1], outs: [1, 0] },
      { ins: [1, 0], outs: [1, 0] },
      { ins: [1, 1], outs: [0, 1] },
    ]);
    // Sum is the first out column (LEDs become output columns in circuit order)
    expect(tt.outCols.map((x) => x.label)).toEqual(['Sum', 'Carry']);
  });
  it('synthesizes drivers for unconnected gate inputs', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'A');
    t.add('and', 200, 0, {}, 'G'); // B left unconnected
    t.w('A', 'Q', 'G', 'A');
    const c = t.circuit();
    const tt = truthTable(c, c.comps.map((x) => x.id));
    expect(tt.error).toBeUndefined();
    expect(tt.inCols.length).toBe(2); // A + synthesized G.B
    const ones = tt.rows.filter((r) => r.ins[0] === 1 && r.ins[1] === 1);
    expect(ones).toHaveLength(1);
    expect(ones[0].outs[0]).toBe(1);
  });
  it('rejects selections with too many input bits', () => {
    const t = new TB();
    for (let i = 0; i < 7; i++) t.add('numin', 0, i * 40, { w: 2, value: 0 }, 'N' + i);
    t.add('xor', 300, 0, { w: 2 }, 'X');
    for (let i = 0; i < 7; i++) t.w('N' + i, 'Q', 'X', 'A');
    const c = t.circuit();
    const tt = truthTable(c, c.comps.map((x) => x.id));
    expect(tt.error).toMatch(/Too many input bits/);
  });
  it('notes when the selection contains state elements', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'D');
    t.add('clock', 0, 60, {}, 'CLK');
    t.add('dff', 200, 0, {}, 'F');
    t.w('D', 'Q', 'F', 'D');
    t.w('CLK', 'CLK', 'F', 'CLK');
    const c = t.circuit();
    const tt = truthTable(c, c.comps.map((x) => x.id));
    expect(tt.note).toMatch(/state elements/);
  });
  it('resetState makes sequential rows independent (oracle: fresh engine per row)', () => {
    // Row 4 (A=1, S=0, R=0) is a hold row that follows the rows that set the
    // latch: carried state keeps Q=1 there, reset state starts clean at Q=0.
    const t = new TB();
    t.add('switch', 0, 0, {}, 'A');
    t.add('switch', 0, 60, {}, 'S');
    t.add('switch', 0, 120, {}, 'R');
    t.add('srlatch', 300, 0, {}, 'L');
    t.w('S', 'Q', 'L', 'S');
    t.w('R', 'Q', 'L', 'R');
    const c = t.circuit();
    const ids = c.comps.map((x) => x.id);
    const carried = truthTable(c, ids);
    const reset = truthTable(c, ids, { resetState: true });
    expect(reset.hasSeq).toBe(true);
    expect(reset.setters.every((s) => s.real)).toBe(true);
    expect(carried.rows.map((r) => r.outs[0])).toEqual([0, 0, 1, 0, 1, 0, 1, 0]);
    expect(reset.rows.map((r) => r.outs[0])).toEqual([0, 0, 1, 0, 0, 0, 1, 0]);
    // oracle: an independent fresh engine per row must match the reset table
    const latch = c.comps.find((x) => x.name === 'L')!;
    for (const row of reset.rows) {
      const e = new Engine();
      e.sync(c);
      reset.setters.forEach((s, i) => { c.comps.find((x) => x.id === s.id)!.props.value = row.ins[i]; });
      e.settle();
      expect(row.outs).toEqual(reset.outCols.map((_o, k) => e.outOf(latch.id, k)));
    }
  });
});

describe('critical path analysis', () => {
  it('finds the longest combinational path and its delay', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'A');
    t.add('switch', 0, 60, {}, 'B');
    t.add('xor', 200, 0, {}, 'X');   // delay 3
    t.add('and', 400, 0, {}, 'N');   // delay 2
    t.add('led', 600, 0, {}, 'L');
    t.w('A', 'Q', 'X', 'A'); t.w('B', 'Q', 'X', 'B');
    t.w('X', 'Y', 'N', 'A'); t.w('B', 'Q', 'N', 'B');
    t.w('N', 'Y', 'L', 'A');
    const e = new Engine();
    e.sync(t.circuit());
    const crit = e.critical()!;
    expect(crit.delay).toBe(5); // A → XOR(3) → AND(2) → LED(0)
    expect(crit.loops).toBe(false);
    const names = crit.tops.map((id) => t.circuit().comps.find((c) => c.id === id)?.name);
    expect(names).toContain('A');
    expect(names).toContain('X');
    expect(names).toContain('N');
  });
  it('stops at sequential boundaries', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'A');
    t.add('dff', 200, 0, {}, 'F');
    t.add('xor', 400, 0, {}, 'X');
    t.add('and', 600, 0, {}, 'N');
    t.w('A', 'Q', 'F', 'D');
    t.w('F', 'Q', 'X', 'A'); t.w('F', 'Q', 'X', 'B');
    t.w('X', 'Y', 'N', 'A'); t.w('F', 'Q̅', 'N', 'B');
    const e = new Engine();
    e.sync(t.circuit());
    const crit = e.critical()!;
    // longest path starts at the flip-flop output: FF(clk→Q, 2) → XOR(3) → AND(2) = 7
    expect(crit.delay).toBe(7);
    expect(crit.tops).toContain(t.comps.find((c) => c.name === 'F')!.id);
    expect(crit.tops).not.toContain(t.comps.find((c) => c.name === 'A')!.id);
  });
  it('n-bit adder delay grows with width', () => {
    expect(delayOf('adder', { w: 1 })).toBe(4);
    expect(delayOf('adder', { w: 8 })).toBe(18);
    expect(delayOf('and', {})).toBe(2);
    expect(delayOf('xor', {})).toBe(3);
  });
});
