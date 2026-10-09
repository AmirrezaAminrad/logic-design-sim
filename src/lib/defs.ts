import type { Comp, ICDef, Pin } from './types';

export const mask = (w: number) => (w >= 31 ? 0x7fffffff : (1 << w) - 1);
export const hex = (v: number, w: number) => (v >>> 0).toString(16).toUpperCase().padStart(Math.max(1, Math.ceil(w / 4)), '0');

export type Category = 'gates' | 'io' | 'mux' | 'arith' | 'bus' | 'seq' | 'mem' | 'custom';

export interface PropSpec {
  key: string;
  label: string;
  type: 'number' | 'select' | 'bool' | 'text';
  min?: number;
  max?: number;
  step?: number;
  options?: { v: any; l: string }[];
}

type R = number[] | { o: number[]; st: any };

export interface TypeDef {
  type: string;
  label: string;
  cat: Category;
  desc: string;
  ins: (p: any) => Pin[];
  outs: (p: any) => Pin[];
  defaults: Record<string, any>;
  props?: PropSpec[];
  eval: (i: number[], p: any, st: any) => R;
  init?: (p: any) => any;
  delay: number | ((p: any) => number);
  seq?: boolean;
  sink?: boolean;
  driver?: boolean;
  minH?: number;
  w?: number;
  hidden?: boolean;
  info?: (st: any, p: any) => string[];
  title?: (p: any) => string;
}

const pins = (prefix: string, n: number, w = 1, def?: number): Pin[] =>
  Array.from({ length: n }, (_, i) => ({ name: prefix + i, w, ...(def !== undefined ? { def } : {}) }));
const P = (name: string, w = 1, def?: number): Pin => (def === undefined ? { name, w } : { name, w, def });
const rise = (st: any, clk: number) => clk === 1 && (st?.clk ?? 0) === 0;
const wProp: PropSpec = { key: 'w', label: 'Bit width', type: 'number', min: 1, max: 16 };
const letters = 'ABCDEFGH';

export const TYPES: Record<string, TypeDef> = {};
const reg = (t: TypeDef) => {
  TYPES[t.type] = t;
};

function gate(type: string, label: string, desc: string, fn: (a: number, b: number) => number, inv: boolean, delay: number) {
  reg({
    type, label, cat: 'gates', desc, w: 4,
    ins: (p) => Array.from({ length: p.n }, (_, i) => P(letters[i], p.w)),
    outs: (p) => [P('Y', p.w)],
    defaults: { n: 2, w: 1 },
    props: [{ key: 'n', label: 'Inputs', type: 'number', min: 2, max: 8 }, wProp],
    eval: (i, p) => {
      let r = i[0];
      for (let k = 1; k < i.length; k++) r = fn(r, i[k]);
      if (inv) r = ~r;
      return [r & mask(p.w)];
    },
    delay,
  });
}
gate('and', 'AND', 'Output is 1 only when ALL inputs are 1.  Y = A·B', (a, b) => a & b, false, 2);
gate('or', 'OR', 'Output is 1 when ANY input is 1.  Y = A+B', (a, b) => a | b, false, 2);
gate('nand', 'NAND', 'AND followed by NOT: output is 0 only when all inputs are 1. NAND is "universal" — any circuit can be built from NANDs.', (a, b) => a & b, true, 1);
gate('nor', 'NOR', 'OR followed by NOT: output is 1 only when all inputs are 0. Also a universal gate.', (a, b) => a | b, true, 1);
gate('xor', 'XOR', 'Exclusive OR: output is 1 when an odd number of inputs are 1. The sum bit of an adder.', (a, b) => a ^ b, false, 3);
gate('xnor', 'XNOR', 'Exclusive NOR (equality): output is 1 when an even number of inputs are 1. For 2 inputs: 1 when A = B.', (a, b) => a ^ b, true, 3);
reg({
  type: 'not', label: 'NOT', cat: 'gates', desc: 'Inverter: output is the opposite of the input.  Y = A\'', w: 4, minH: 2,
  ins: (p) => [P('A', p.w)], outs: (p) => [P('Y', p.w)], defaults: { w: 1 }, props: [wProp],
  eval: (i, p) => [~i[0] & mask(p.w)], delay: 1,
});
reg({
  type: 'buf', label: 'Buffer', cat: 'gates', desc: 'Passes its input to the output unchanged. Used to restore signal strength or add a deliberate propagation delay.', w: 4, minH: 2,
  ins: (p) => [P('A', p.w)], outs: (p) => [P('Y', p.w)], defaults: { w: 1 }, props: [wProp],
  eval: (i) => [i[0]], delay: 1,
});

// ---------- I/O ----------
reg({
  type: 'switch', label: 'Toggle Switch', cat: 'io', w: 4, minH: 2, driver: true,
  desc: 'A latching input. Click it on the canvas to flip between 0 and 1.',
  ins: () => [], outs: () => [P('Q')], defaults: { value: 0 },
  eval: (_i, p) => [p.value & 1], delay: 0,
});
reg({
  type: 'button', label: 'Push Button', cat: 'io', w: 4, minH: 2, driver: true,
  desc: 'A momentary input: outputs 1 only while you hold the mouse button down on it. Great for manual clock pulses and resets.',
  ins: () => [], outs: () => [P('Q')], defaults: { value: 0 },
  eval: (_i, p) => [p.value & 1], delay: 0,
});
reg({
  type: 'clock', label: 'Clock', cat: 'io', w: 4, minH: 2,
  desc: 'Square-wave generator. Frequency is adjustable in the properties panel (instant mode uses Hz, propagation-delay mode uses a period in ticks). Click it to toggle manually, or use the Step buttons.',
  ins: () => [], outs: () => [P('CLK')], defaults: { freq: 1, period: 20 },
  props: [
    { key: 'freq', label: 'Frequency (Hz)', type: 'number', min: 0.1, max: 50, step: 0.1 },
    { key: 'period', label: 'Period (ticks, delay mode)', type: 'number', min: 2, max: 400 },
  ],
  init: () => ({ lvl: 0, acc: 0, t: 0 }),
  eval: (_i, _p, st) => ({ o: [st?.lvl ?? 0], st }), delay: 0,
});
reg({
  type: 'led', label: 'LED', cat: 'io', w: 2, minH: 2, sink: true,
  desc: 'Light-emitting diode: glows when its input is 1.',
  ins: () => [P('A')], outs: () => [], defaults: { color: 'red' },
  props: [{ key: 'color', label: 'Color', type: 'select', options: ['red', 'green', 'yellow', 'blue'].map((v) => ({ v, l: v })) }],
  eval: () => [], delay: 0,
});
reg({
  type: 'seg7', label: '7-Segment Display', cat: 'io', w: 6, sink: true,
  desc: 'Seven-segment display with one input per segment (a–g) plus a decimal point. Pair with a 7-segment decoder to show digits.',
  ins: () => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((n) => P(n)), outs: () => [], defaults: {},
  eval: () => [], delay: 0,
});
reg({
  type: 'seg7dec', label: '7-Seg Decoder', cat: 'io', w: 6,
  desc: 'Converts a 4-bit value (0–F) into the seven segment signals a–g for a 7-segment display.',
  ins: () => [P('D', 4)], outs: () => ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => P(n)), defaults: {},
  eval: (i) => {
    const t = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71][i[0]];
    return Array.from({ length: 7 }, (_, k) => (t >> k) & 1);
  },
  delay: 2, title: () => '7SEG DEC',
});
reg({
  type: 'hexdisp', label: 'Hex Display', cat: 'io', w: 4, minH: 2, sink: true,
  desc: 'Shows the value on a multi-bit bus as a hexadecimal (and decimal) number.',
  ins: (p) => [P('A', p.w)], outs: () => [], defaults: { w: 4 }, props: [wProp],
  eval: () => [], delay: 0,
});
reg({
  type: 'numin', label: 'Number Input', cat: 'io', w: 4, minH: 2, driver: true,
  desc: 'Multi-bit constant source you can change at runtime. Click it to increment (shift-click to decrement) or set the exact value in the properties panel.',
  ins: () => [], outs: (p) => [P('Q', p.w)], defaults: { w: 4, value: 0 },
  props: [wProp, { key: 'value', label: 'Value', type: 'number', min: 0, max: 65535 }],
  eval: (_i, p) => [p.value & mask(p.w)], delay: 0,
});
reg({
  type: 'const', label: 'Constant', cat: 'io', w: 2, minH: 2,
  desc: 'A fixed value (logic 0, logic 1, or any n-bit number).',
  ins: () => [], outs: (p) => [P('Q', p.w)], defaults: { w: 1, value: 1 },
  props: [wProp, { key: 'value', label: 'Value', type: 'number', min: 0, max: 65535 }],
  eval: (_i, p) => [p.value & mask(p.w)], delay: 0,
});
reg({
  type: 'pin_in', label: 'IC Input', cat: 'custom', hidden: true, w: 2, minH: 2,
  desc: 'Input pin of a custom IC.',
  // def lets an unconnected IC input fall back to the wrapped component's pin default (e.g. EN=1)
  ins: (p) => [P('in', p.w, p.def)], outs: (p) => [P('out', p.w)], defaults: { w: 1 },
  eval: (i) => [i[0]], delay: 0,
});
reg({
  type: 'pin_out', label: 'IC Output', cat: 'custom', hidden: true, w: 2, minH: 2,
  desc: 'Output pin of a custom IC.',
  ins: (p) => [P('in', p.w)], outs: (p) => [P('out', p.w)], defaults: { w: 1 },
  eval: (i) => [i[0]], delay: 0,
});

// ---------- Muxing / decoding ----------
const sProp: PropSpec = { key: 's', label: 'Select bits', type: 'number', min: 1, max: 3 };
reg({
  type: 'mux', label: 'Multiplexer', cat: 'mux',
  desc: 'Selects ONE of 2ⁿ data inputs and forwards it to the output, based on the select lines S. A digital "railroad switch".',
  ins: (p) => [...pins('D', 1 << p.s, p.w), P('S', p.s)], outs: (p) => [P('Y', p.w)],
  defaults: { s: 1, w: 1 }, props: [sProp, wProp],
  eval: (i, p) => [i[i[1 << p.s]]], delay: 2, title: (p) => `MUX ${1 << p.s}:1`,
});
reg({
  type: 'demux', label: 'Demultiplexer', cat: 'mux',
  desc: 'Routes its single data input D to ONE of 2ⁿ outputs chosen by S. All other outputs are 0.',
  ins: (p) => [P('D', p.w), P('S', p.s)], outs: (p) => pins('Y', 1 << p.s, p.w),
  defaults: { s: 1, w: 1 }, props: [sProp, wProp],
  eval: (i, p) => Array.from({ length: 1 << p.s }, (_, k) => (k === i[1] ? i[0] : 0)), delay: 2, title: (p) => `DEMUX 1:${1 << p.s}`,
});
reg({
  type: 'decoder', label: 'Decoder', cat: 'mux',
  desc: 'Converts an n-bit binary code into a one-hot output: exactly one of 2ⁿ outputs is 1. EN (default 1) enables the decoder.',
  ins: (p) => [P('A', p.n), P('EN', 1, 1)], outs: (p) => pins('Y', 1 << p.n),
  defaults: { n: 2 }, props: [{ key: 'n', label: 'Input bits', type: 'number', min: 1, max: 4 }],
  eval: (i, p) => Array.from({ length: 1 << p.n }, (_, k) => (i[1] && k === i[0] ? 1 : 0)), delay: 2, title: (p) => `DEC ${p.n}:${1 << p.n}`,
});
reg({
  type: 'encoder', label: 'Encoder', cat: 'mux',
  desc: 'The inverse of a decoder: converts a one-hot input into its binary index. Assumes only one input is active (use the priority encoder otherwise).',
  ins: (p) => pins('I', 1 << p.n), outs: (p) => [P('Y', p.n)],
  defaults: { n: 2 }, props: [{ key: 'n', label: 'Output bits', type: 'number', min: 1, max: 3 }],
  eval: (i) => {
    let r = 0;
    i.forEach((v, k) => { if (v) r |= k; });
    return [r];
  }, delay: 2, title: (p) => `ENC ${1 << p.n}:${p.n}`,
});
reg({
  type: 'penc', label: 'Priority Encoder', cat: 'mux',
  desc: 'Encodes the index of the HIGHEST-numbered active input. V (valid) is 1 when any input is active — so index 0 can be told apart from "no input".',
  ins: (p) => pins('I', 1 << p.n), outs: (p) => [P('Y', p.n), P('V')],
  defaults: { n: 2 }, props: [{ key: 'n', label: 'Output bits', type: 'number', min: 1, max: 3 }],
  eval: (i) => {
    let r = 0, v = 0;
    i.forEach((x, k) => { if (x) { r = k; v = 1; } });
    return [r, v];
  }, delay: 3, title: (p) => `PRIO ${1 << p.n}:${p.n}`,
});

// ---------- Arithmetic ----------
reg({
  type: 'halfadder', label: 'Half Adder', cat: 'arith',
  desc: 'Adds two bits. S = A XOR B, C = A AND B.',
  ins: () => [P('A'), P('B')], outs: () => [P('S'), P('C')], defaults: {},
  eval: (i) => [i[0] ^ i[1], i[0] & i[1]], delay: 2, title: () => 'HALF ADD',
});
reg({
  type: 'fulladder', label: 'Full Adder', cat: 'arith',
  desc: 'Adds three bits (A, B and carry-in). Produces a sum bit and a carry-out; chain them to build ripple-carry adders.',
  ins: () => [P('A'), P('B'), P('Cin')], outs: () => [P('S'), P('Cout')], defaults: {},
  eval: (i) => { const t = i[0] + i[1] + i[2]; return [t & 1, t >> 1]; }, delay: 4, title: () => 'FULL ADD',
});
reg({
  type: 'adder', label: 'n-bit Adder', cat: 'arith',
  desc: 'Ripple-carry adder of configurable width: S = A + B + Cin. Carry-out signals overflow of the unsigned result.',
  ins: (p) => [P('A', p.w), P('B', p.w), P('Cin')], outs: (p) => [P('S', p.w), P('Cout')],
  defaults: { w: 4 }, props: [wProp],
  eval: (i, p) => { const t = i[0] + i[1] + i[2]; return [t & mask(p.w), t > mask(p.w) ? 1 : 0]; },
  delay: (p) => 2 + 2 * p.w, title: (p) => `ADD ${p.w}b`,
});
reg({
  type: 'comparator', label: 'Comparator', cat: 'arith',
  desc: 'Compares two unsigned n-bit numbers and raises exactly one of: A>B, A=B, A<B.',
  ins: (p) => [P('A', p.w), P('B', p.w)], outs: () => [P('A>B'), P('A=B'), P('A<B')],
  defaults: { w: 4 }, props: [wProp],
  eval: (i) => [i[0] > i[1] ? 1 : 0, i[0] === i[1] ? 1 : 0, i[0] < i[1] ? 1 : 0], delay: 3, title: (p) => `CMP ${p.w}b`,
});
reg({
  type: 'alu', label: 'ALU', cat: 'arith',
  desc: 'Arithmetic-Logic Unit. OP: 0=ADD 1=SUB 2=AND 3=OR 4=XOR 5=PASS B 6=SHL A 7=NOT A. Flags: Z (result zero), C (carry / borrow).',
  ins: (p) => [P('A', p.w), P('B', p.w), P('OP', 3)], outs: (p) => [P('R', p.w), P('Z'), P('C')],
  defaults: { w: 8 }, props: [wProp],
  eval: (i, p) => {
    const m = mask(p.w), [a, b, op] = i;
    let r = 0, c = 0;
    switch (op) {
      case 0: r = (a + b) & m; c = a + b > m ? 1 : 0; break;
      case 1: r = (a - b) & m; c = a < b ? 1 : 0; break;
      case 2: r = a & b; break;
      case 3: r = a | b; break;
      case 4: r = a ^ b; break;
      case 5: r = b; break;
      case 6: r = (a << 1) & m; c = (a >> (p.w - 1)) & 1; break;
      default: r = ~a & m;
    }
    return [r, r === 0 ? 1 : 0, c];
  },
  delay: 6, title: (p) => `ALU ${p.w}b`,
});

// ---------- Buses ----------
reg({
  type: 'splitter', label: 'Bus Splitter', cat: 'bus',
  desc: 'Splits an n-bit bus into n individual 1-bit wires (b0 = least significant bit).',
  ins: (p) => [P('Bus', p.w)], outs: (p) => pins('b', p.w), defaults: { w: 4 }, props: [wProp],
  eval: (i, p) => Array.from({ length: p.w }, (_, k) => (i[0] >> k) & 1), delay: 0, title: () => 'SPLIT',
});
reg({
  type: 'merger', label: 'Bus Merger', cat: 'bus',
  desc: 'Combines n individual 1-bit wires into a single n-bit bus (b0 = least significant bit).',
  ins: (p) => pins('b', p.w), outs: (p) => [P('Bus', p.w)], defaults: { w: 4 }, props: [wProp],
  eval: (i) => [i.reduce((a, v, k) => a | (v << k), 0)], delay: 0, title: () => 'MERGE',
});
reg({
  type: 'slice', label: 'Bus Slice', cat: 'bus', minH: 2,
  desc: 'Extracts n bits starting at bit position "lo" from a bus: Out = (In >> lo) & mask. Handy for picking fields out of an instruction word.',
  ins: (p) => [P('In', p.w)], outs: (p) => [P('Out', p.n)], defaults: { w: 8, lo: 0, n: 4 },
  props: [wProp, { key: 'lo', label: 'Low bit', type: 'number', min: 0, max: 15 }, { key: 'n', label: 'Bits', type: 'number', min: 1, max: 16 }],
  eval: (i, p) => [(i[0] >> p.lo) & mask(p.n)], delay: 0, title: (p) => `[${p.lo + p.n - 1}:${p.lo}]`,
});

// ---------- Sequential ----------
reg({
  type: 'srlatch', label: 'SR Latch', cat: 'seq', seq: true,
  desc: 'Basic memory cell. S=1 sets Q to 1, R=1 resets Q to 0, S=R=0 remembers. S=R=1 is the forbidden state (both outputs forced to 0).',
  ins: () => [P('S'), P('R')], outs: () => [P('Q'), P('Q̅')], defaults: {},
  init: () => ({ q: 0 }),
  eval: (i, _p, st) => {
    let q = st?.q ?? 0;
    if (i[0] && !i[1]) q = 1; else if (i[1] && !i[0]) q = 0;
    const bad = i[0] && i[1];
    return { o: [bad ? 0 : q, bad ? 0 : 1 - q], st: { q } };
  }, delay: 2, info: (st) => [`Q=${st?.q ?? 0}`],
});
reg({
  type: 'dlatch', label: 'D Latch', cat: 'seq', seq: true,
  desc: 'Level-sensitive latch: while EN=1 the output follows D (transparent); while EN=0 it holds its last value.',
  ins: () => [P('D'), P('EN')], outs: () => [P('Q'), P('Q̅')], defaults: {},
  init: () => ({ q: 0 }),
  eval: (i, _p, st) => { const q = i[1] ? i[0] : st?.q ?? 0; return { o: [q, 1 - q], st: { q } }; },
  delay: 2, info: (st) => [`Q=${st?.q ?? 0}`],
});
reg({
  type: 'dff', label: 'D Flip-Flop', cat: 'seq', seq: true,
  desc: 'Edge-triggered storage: copies D to Q on the RISING edge of CLK, then ignores D until the next edge. CLR (async) forces Q to 0.',
  ins: () => [P('D'), P('CLK'), P('CLR')], outs: () => [P('Q'), P('Q̅')], defaults: {},
  init: () => ({ q: 0, clk: 0 }),
  eval: (i, _p, st) => {
    let q = st?.q ?? 0;
    if (i[2]) q = 0; else if (rise(st, i[1])) q = i[0];
    return { o: [q, 1 - q], st: { q, clk: i[1] } };
  }, delay: 2, info: (st) => [`Q=${st?.q ?? 0}`],
});
reg({
  type: 'jkff', label: 'JK Flip-Flop', cat: 'seq', seq: true,
  desc: 'On the rising clock edge: J=K=0 hold, J=1,K=0 set, J=0,K=1 reset, J=K=1 toggle.',
  ins: () => [P('J'), P('K'), P('CLK'), P('CLR')], outs: () => [P('Q'), P('Q̅')], defaults: {},
  init: () => ({ q: 0, clk: 0 }),
  eval: (i, _p, st) => {
    let q = st?.q ?? 0;
    if (i[3]) q = 0;
    else if (rise(st, i[2])) { if (i[0] && i[1]) q = 1 - q; else if (i[0]) q = 1; else if (i[1]) q = 0; }
    return { o: [q, 1 - q], st: { q, clk: i[2] } };
  }, delay: 2, info: (st) => [`Q=${st?.q ?? 0}`],
});
reg({
  type: 'tff', label: 'T Flip-Flop', cat: 'seq', seq: true,
  desc: 'Toggle flip-flop: on each rising clock edge Q flips if T=1, otherwise holds. With T=1 it divides the clock frequency by two.',
  ins: () => [P('T'), P('CLK'), P('CLR')], outs: () => [P('Q'), P('Q̅')], defaults: {},
  init: () => ({ q: 0, clk: 0 }),
  eval: (i, _p, st) => {
    let q = st?.q ?? 0;
    if (i[2]) q = 0; else if (rise(st, i[1]) && i[0]) q = 1 - q;
    return { o: [q, 1 - q], st: { q, clk: i[1] } };
  }, delay: 2, info: (st) => [`Q=${st?.q ?? 0}`],
});
reg({
  type: 'reg', label: 'Register', cat: 'seq', seq: true,
  desc: 'n-bit register: loads D on the rising clock edge when EN=1 (default 1). CLR asynchronously clears it.',
  ins: (p) => [P('D', p.w), P('CLK'), P('EN', 1, 1), P('CLR')], outs: (p) => [P('Q', p.w)],
  defaults: { w: 4 }, props: [wProp],
  init: () => ({ q: 0, clk: 0 }),
  eval: (i, _p, st) => {
    let q = st?.q ?? 0;
    if (i[3]) q = 0; else if (rise(st, i[1]) && i[2]) q = i[0];
    return { o: [q], st: { q, clk: i[1] } };
  }, delay: 2, title: (p) => `REG ${p.w}b`, info: (st, p) => [`= ${hex(st?.q ?? 0, p.w)}h`],
});
reg({
  type: 'counter', label: 'Counter', cat: 'seq', seq: true,
  desc: 'Counts rising clock edges. UP=1 counts up, UP=0 counts down (default up). LD loads D, CLR clears, EN enables. Binary mode wraps at 2ⁿ; BCD mode counts 0–9. CO is the terminal-count (carry) output.',
  ins: (p) => [P('CLK'), P('EN', 1, 1), P('CLR'), P('UP', 1, 1), P('LD'), P('D', p.mode === 'bcd' ? 4 : p.w)],
  outs: (p) => [P('Q', p.mode === 'bcd' ? 4 : p.w), P('CO')],
  defaults: { w: 4, mode: 'bin' },
  props: [wProp, { key: 'mode', label: 'Mode', type: 'select', options: [{ v: 'bin', l: 'Binary' }, { v: 'bcd', l: 'BCD (0–9)' }] }],
  init: () => ({ q: 0, clk: 0 }),
  eval: (i, p, st) => {
    const [clk, en, clr, up, ld, d] = i;
    const bcd = p.mode === 'bcd';
    const max = bcd ? 9 : mask(p.w);
    let q = st?.q ?? 0;
    if (clr) q = 0;
    else if (rise(st, clk)) {
      if (ld) q = bcd ? Math.min(d, 9) : d;
      else if (en) q = up ? (q >= max ? 0 : q + 1) : q <= 0 ? max : q - 1;
    }
    const co = up ? (q === max ? 1 : 0) : q === 0 ? 1 : 0;
    return { o: [q, co], st: { q, clk } };
  }, delay: 3, title: (p) => (p.mode === 'bcd' ? 'BCD CTR' : `CTR ${p.w}b`), info: (st, p) => [`= ${hex(st?.q ?? 0, 4)}h (${st?.q ?? 0}${p.mode ? '' : ''})`],
});
reg({
  type: 'shiftreg', label: 'Shift Register', cat: 'seq', seq: true,
  desc: 'On each rising clock edge the bits shift one place, taking SI in. DIR=0 shifts left (SI enters at bit 0), DIR=1 shifts right. Q gives the parallel contents, SO the bit shifted out.',
  ins: () => [P('SI'), P('CLK'), P('EN', 1, 1), P('CLR'), P('DIR')], outs: (p) => [P('Q', p.w), P('SO')],
  defaults: { w: 4 }, props: [wProp],
  init: () => ({ q: 0, clk: 0 }),
  eval: (i, p, st) => {
    const [si, clk, en, clr, dir] = i;
    let q = st?.q ?? 0;
    if (clr) q = 0;
    else if (rise(st, clk) && en) q = dir ? (q >> 1) | (si << (p.w - 1)) : (q << 1) | si;
    q &= mask(p.w);
    return { o: [q, dir ? q & 1 : (q >> (p.w - 1)) & 1], st: { q, clk } };
  }, delay: 2, title: (p) => `SHIFT ${p.w}b`, info: (st, p) => [`= ${(st?.q ?? 0).toString(2).padStart(p.w, '0')}b`],
});

// ---------- Memory ----------
reg({
  type: 'rom', label: 'ROM', cat: 'mem', seq: false,
  desc: 'Read-only memory: DATA = contents[ADDR] (asynchronous read). Edit the contents in the properties panel or load a program from the assembler.',
  ins: (p) => [P('ADDR', p.a)], outs: (p) => [P('DATA', p.w)],
  defaults: { a: 4, w: 8, data: [] },
  props: [{ key: 'a', label: 'Address bits', type: 'number', min: 1, max: 8 }, { key: 'w', label: 'Data bits', type: 'number', min: 1, max: 16 }],
  eval: (i, p) => [p.data?.[i[0]] ?? 0], delay: 4, title: (p) => `ROM ${1 << p.a}×${p.w}`,
});
reg({
  type: 'ram', label: 'RAM', cat: 'mem', seq: true,
  desc: 'Read/write memory. Asynchronous read; when WE=1 the DIN value is written to ADDR on the rising clock edge.',
  ins: (p) => [P('ADDR', p.a), P('DIN', p.w), P('WE'), P('CLK')], outs: (p) => [P('DOUT', p.w)],
  defaults: { a: 4, w: 8 },
  props: [{ key: 'a', label: 'Address bits', type: 'number', min: 1, max: 8 }, { key: 'w', label: 'Data bits', type: 'number', min: 1, max: 16 }],
  init: () => ({ mem: [], clk: 0 }),
  eval: (i, _p, st) => {
    const mem: number[] = st?.mem ?? [];
    let m = mem;
    if (rise(st, i[3]) && i[2]) { m = mem.slice(); m[i[0]] = i[1]; }
    return { o: [m[i[0]] ?? 0], st: { mem: m, clk: i[3] } };
  }, delay: 4, title: (p) => `RAM ${1 << p.a}×${p.w}`,
});
reg({
  type: 'regfile', label: 'Register File', cat: 'mem', seq: true,
  desc: 'A bank of registers with two read ports (RA→QA, RB→QB) and one write port (WA, WD, WE) written on the rising clock edge.',
  ins: (p) => [P('RA', p.a), P('RB', p.a), P('WA', p.a), P('WD', p.w), P('WE'), P('CLK')], outs: (p) => [P('QA', p.w), P('QB', p.w)],
  defaults: { a: 2, w: 8 },
  props: [{ key: 'a', label: 'Address bits', type: 'number', min: 1, max: 3 }, { key: 'w', label: 'Data bits', type: 'number', min: 1, max: 16 }],
  init: (p) => ({ regs: new Array(1 << p.a).fill(0), clk: 0 }),
  eval: (i, _p, st) => {
    const regs: number[] = st?.regs ?? [];
    let r = regs;
    if (rise(st, i[5]) && i[4]) { r = regs.slice(); r[i[2]] = i[3]; }
    return { o: [r[i[0]] ?? 0, r[i[1]] ?? 0], st: { regs: r, clk: i[5] } };
  }, delay: 4, title: (p) => `REGFILE ${1 << p.a}×${p.w}`,
  info: (st, p) => {
    const r: number[] = st?.regs ?? [];
    const lines: string[] = [];
    for (let k = 0; k < (1 << p.a); k += 2) lines.push(`R${k}=${hex(r[k] ?? 0, p.w)}` + (k + 1 < (1 << p.a) ? `  R${k + 1}=${hex(r[k + 1] ?? 0, p.w)}` : ''));
    return lines;
  },
});

// ---------- palette ----------
export interface PItem { type: string; label?: string; props?: Record<string, any>; }
export const PALETTE: { cat: Category; title: string; items: PItem[] }[] = [
  { cat: 'gates', title: 'Logic Gates', items: ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buf'].map((type) => ({ type })) },
  {
    cat: 'io', title: 'Input / Output',
    items: [{ type: 'switch' }, { type: 'button' }, { type: 'clock' }, { type: 'const' }, { type: 'numin' }, { type: 'led' }, { type: 'seg7' }, { type: 'seg7dec' }, { type: 'hexdisp' }],
  },
  {
    cat: 'mux', title: 'Mux / Decode',
    items: [
      { type: 'mux', label: 'MUX 2:1', props: { s: 1 } }, { type: 'mux', label: 'MUX 4:1', props: { s: 2 } }, { type: 'mux', label: 'MUX 8:1', props: { s: 3 } },
      { type: 'demux', label: 'DEMUX 1:2', props: { s: 1 } }, { type: 'demux', label: 'DEMUX 1:4', props: { s: 2 } }, { type: 'demux', label: 'DEMUX 1:8', props: { s: 3 } },
      { type: 'decoder', label: 'Decoder 2:4', props: { n: 2 } }, { type: 'decoder', label: 'Decoder 3:8', props: { n: 3 } },
      { type: 'encoder', label: 'Encoder 4:2', props: { n: 2 } }, { type: 'encoder', label: 'Encoder 8:3', props: { n: 3 } },
      { type: 'penc', label: 'Priority Enc 4:2', props: { n: 2 } }, { type: 'penc', label: 'Priority Enc 8:3', props: { n: 3 } },
    ],
  },
  {
    cat: 'arith', title: 'Arithmetic',
    items: [{ type: 'halfadder' }, { type: 'fulladder' }, { type: 'adder', label: '4-bit Adder' }, { type: 'comparator', label: '4-bit Comparator' }, { type: 'alu', label: '8-bit ALU' }],
  },
  { cat: 'bus', title: 'Buses', items: [{ type: 'splitter' }, { type: 'merger' }, { type: 'slice' }] },
  {
    cat: 'seq', title: 'Sequential',
    items: [
      { type: 'srlatch' }, { type: 'dlatch' }, { type: 'dff' }, { type: 'jkff' }, { type: 'tff' }, { type: 'reg', label: '4-bit Register' },
      { type: 'counter', label: 'Binary Counter', props: { mode: 'bin' } }, { type: 'counter', label: 'BCD Counter', props: { mode: 'bcd', w: 4 } }, { type: 'shiftreg' },
    ],
  },
  { cat: 'mem', title: 'Memory', items: [{ type: 'rom' }, { type: 'ram' }, { type: 'regfile' }] },
];

export const CAT_COLOR: Record<Category, string> = {
  gates: '#3b82f6', io: '#94a3b8', mux: '#14b8a6', arith: '#eab308', bus: '#38bdf8', seq: '#f97316', mem: '#818cf8', custom: '#d946ef',
};
export const GATE_COLOR: Record<string, string> = {
  and: '#3b82f6', or: '#22c55e', not: '#ef4444', buf: '#94a3b8', nand: '#06b6d4', nor: '#f59e0b', xor: '#a855f7', xnor: '#ec4899',
};

export function pinsOf(c: Comp, defs: Record<string, ICDef>): { ins: Pin[]; outs: Pin[] } {
  if (c.type === 'ic') {
    const d = defs[c.props.def];
    if (!d) return { ins: [], outs: [] };
    return { ins: d.inputs.map((x) => ({ name: x.label, w: x.w })), outs: d.outputs.map((x) => ({ name: x.label, w: x.w })) };
  }
  const t = TYPES[c.type];
  if (!t) return { ins: [], outs: [] };
  return { ins: t.ins(c.props), outs: t.outs(c.props) };
}

export const delayOf = (type: string, props: any) => {
  const t = TYPES[type];
  if (!t) return 0;
  return typeof t.delay === 'function' ? t.delay(props) : t.delay;
};

export function defaultName(type: string, comps: Comp[]): string {
  const inputs = ['switch', 'button', 'numin'];
  if (inputs.includes(type)) {
    const n = comps.filter((c) => inputs.includes(c.type)).length;
    return String.fromCharCode(65 + (n % 26));
  }
  if (type === 'led' || type === 'hexdisp') return 'Y' + comps.filter((c) => c.type === 'led' || c.type === 'hexdisp').length;
  if (type === 'clock') return 'CLK';
  return '';
}

export function newComp(type: string, x: number, y: number, props: Record<string, any> | undefined, comps: Comp[], id: string): Comp {
  const t = TYPES[type];
  const base = t ? JSON.parse(JSON.stringify(t.defaults)) : {};
  return { id, type, x, y, rot: 0, name: defaultName(type, comps), props: { ...base, ...(props || {}) } };
}
