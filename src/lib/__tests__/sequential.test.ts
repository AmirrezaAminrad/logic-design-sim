import { describe, expect, it } from 'vitest';
import { Engine } from '../engine';
import { TB, mk } from './helpers';

describe('latches', () => {
  it('SR latch: set, reset, hold, forbidden', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'S');
    t.add('switch', 0, 60, {}, 'R');
    t.add('srlatch', 200, 0, {}, 'L');
    t.w('S', 'Q', 'L', 'S');
    t.w('R', 'Q', 'L', 'R');
    const { out, setIn } = mk(t.circuit());
    setIn('S', 1); expect(out('L', 0)).toBe(1); expect(out('L', 1)).toBe(0);
    setIn('S', 0); expect(out('L', 0)).toBe(1); // holds
    setIn('R', 1); expect(out('L', 0)).toBe(0); expect(out('L', 1)).toBe(1);
    setIn('R', 0); expect(out('L', 0)).toBe(0); // holds
    setIn('S', 1); setIn('R', 1);               // forbidden → both outputs 0
    expect(out('L', 0)).toBe(0); expect(out('L', 1)).toBe(0);
    setIn('S', 0);
    expect(out('L', 0)).toBe(0); // reset wins after release
  });
  it('D latch: transparent while EN=1, holds while EN=0', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'D');
    t.add('switch', 0, 60, {}, 'EN');
    t.add('dlatch', 200, 0, {}, 'L');
    t.w('D', 'Q', 'L', 'D');
    t.w('EN', 'Q', 'L', 'EN');
    const { out, setIn } = mk(t.circuit());
    setIn('EN', 1); setIn('D', 1); expect(out('L', 0)).toBe(1);
    setIn('EN', 0); setIn('D', 0); expect(out('L', 0)).toBe(1); // holds
    setIn('EN', 1); expect(out('L', 0)).toBe(0); // transparent again
  });
});

describe('flip-flops', () => {
  it('D flip-flop copies D only on the rising edge', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'D');
    t.add('clock', 0, 60, { freq: 1 }, 'CLK');
    t.add('dff', 200, 0, {}, 'F');
    t.w('D', 'Q', 'F', 'D');
    t.w('CLK', 'CLK', 'F', 'CLK');
    const { e, out, setIn } = mk(t.circuit());
    setIn('D', 1);
    expect(out('F', 0)).toBe(0); // no edge yet
    e.halfStep();                // rising edge
    expect(out('F', 0)).toBe(1);
    setIn('D', 0);
    expect(out('F', 0)).toBe(1); // input changed, no edge: holds
    e.halfStep();                // falling edge: no capture
    expect(out('F', 0)).toBe(1);
    e.halfStep();                // next rising edge captures 0
    expect(out('F', 0)).toBe(0);
  });
  it('D flip-flop async CLR', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'D');
    t.add('clock', 0, 60, {}, 'CLK');
    t.add('switch', 0, 120, {}, 'CLR');
    t.add('dff', 200, 0, {}, 'F');
    t.w('D', 'Q', 'F', 'D');
    t.w('CLK', 'CLK', 'F', 'CLK');
    t.w('CLR', 'Q', 'F', 'CLR');
    const { e, out, setIn } = mk(t.circuit());
    setIn('D', 1); e.halfStep();
    expect(out('F', 0)).toBe(1);
    setIn('CLR', 1);
    expect(out('F', 0)).toBe(0); // asynchronous: no clock edge needed
  });
  it('JK flip-flop: set, reset, hold, toggle', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'J');
    t.add('switch', 0, 60, {}, 'K');
    t.add('clock', 0, 120, {}, 'CLK');
    t.add('jkff', 200, 0, {}, 'F');
    t.w('J', 'Q', 'F', 'J');
    t.w('K', 'Q', 'F', 'K');
    t.w('CLK', 'CLK', 'F', 'CLK');
    const { e, out, setIn } = mk(t.circuit());
    setIn('J', 1); setIn('K', 0); e.halfStep();          // rising: set
    expect(out('F', 0)).toBe(1);
    setIn('J', 0); setIn('K', 0);
    e.halfStep(); e.halfStep();                           // falling + rising: hold
    expect(out('F', 0)).toBe(1);
    setIn('K', 1);
    e.halfStep(); e.halfStep();                           // falling + rising: reset
    expect(out('F', 0)).toBe(0);
    setIn('J', 1);
    e.halfStep(); e.halfStep();                           // falling + rising: toggle 0→1
    expect(out('F', 0)).toBe(1);
    e.halfStep(); e.halfStep();                           // falling + rising: toggle 1→0
    expect(out('F', 0)).toBe(0);
  });
  it('T flip-flop divides by two when T=1', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'T');
    t.add('clock', 0, 60, {}, 'CLK');
    t.add('tff', 200, 0, {}, 'F');
    t.w('T', 'Q', 'F', 'T');
    t.w('CLK', 'CLK', 'F', 'CLK');
    const { e, out, setIn } = mk(t.circuit());
    setIn('T', 1);
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) { e.halfStep(); seen.push(out('F', 0)); }
    expect(seen).toEqual([1, 1, 0, 0, 1, 1]); // changes only on rising edges
  });
});

describe('registers / counters / shift register', () => {
  it('register loads on rising edge when EN=1', () => {
    const t = new TB();
    t.add('numin', 0, 0, { w: 4, value: 9 }, 'D');
    t.add('clock', 0, 60, {}, 'CLK');
    t.add('switch', 0, 120, {}, 'EN');
    t.add('switch', 0, 180, {}, 'CLR');
    t.add('reg', 200, 0, { w: 4 }, 'R');
    t.w('D', 'Q', 'R', 'D');
    t.w('CLK', 'CLK', 'R', 'CLK');
    t.w('EN', 'Q', 'R', 'EN');
    t.w('CLR', 'Q', 'R', 'CLR');
    const { e, out, setIn } = mk(t.circuit());
    setIn('EN', 1);
    e.halfStep();
    expect(out('R')).toBe(9); // EN=1 via switch
    t.comps.find((c) => c.name === 'D')!.props.value = 4;
    setIn('EN', 0);
    e.halfStep(); e.halfStep();
    expect(out('R')).toBe(9); // EN=0 holds
    setIn('EN', 1);
    e.halfStep(); e.halfStep();
    expect(out('R')).toBe(4);
    setIn('CLR', 1);
    expect(out('R')).toBe(0);
  });
  it('binary counter counts up, wraps, and counts down; LD and CO work', () => {
    const t = new TB();
    t.add('clock', 0, 0, {}, 'CLK');
    t.add('switch', 0, 60, {}, 'UP');
    t.add('switch', 0, 120, {}, 'LD');
    t.add('numin', 0, 180, { w: 4, value: 14 }, 'D');
    t.add('counter', 200, 0, { w: 4, mode: 'bin' }, 'C');
    t.w('CLK', 'CLK', 'C', 'CLK');
    t.w('UP', 'Q', 'C', 'UP');
    t.w('LD', 'Q', 'C', 'LD');
    t.w('D', 'Q', 'C', 'D');
    const { e, out, setIn } = mk(t.circuit());
    setIn('UP', 1);
    setIn('LD', 1); e.halfStep();            // rising → load 14
    expect(out('C')).toBe(14);
    setIn('LD', 0);
    e.halfStep(); e.halfStep();              // falling + rising → count to 15
    expect(out('C')).toBe(15);
    expect(out('C', 1)).toBe(1);             // CO terminal count
    e.halfStep(); e.halfStep();              // rising → wrap to 0
    expect(out('C')).toBe(0);
    setIn('UP', 0);
    e.halfStep(); e.halfStep();              // down-count wraps 0 → 15
    expect(out('C')).toBe(15);
    expect(out('C', 1)).toBe(0);
  });
  it('BCD counter wraps at 9', () => {
    const t = new TB();
    t.add('clock', 0, 0, {}, 'CLK');
    t.add('counter', 200, 0, { w: 4, mode: 'bcd' }, 'C');
    t.w('CLK', 'CLK', 'C', 'CLK');
    const { e, out } = mk(t.circuit());
    for (let i = 0; i < 18; i++) e.halfStep(); // 9 rising edges → 9
    expect(out('C')).toBe(9);
    expect(out('C', 1)).toBe(1);
    e.halfStep(); e.halfStep();                // 10th rising edge → wrap to 0
    expect(out('C')).toBe(0);
    expect(out('C', 1)).toBe(0);
  });
  it('shift register shifts left then right', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'SI');
    t.add('clock', 0, 60, {}, 'CLK');
    t.add('switch', 0, 120, {}, 'DIR');
    t.add('shiftreg', 200, 0, { w: 4 }, 'S');
    t.w('SI', 'Q', 'S', 'SI');
    t.w('CLK', 'CLK', 'S', 'CLK');
    t.w('DIR', 'Q', 'S', 'DIR');
    const { e, out, setIn } = mk(t.circuit());
    setIn('SI', 1);
    for (let i = 0; i < 6; i++) e.halfStep();  // 3 rising edges, left shift
    expect(out('S')).toBe(0b0111);             // SI enters at bit 0
    expect(out('S', 1)).toBe(0);               // SO = bit 3
    setIn('SI', 0); setIn('DIR', 1);
    e.halfStep(); e.halfStep();                // right shift
    expect(out('S')).toBe(0b0011);
    expect(out('S', 1)).toBe(1);               // SO = bit 0 exiting
  });
});

describe('memory', () => {
  it('ROM reads contents at ADDR', () => {
    const t = new TB();
    t.add('numin', 0, 0, { w: 4, value: 2 }, 'A');
    t.add('rom', 200, 0, { a: 4, w: 8, data: [10, 20, 30, 40] }, 'M');
    t.w('A', 'Q', 'M', 'ADDR');
    const { out, setIn } = mk(t.circuit());
    expect(out('M')).toBe(30);
    setIn('A', 0);
    expect(out('M')).toBe(10);
    setIn('A', 9); // beyond data → 0
    expect(out('M')).toBe(0);
  });
  it('RAM writes on rising edge with WE, reads asynchronously', () => {
    const t = new TB();
    t.add('numin', 0, 0, { w: 4, value: 3 }, 'A');
    t.add('numin', 0, 60, { w: 8, value: 77 }, 'DI');
    t.add('switch', 0, 120, {}, 'WE');
    t.add('clock', 0, 180, {}, 'CLK');
    t.add('ram', 200, 0, { a: 4, w: 8 }, 'M');
    t.w('A', 'Q', 'M', 'ADDR');
    t.w('DI', 'Q', 'M', 'DIN');
    t.w('WE', 'Q', 'M', 'WE');
    t.w('CLK', 'CLK', 'M', 'CLK');
    const { e, out, setIn } = mk(t.circuit());
    setIn('WE', 1);
    expect(out('M')).toBe(0); // not written yet
    e.halfStep();             // rising edge → write
    expect(out('M')).toBe(77);
    setIn('WE', 0); setIn('A', 1);
    expect(out('M')).toBe(0);
    setIn('A', 3);
    expect(out('M')).toBe(77); // async read
  });
  it('register file: write port + two read ports', () => {
    const t = new TB();
    t.add('clock', 0, 0, {}, 'CLK');
    t.add('numin', 0, 60, { w: 2, value: 2 }, 'WA');
    t.add('numin', 0, 120, { w: 8, value: 200 }, 'WD');
    t.add('switch', 0, 180, {}, 'WE');
    t.add('numin', 0, 240, { w: 2, value: 2 }, 'RA');
    t.add('numin', 0, 300, { w: 2, value: 1 }, 'RB');
    t.add('regfile', 200, 0, { a: 2, w: 8 }, 'RF');
    t.w('CLK', 'CLK', 'RF', 'CLK');
    t.w('WA', 'Q', 'RF', 'WA'); t.w('WD', 'Q', 'RF', 'WD'); t.w('WE', 'Q', 'RF', 'WE');
    t.w('RA', 'Q', 'RF', 'RA'); t.w('RB', 'Q', 'RF', 'RB');
    const { e, out, setIn } = mk(t.circuit());
    setIn('WE', 1);
    e.halfStep();
    expect(out('RF', 0)).toBe(200); // QA = R2
    expect(out('RF', 1)).toBe(0);   // QB = R1
  });
});

describe('clock component', () => {
  it('advance() toggles at the configured frequency in instant mode', () => {
    const t = new TB();
    t.add('clock', 0, 0, { freq: 10 }, 'CLK');
    const { e, out } = mk(t.circuit());
    expect(out('CLK')).toBe(0);
    expect(e.advance(0.05)).toBe(true); // 10 Hz → exactly 1 half-cycle in 50 ms
    expect(out('CLK')).toBe(1);
    e.advance(0.05);
    expect(out('CLK')).toBe(0);
  });
  it('toggleClock flips the phase', () => {
    const t = new TB();
    const id = t.add('clock', 0, 0, { freq: 1 }, 'CLK');
    const { e, out } = mk(t.circuit());
    e.toggleClock(id);
    expect(out('CLK')).toBe(1);
  });
});

describe('engine timing', () => {
  it('delay mode: AND output appears after its 2-tick transport delay', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'A');
    t.add('switch', 0, 60, {}, 'B');
    t.add('and', 200, 0, {}, 'G');
    t.w('A', 'Q', 'G', 'A');
    t.w('B', 'Q', 'G', 'B');
    const c = t.circuit();
    const e = new Engine();
    e.setMode('delay');
    e.sync(c);
    c.comps.find((x) => x.name === 'A')!.props.value = 1;
    c.comps.find((x) => x.name === 'B')!.props.value = 1;
    e.sync(c); // same path the app uses for input changes
    const and = c.comps.find((x) => x.name === 'G')!;
    const vals: number[] = [];
    for (let i = 0; i < 4; i++) { e.tick(); vals.push(e.outOf(and.id, 0)); }
    expect(vals).toEqual([0, 0, 1, 1]); // input change evaluated at tick 1, visible after the 2-tick transport delay
  });
  it('instant mode flags an oscillating XOR feedback loop as unstable', () => {
    const t = new TB();
    t.add('switch', 0, 0, {}, 'A');
    t.add('xor', 200, 0, {}, 'X');
    t.w('A', 'Q', 'X', 'A');
    t.w('X', 'Y', 'X', 'B'); // Y = A ^ Y → oscillates when A=1
    const { e, out, setIn } = mk(t.circuit());
    setIn('A', 0);
    expect(out('X')).toBe(0); // Y = 0 ^ 0 is a stable fixed point
    setIn('A', 1);
    expect(e.unstable).toBe(true);
  });
  it('state survives prop-only edits (rebuild preserves sequential state)', () => {
    const t = new TB();
    t.add('clock', 0, 0, {}, 'CLK');
    t.add('counter', 200, 0, { w: 4 }, 'C');
    t.add('switch', 0, 120, {}, 'S');
    t.w('CLK', 'CLK', 'C', 'CLK');
    const { e, out, setIn } = mk(t.circuit());
    e.halfStep(); e.halfStep(); e.halfStep(); e.halfStep(); // 2 rising edges → 2
    expect(out('C')).toBe(2);
    setIn('S', 1); // unrelated structural-looking change
    expect(out('C')).toBe(2); // counter state preserved
  });
});
