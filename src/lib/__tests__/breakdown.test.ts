import { describe, expect, it } from 'vitest';
import { Engine } from '../engine';
import { breakDown, customize } from '../breakdown';
import { packageSelection } from '../ic';
import { TYPES, pinsOf } from '../defs';
import { bbox, layoutOf } from '../geometry';
import { TEMPLATES } from '../templates';
import type { Circuit, Comp, Wire } from '../types';

// ----------------------------------------------------------------------------------
// Harness: builds the same component three times — as-is, converted into an editable
// custom IC ("Edit IC internals") and broken down inline ("Break down") — and verifies
// all three behave identically under identical stimuli. Outputs are read through a
// hex display wired to every output pin, since the broken-down version has no 'U'.
// ----------------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (str: string) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

interface H {
  /** original, custom-IC and inline versions */
  e1: Engine;
  e2: Engine;
  e3: Engine;
  c1: Circuit;
  c2: Circuit;
  c3: Circuit;
  ins: { name: string; w: number; def?: number }[];
  outs: { name: string; w: number }[];
  /**
   * drive the input pins (values in pin order, skipping skipped pins).
   * Value-only changes settle directly — equivalent to the app's sync path
   * (rebuild preserves state) but much faster; pass sync=true for delay mode.
   */
  set(vals: number[], sync?: boolean): void;
  /** read output pin k of each version */
  read(k: number): [number, number, number];
  /** assert all versions agree on every output pin; returns the original's outputs */
  check(msg?: string): number[];
}

function harness(type: string, props: Record<string, any> = {}, opts: { skipPins?: number[] } = {}): H {
  const t = TYPES[type];
  const full = { ...JSON.parse(JSON.stringify(t.defaults)), ...props };
  const ins = t.ins(full);
  const outs = t.outs(full);
  const skip = new Set(opts.skipPins ?? []);
  const build = (): Circuit => {
    const comps: Comp[] = [];
    const wires: Wire[] = [];
    ins.forEach((p, k) => {
      if (skip.has(k)) return;
      comps.push({ id: 'drv' + k, type: 'numin', x: 0, y: k * 100, rot: 0, name: p.name, props: { w: p.w, value: 0 } });
      wires.push({ id: 'dw' + k, from: { c: 'drv' + k, p: 0 }, to: { c: 'U', p: k } });
    });
    comps.push({ id: 'U', type, x: 400, y: 0, rot: 0, name: 'U', props: JSON.parse(JSON.stringify(full)) });
    outs.forEach((p, k) => {
      comps.push({ id: 'out' + k, type: 'hexdisp', x: 900, y: k * 100, rot: 0, name: p.name, props: { w: p.w } });
      wires.push({ id: 'ow' + k, from: { c: 'U', p: k }, to: { c: 'out' + k, p: 0 } });
    });
    return { comps, wires, defs: {}, probes: [] };
  };
  const c1 = build();
  const cu = customize(build(), 'U');
  if (!cu.circuit) throw new Error(cu.error);
  const c2 = cu.circuit;
  const br = breakDown(build(), ['U']);
  if (!br.circuit) throw new Error(br.error);
  const c3 = br.circuit;
  const e1 = new Engine(); e1.sync(c1);
  const e2 = new Engine(); e2.sync(c2);
  const e3 = new Engine(); e3.sync(c3);
  const drv = (c: Circuit, k: number) => c.comps.find((x) => x.id === 'drv' + k)!;
  let last: number[] = [];
  const read = (k: number): [number, number, number] => [e1.inOf('out' + k, 0), e2.inOf('out' + k, 0), e3.inOf('out' + k, 0)];
  return {
    e1, e2, e3, c1, c2, c3, ins, outs,
    set(vals: number[], sync = false) {
      last = [...vals];
      let vi = 0;
      ins.forEach((_p, k) => {
        if (skip.has(k)) return;
        const v = vals[vi++];
        for (const c of [c1, c2, c3]) drv(c, k).props.value = v;
      });
      for (const e of [[e1, c1], [e2, c2], [e3, c3]] as const) {
        e[0].sync(e[1]);
        if (!sync) e[0].settle();
      }
    },
    read,
    check(msg = ''): number[] {
      return outs.map((o, k) => {
        const [a, b, c] = read(k);
        const info = `${type}${msg}: pin ${o.name} — original=${a}, custom IC=${b}, inline=${c} (inputs ${JSON.stringify(last)})`;
        expect(b, info).toBe(a);
        expect(c, info).toBe(a);
        return a;
      });
    },
  };
}

/** Exhaustive input sweep when feasible, otherwise directed sweeps + random sampling. */
function sweep(h: H, type: string, budget = 8192, samples = 400) {
  const widths = h.ins.map((p) => p.w);
  const total = widths.reduce((a, w) => a * (1 << w), 1);
  if (total <= budget) {
    const vals = widths.map(() => 0);
    for (let c = 0; ; c++) {
      h.set([...vals]);
      h.check(` row ${c}`);
      let i = 0;
      for (; i < vals.length; i++) {
        vals[i] = (vals[i] + 1) % (1 << widths[i]);
        if (vals[i]) break;
      }
      if (i >= vals.length) break;
    }
    return;
  }
  const rand = rng(hash(type + JSON.stringify(h.ins.map((p) => p.name))));
  // one pin at a time against an all-0 and an all-1 background, sampling wide pins
  const pick = (w: number): number[] => {
    const max = (1 << w) - 1;
    const set = new Set<number>([0, 1, 2, max >> 1, max - 1, max]);
    while (set.size < Math.min(1 << w, 32)) set.add(Math.floor(rand() * (1 << w)));
    return [...set];
  };
  for (const bg of [0, 1]) {
    for (let k = 0; k < widths.length; k++)
      for (const v of pick(widths[k])) {
        const vals = widths.map((w) => (bg ? (1 << w) - 1 : 0));
        vals[k] = v;
        h.set(vals);
        h.check(` sweep pin ${h.ins[k].name}=${v} bg=${bg}`);
      }
  }
  for (let s = 0; s < samples; s++) {
    h.set(widths.map((w) => Math.floor(rand() * (1 << w))));
    h.check(' random');
  }
}

/**
 * Sequential stimulus matching how the app actually applies changes: one input
 * changes per settle (a user clicks one switch at a time), and the clock
 * toggles in its own settle. Changing several inputs in the same settle would
 * exercise simultaneous-transition races the ideal edge-triggered model hides
 * (e.g. real setup/hold behavior of the gate-level latches).
 */
function seqRandom(type: string, props: Record<string, any>, steps: number, seed: number) {
  const h = harness(type, props);
  const rand = rng(seed);
  const clkIdx = h.ins.findIndex((p) => p.name === 'CLK');
  const prev = h.ins.map(() => 0);
  const dataPins = h.ins.map((_p, i) => i).filter((i) => i !== clkIdx);
  for (let s = 0; s < steps; s++) {
    if (clkIdx >= 0 && rand() < 0.45) {
      const vals = [...prev];
      vals[clkIdx] ^= 1;
      h.set(vals);
      h.check(' clk');
      prev[clkIdx] = vals[clkIdx];
    } else {
      const pin = dataPins[Math.floor(rand() * dataPins.length)];
      const vals = [...prev];
      vals[pin] = Math.floor(rand() * (1 << h.ins[pin].w));
      h.set(vals);
      h.check(' change');
      vals.forEach((v, i) => (prev[i] = v));
    }
  }
  return h;
}

// ----------------------------------------------------------------------------------
// Combinational equivalence
// ----------------------------------------------------------------------------------

describe('breakdown: combinational equivalence', () => {
  it('mux 2:1 / 4:1 / 8:1 across widths', () => {
    sweep(harness('mux', { s: 1 }), 'mux');
    sweep(harness('mux', { s: 2 }), 'mux');
    sweep(harness('mux', { s: 2, w: 2 }), 'mux');
    sweep(harness('mux', { s: 1, w: 8 }), 'mux');
    sweep(harness('mux', { s: 3, w: 2 }), 'mux');
  });

  it('demux 1:2 / 1:4 / 1:8', () => {
    sweep(harness('demux', { s: 1 }), 'demux');
    sweep(harness('demux', { s: 2, w: 2 }), 'demux');
    sweep(harness('demux', { s: 3 }), 'demux');
  });

  it('decoder 1..4 bits', () => {
    for (const n of [1, 2, 3, 4]) sweep(harness('decoder', { n }), 'decoder');
  });

  it('encoder and priority encoder', () => {
    for (const n of [1, 2, 3]) {
      sweep(harness('encoder', { n }), 'encoder');
      sweep(harness('penc', { n }), 'penc');
    }
  });

  it('half and full adder', () => {
    sweep(harness('halfadder'), 'halfadder');
    sweep(harness('fulladder'), 'fulladder');
  });

  it('n-bit adder', () => {
    sweep(harness('adder', { w: 1 }), 'adder');
    sweep(harness('adder', { w: 4 }), 'adder');
    sweep(harness('adder', { w: 8 }), 'adder');
    sweep(harness('adder', { w: 16 }), 'adder');
  }, 60000);

  it('comparator (subtract-based: Cout means A≥B, so A>B needs the equality mask)', () => {
    sweep(harness('comparator', { w: 1 }), 'comparator');
    sweep(harness('comparator', { w: 4 }), 'comparator');
    const h = harness('comparator', { w: 8 });
    for (const [a, b] of [[0, 0], [5, 5], [255, 255], [0, 255], [255, 0], [128, 127], [127, 128]] as const) {
      h.set([a, b]);
      h.check(` ${a} vs ${b}`);
    }
    sweep(h, 'comparator');
  });

  it('ALU 4-bit exhaustive', () => {
    sweep(harness('alu', { w: 4 }), 'alu');
  });

  it('ALU 8-bit: every op against edge operands', () => {
    const h = harness('alu', { w: 8 });
    const M = 255;
    const edges = [0, 1, 2, M - 1, M];
    for (let op = 0; op < 8; op++)
      for (const a of edges)
        for (const b of edges) {
          h.set([a, b, op]);
          h.check(` op=${op} a=${a} b=${b}`);
        }
    sweep(h, 'alu');
  }, 60000);

  it('ALU 16-bit sampled', () => {
    sweep(harness('alu', { w: 16 }), 'alu', 8192, 150);
  }, 60000);

  it('7-segment decoder', () => {
    sweep(harness('seg7dec'), 'seg7dec');
  });
});

// ----------------------------------------------------------------------------------
// Sequential equivalence
// ----------------------------------------------------------------------------------

describe('breakdown: sequential equivalence', () => {
  it('SR latch incl. the forbidden state (stored bit must survive S=R=1)', () => {
    seqRandom('srlatch', {}, 500, 11);
  });

  it('D latch', () => {
    seqRandom('dlatch', {}, 500, 12);
  });

  it('D flip-flop (master/slave gates)', () => {
    seqRandom('dff', {}, 500, 13);
  });

  it('D flip-flop: crafted edge / hold / async-clear sequence', () => {
    const h = harness('dff');
    const step = (vals: number[], msg: string) => { h.set(vals); h.check(msg); };
    // D=1 captured on first rising edge
    step([1, 0, 0], ' prep');
    step([1, 1, 0], ' rise');
    expect(h.check()).toEqual([1, 0]);
    step([1, 0, 0], ' fall');
    step([0, 0, 0], ' D changes while clock low');
    step([0, 1, 0], ' rise captures 0');
    expect(h.check()).toEqual([0, 1]);
    step([0, 0, 0], ' fall');
    step([1, 0, 0], ' D=1 while clock low');
    step([1, 1, 0], ' rise captures 1');
    expect(h.check()).toEqual([1, 0]);
    // async CLR overrides everything, including while the clock is high
    step([1, 1, 1], ' async clear');
    expect(h.check()).toEqual([0, 1]);
    step([1, 0, 1], ' clear holds');
    step([1, 0, 0], ' clear released while clock low');
    step([1, 1, 0], ' next edge captures 1');
    expect(h.check()).toEqual([1, 0]);
  });

  it('JK flip-flop', () => {
    seqRandom('jkff', {}, 500, 14);
  });

  it('T flip-flop', () => {
    seqRandom('tff', {}, 500, 15);
  });

  it('register w=1/4/8', () => {
    seqRandom('reg', { w: 1 }, 400, 16);
    seqRandom('reg', { w: 4 }, 500, 17);
    seqRandom('reg', { w: 8 }, 400, 18);
  });

  it('binary counter wraps and terminal count', () => {
    seqRandom('counter', { w: 4, mode: 'bin' }, 500, 19);
    // crafted: count up through the wrap with EN stuck on
    const h = harness('counter', { w: 4, mode: 'bin' });
    let clk = 0;
    const cycle = (msg: string) => {
      h.set([clk, 1, 0, 1, 0, 0]);
      h.check(' ' + msg);
      clk ^= 1;
    };
    for (let i = 0; i < 40; i++) cycle('count ' + i); // 16 counts wrap twice, CO pulses at 15
  });

  it('BCD counter: 9→0 wrap, 0→9 down-wrap, load clamp to 9', () => {
    seqRandom('counter', { w: 4, mode: 'bcd' }, 500, 20);
    // crafted sequence, data changes and clock edges in separate settles (as the UI does)
    const h = harness('counter', { w: 4, mode: 'bcd' });
    let clk = 0, en = 0, up = 1, ld = 0, d = 0;
    const data = (e: number, u: number, l: number, dv: number, msg: string) => {
      en = e; up = u; ld = l; d = dv;
      h.set([clk, en, 0, up, ld, d]);
      h.check(` ${msg} [data]`);
    };
    const edge = (msg: string) => {
      clk ^= 1;
      h.set([clk, en, 0, up, ld, d]);
      h.check(` ${msg} [edge]`);
    };
    data(1, 1, 1, 8, 'load 8');
    edge('load → 8');
    edge('fall, hold');
    data(1, 1, 0, 0, 'LD off');
    edge('count 8→9 (CO=1)');
    edge('fall, hold');
    edge('count 9→0 (wrap)');
    edge('fall, hold');
    edge('count 0→1');
    edge('fall, hold');
    data(1, 0, 0, 0, 'count down now');
    edge('fall, hold');
    edge('down 1→0 (CO=1)');
    edge('fall, hold');
    edge('down 0→9 (wrap)');
    edge('fall, hold');
    edge('down 9→8');
    data(1, 1, 1, 15, 'load 15');
    edge('clamp → 9');
    edge('fall, hold');
    data(1, 1, 0, 0, 'LD off');
    edge('count 9→0');
  });

  it('shift register both directions', () => {
    seqRandom('shiftreg', { w: 4 }, 500, 21);
  });

  it('input pin defaults survive the IC boundary (decoder EN, counter UP left unconnected)', () => {
    const dec = harness('decoder', { n: 2 }, { skipPins: [1] }); // EN unconnected → defaults to 1
    for (let a = 0; a < 4; a++) {
      dec.set([a]);
      dec.check(' EN default');
    }
    const ctr = harness('counter', { w: 4, mode: 'bin' }, { skipPins: [3] }); // UP unconnected → counts up
    let clk = 0;
    for (let i = 0; i < 20; i++) {
      ctr.set([clk, 1, 0, 0, 0]);
      ctr.check(' UP default');
      clk ^= 1;
    }
  });

  it('gate-level flip-flops also work in propagation-delay mode', () => {
    const h = harness('reg', { w: 4 });
    for (const e of [h.e1, h.e2, h.e3]) e.setMode('delay');
    const tickBoth = (n: number) => { for (let i = 0; i < n; i++) { h.e1.tick(); h.e2.tick(); h.e3.tick(); } };
    h.set([0b1011, 0, 1, 0], true); tickBoth(20); h.check(' load data, clk low');
    h.set([0b1011, 1, 1, 0], true); tickBoth(20); h.check(' rising edge captures');
    expect(h.read(0)).toEqual([0b1011, 0b1011, 0b1011]);
    h.set([0b0100, 1, 1, 0], true); tickBoth(20); h.check(' D changes while clock high: hold');
    h.set([0b0100, 0, 1, 0], true); tickBoth(20); h.check(' falling edge');
    h.set([0b0100, 1, 1, 0], true); tickBoth(20); h.check(' next edge captures');
    expect(h.read(0)).toEqual([0b0100, 0b0100, 0b0100]);
  }, 30000);
});


// ----------------------------------------------------------------------------------
// Structure: what "Break down" and "Edit IC internals" do to the circuit
// ----------------------------------------------------------------------------------

const comp = (id: string, type: string, x: number, y: number, props: Record<string, any> = {}, name = '', rot = 0): Comp => ({ id, type, x, y, rot, name, props });
const wire = (id: string, a: string, ap: number, b: string, bp: number): Wire => ({ id, from: { c: a, p: ap }, to: { c: b, p: bp } });
const overlaps = (a: ReturnType<typeof bbox>, b: ReturnType<typeof bbox>) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function muxCircuit(): Circuit {
  return {
    comps: [
      comp('sw', 'numin', 0, 0, { w: 4, value: 3 }, 'A'),
      comp('U', 'mux', 200, 40, { s: 2, w: 4 }, 'MyMux', 1),
      comp('led', 'hexdisp', 900, 0, { w: 4 }, 'Y'),
    ],
    wires: [wire('w1', 'sw', 0, 'U', 0), wire('w2', 'U', 0, 'led', 0)],
    defs: {},
    probes: [],
  };
}

describe('break down: the component is deleted and its internals are put out', () => {
  it('removes the component, leaves no IC behind, and rewires the neighbours to the internals', () => {
    const c = muxCircuit();
    const r = breakDown(c, ['U']);
    expect(r.error).toBeUndefined();
    const out = r.circuit!;
    expect(out.comps.some((x) => x.id === 'U')).toBe(false);
    expect(out.comps.some((x) => x.type === 'ic' || x.type === 'pin_in' || x.type === 'pin_out')).toBe(false);
    expect(Object.keys(out.defs)).toHaveLength(0);
    expect(r.placed.length).toBe(r.total);
    expect(out.comps).toHaveLength(2 + r.total);
    // the number input now feeds the first internal consumer directly, the display is fed by an internal driver
    const ids = new Set(out.comps.map((x) => x.id));
    expect(out.wires.every((w) => ids.has(w.from.c) && ids.has(w.to.c))).toBe(true);
    const fromA = out.wires.filter((w) => w.from.c === 'sw');
    expect(fromA.length).toBeGreaterThan(0);
    expect(fromA.every((w) => r.placed.includes(w.to.c))).toBe(true);
    const intoLed = out.wires.filter((w) => w.to.c === 'led');
    expect(intoLed).toHaveLength(1);
    expect(r.placed).toContain(intoLed[0].from.c);
    expect(intoLed[0].id).toBe('w2'); // the external wire object (id, label) is reused
  });

  it('places the internals without covering any existing component', () => {
    const c = muxCircuit();
    // crowd the area around the mux
    for (let i = 0; i < 6; i++) c.comps.push(comp('x' + i, 'and', 200 + (i % 3) * 120, 40 + Math.floor(i / 3) * 120));
    const r = breakDown(c, ['U']);
    const placed = r.circuit!.comps.filter((x) => r.placed.includes(x.id));
    const others = r.circuit!.comps.filter((x) => !r.placed.includes(x.id));
    expect(placed.length).toBeGreaterThan(5);
    for (const p of placed)
      for (const o of others)
        expect(overlaps(bbox(p, layoutOf(p, {})), bbox(o, layoutOf(o, {}))), `${p.type} overlaps ${o.id}`).toBe(false);
  });

  it('keeps waveform probes alive by pointing them at the signal they watched', () => {
    const c: Circuit = {
      comps: [comp('a', 'numin', 0, 0, { w: 2, value: 2 }, 'A'), comp('b', 'numin', 0, 100, { w: 2, value: 1 }, 'B'), comp('U', 'adder', 300, 0, { w: 2 })],
      wires: [wire('w1', 'a', 0, 'U', 0), wire('w2', 'b', 0, 'U', 1)],
      defs: {},
      probes: [
        { id: 'p1', comp: 'U', pin: 0, kind: 'out', label: 'S' },
        { id: 'p2', comp: 'U', pin: 1, kind: 'out', label: 'Cout' },
        { id: 'p3', comp: 'U', pin: 0, kind: 'in', label: 'A in' },
        { id: 'p4', comp: 'a', pin: 0, kind: 'out', label: 'A' },
      ],
    };
    const r = breakDown(c, ['U']);
    const out = r.circuit!;
    expect(out.probes.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    const e = new Engine();
    e.sync(out);
    const val = (id: string) => e.probeVal(out.probes.find((p) => p.id === id)!);
    expect(val('p1')).toBe(3);  // 2 + 1
    expect(val('p2')).toBe(0);
    expect(val('p3')).toBe(2);  // input probes follow the external source
    expect(val('p4')).toBe(2);
  });

  it('multi-select takes every breakable part apart; primitive parts are left alone', () => {
    const c: Circuit = {
      comps: [comp('m', 'mux', 0, 0, { s: 2, w: 1 }), comp('a', 'adder', 600, 0, { w: 4 }), comp('r', 'ram', 1200, 0, { a: 2, w: 4 }), comp('g', 'and', 1500, 0)],
      wires: [],
      defs: {},
      probes: [],
    };
    const r = breakDown(c, ['m', 'a', 'r', 'g']);
    expect(r.broken).toHaveLength(2);
    const types = new Set(r.circuit!.comps.map((x) => x.type));
    const allowed = new Set(['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buf', 'splitter', 'merger', 'const', 'mux', 'decoder', 'fulladder', 'dff', 'adder', 'ram']);
    for (const t of types) expect(allowed.has(t), `unexpected type ${t}`).toBe(true);
    expect(r.circuit!.comps.some((x) => x.id === 'r')).toBe(true);
    expect(r.circuit!.comps.some((x) => x.id === 'g')).toBe(true);
    expect(breakDown(c, ['r', 'g']).error).toMatch(/Nothing selected/);
  });

  it('nested: break an adder down, then its full adders, still equal to the original', () => {
    const build = (): Circuit => ({
      comps: [
        comp('a', 'numin', 0, 0, { w: 4, value: 0 }, 'A'), comp('b', 'numin', 0, 100, { w: 4, value: 0 }, 'B'), comp('ci', 'numin', 0, 200, { w: 1, value: 0 }, 'C'),
        comp('U', 'adder', 300, 0, { w: 4 }),
        comp('s', 'hexdisp', 1400, 0, { w: 4 }), comp('co', 'led', 1400, 200),
      ],
      wires: [wire('w1', 'a', 0, 'U', 0), wire('w2', 'b', 0, 'U', 1), wire('w3', 'ci', 0, 'U', 2), wire('w4', 'U', 0, 's', 0), wire('w5', 'U', 1, 'co', 0)],
      defs: {},
      probes: [],
    });
    const c1 = build();
    const e1 = new Engine(); e1.sync(c1);
    const br1 = breakDown(build(), ['U']);
    const fas = br1.circuit!.comps.filter((x) => x.type === 'fulladder').map((x) => x.id);
    expect(fas).toHaveLength(4);
    const br2 = breakDown(br1.circuit!, fas);
    expect(br2.circuit!.comps.some((x) => x.type === 'fulladder')).toBe(false);
    const c2 = br2.circuit!;
    const e2 = new Engine(); e2.sync(c2);
    const rand = rng(42);
    for (let n = 0; n < 500; n++) {
      const a = Math.floor(rand() * 16), b = Math.floor(rand() * 16), ci = Math.floor(rand() * 2);
      for (const c of [c1, c2]) { c.comps[0].props.value = a; c.comps[1].props.value = b; c.comps[2].props.value = ci; }
      e1.sync(c1); e2.sync(c2);
      expect(e2.inOf('s', 0), `sum a=${a} b=${b} ci=${ci}`).toBe(e1.inOf('s', 0));
      expect(e2.inOf('co', 0), `carry a=${a} b=${b} ci=${ci}`).toBe(e1.inOf('co', 0));
    }
  });
});

describe('break down: custom ICs are inlined exactly as defined', () => {
  it('the 4-bit ripple adder example is unchanged after breaking down every full-adder IC (and their half adders)', () => {
    const build = () => TEMPLATES.find((t) => t.id === 'add4')!.build();
    const c1 = build();
    const e1 = new Engine(); e1.sync(c1);
    let c2 = build();
    for (let level = 0; level < 2; level++) {
      const ics = c2.comps.filter((x) => x.type === 'ic').map((x) => x.id);
      expect(ics.length).toBeGreaterThan(0);
      c2 = breakDown(c2, ics).circuit!;
    }
    expect(c2.comps.some((x) => x.type === 'ic')).toBe(false);
    const e2 = new Engine(); e2.sync(c2);
    const nm = (c: Circuit, n: string) => c.comps.find((x) => x.name === n)!;
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (const ci of [0, 1]) {
      for (const c of [c1, c2]) { nm(c, 'A').props.value = a; nm(c, 'B').props.value = b; nm(c, 'Cin').props.value = ci; }
      e1.sync(c1); e2.sync(c2);
      e1.settle(); e2.settle();
      const sumC1 = c1.comps.find((x) => x.type === 'hexdisp')!, sumC2 = c2.comps.find((x) => x.type === 'hexdisp')!;
      expect(e2.inOf(sumC2.id, 0)).toBe(e1.inOf(sumC1.id, 0));
      expect(e2.inOf(nm(c2, 'Cout').id, 0)).toBe(e1.inOf(nm(c1, 'Cout').id, 0));
    }
  });

  /** wraps the given body into a one-instance circuit: sources → IC → sinks */
  function icCircuit(defComps: Comp[], defWires: Wire[], inputs: string[], outputs: string[], wiring: (ic: string) => { comps: Comp[]; wires: Wire[] }): Circuit {
    const def = {
      id: 'D1', name: 'Test IC', comps: defComps, wires: defWires,
      inputs: inputs.map((id) => ({ id, label: id, w: defComps.find((x) => x.id === id)!.props.w ?? 1 })),
      outputs: outputs.map((id) => ({ id, label: id, w: defComps.find((x) => x.id === id)!.props.w ?? 1 })),
    };
    const ext = wiring('U');
    return { comps: [...ext.comps, comp('U', 'ic', 300, 0, { def: 'D1' })], wires: ext.wires, defs: { D1: def }, probes: [] };
  }
  const run = (c: Circuit) => { const e = new Engine(); e.sync(c); return e; };

  it('an unconnected IC input without a default stays 0 even when the internal consumer defaults to 1', () => {
    const mk = () => icCircuit(
      [comp('D', 'pin_in', 0, 0, { w: 1 }), comp('K', 'pin_in', 0, 100, { w: 1 }), comp('E', 'pin_in', 0, 200, { w: 1 }),
       comp('R', 'reg', 200, 0, { w: 1 }), comp('Q', 'pin_out', 500, 0, { w: 1 })],
      [wire('i1', 'D', 0, 'R', 0), wire('i2', 'K', 0, 'R', 1), wire('i3', 'E', 0, 'R', 2), wire('i4', 'R', 0, 'Q', 0)],
      ['D', 'K', 'E'], ['Q'],
      (ic) => ({
        comps: [comp('d', 'switch', 0, 0, { value: 1 }), comp('clk', 'switch', 0, 100), comp('q', 'led', 700, 0)],
        wires: [wire('e1', 'd', 0, ic, 0), wire('e2', 'clk', 0, ic, 1), wire('e3', ic, 0, 'q', 0)], // EN (pin 2) left unconnected
      })
    );
    const c1 = mk(), c2 = breakDown(mk(), ['U']).circuit!;
    expect(c2.comps.some((x) => x.type === 'const')).toBe(true); // EN's 0 was materialised as a constant
    const e1 = run(c1), e2 = run(c2);
    for (const clk of [0, 1, 0, 1]) {
      for (const c of [c1, c2]) c.comps.find((x) => x.id === 'clk')!.props.value = clk;
      e1.sync(c1); e2.sync(c2);
      expect(e2.inOf('q', 0)).toBe(e1.inOf('q', 0));
      expect(e1.inOf('q', 0)).toBe(0); // EN=0: the register never loads D=1
    }
  });

  it('an input pass-through connects the outside source straight to the outside consumer', () => {
    const c = icCircuit(
      [comp('A', 'pin_in', 0, 0, { w: 4 }), comp('Y', 'pin_out', 200, 0, { w: 4 })],
      [wire('i1', 'A', 0, 'Y', 0)],
      ['A'], ['Y'],
      (ic) => ({ comps: [comp('n', 'numin', 0, 0, { w: 4, value: 9 }), comp('h', 'hexdisp', 700, 0, { w: 4 })], wires: [wire('e1', 'n', 0, ic, 0), wire('e2', ic, 0, 'h', 0)] })
    );
    const r = breakDown(c, ['U']);
    expect(r.circuit!.wires).toHaveLength(1);
    expect(r.circuit!.wires[0].from.c).toBe('n');
    expect(r.circuit!.wires[0].to.c).toBe('h');
    expect(run(r.circuit!).inOf('h', 0)).toBe(9);
    expect(r.circuit!.defs).toEqual(c.defs); // a user's def is never deleted
  });

  it('an IC output wired back into its own input keeps latching', () => {
    const mk = () => icCircuit(
      [comp('A', 'pin_in', 0, 0, { w: 1 }), comp('B', 'pin_in', 0, 100, { w: 1 }), comp('G', 'or', 200, 0, { n: 2, w: 1 }), comp('Y', 'pin_out', 500, 0, { w: 1 })],
      [wire('i1', 'A', 0, 'G', 0), wire('i2', 'B', 0, 'G', 1), wire('i3', 'G', 0, 'Y', 0)],
      ['A', 'B'], ['Y'],
      (ic) => ({ comps: [comp('s', 'switch', 0, 0), comp('q', 'led', 700, 0)], wires: [wire('e1', 's', 0, ic, 0), wire('e2', ic, 0, ic, 1), wire('e3', ic, 0, 'q', 0)] })
    );
    const c1 = mk(), c2 = breakDown(mk(), ['U']).circuit!;
    const e1 = run(c1), e2 = run(c2);
    for (const v of [0, 1, 0, 0, 1, 0]) {
      for (const c of [c1, c2]) c.comps.find((x) => x.id === 's')!.props.value = v;
      e1.sync(c1); e2.sync(c2);
      expect(e2.inOf('q', 0)).toBe(e1.inOf('q', 0));
    }
    expect(e2.inOf('q', 0)).toBe(1); // set once, held after the switch goes back to 0
  });

  it('an IC output with nothing driving it reads 0 for consumers that would otherwise default to 1', () => {
    const c = icCircuit(
      [comp('A', 'pin_in', 0, 0, { w: 1 }), comp('Y', 'pin_out', 200, 0, { w: 1 })],
      [],
      ['A'], ['Y'],
      (ic) => ({
        comps: [comp('d', 'switch', 0, 0, { value: 1 }), comp('clk', 'switch', 0, 100), comp('r', 'reg', 700, 0, { w: 1 }), comp('q', 'led', 1000, 0)],
        wires: [wire('e1', 'd', 0, 'r', 0), wire('e2', 'clk', 0, 'r', 1), wire('e3', ic, 0, 'r', 2), wire('e4', 'r', 0, 'q', 0)], // EN ← dangling IC output
      })
    );
    const out = breakDown(c, ['U']).circuit!;
    const e = run(out);
    for (const clk of [0, 1]) { out.comps.find((x) => x.id === 'clk')!.props.value = clk; e.sync(out); }
    expect(e.inOf('q', 0)).toBe(0); // EN is a constant 0, not the register's default 1
  });

  it('an auto-generated def that nothing uses any more is dropped; shared defs stay', () => {
    const c = muxCircuit();
    const cu = customize(c, 'U').circuit!;
    const def = Object.values(cu.defs)[0];
    // legacy auto defs (from older saves) are removed when their last instance is inlined
    const legacy = { ...cu, defs: { [def.id]: { ...def, auto: true } } };
    expect(Object.keys(breakDown(legacy, ['U']).circuit!.defs)).toHaveLength(0);
    // ...but not while another instance still uses them
    const two = { ...legacy, comps: [...legacy.comps, comp('V', 'ic', 0, 600, { def: def.id })] };
    expect(Object.keys(breakDown(two, ['U']).circuit!.defs)).toEqual([def.id]);
  });

  it('packaged selections round-trip: package, then break down, gives the original parts back', () => {
    const c: Circuit = {
      comps: [
        comp('a', 'switch', 0, 0, {}, 'A'), comp('b', 'switch', 0, 100, {}, 'B'),
        comp('x', 'xor', 200, 0), comp('n', 'and', 200, 100),
        comp('s', 'led', 400, 0, {}, 'S'), comp('c', 'led', 400, 100, {}, 'C'),
      ],
      wires: [wire('w1', 'a', 0, 'x', 0), wire('w2', 'b', 0, 'x', 1), wire('w3', 'a', 0, 'n', 0), wire('w4', 'b', 0, 'n', 1), wire('w5', 'x', 0, 's', 0), wire('w6', 'n', 0, 'c', 0)],
      defs: {},
      probes: [],
    };
    const pk = packageSelection(c, ['x', 'n', 's', 'c', 'a', 'b'], 'HA');
    expect(pk.circuit).toBeTruthy();
    const ic = pk.circuit!.comps.find((x) => x.type === 'ic')!;
    const flat = breakDown(pk.circuit!, [ic.id]);
    expect(flat.circuit!.comps.some((x) => x.type === 'ic')).toBe(false);
    // the packaged switches/LEDs became pins, so only the two gates come back out
    expect(flat.circuit!.comps.map((x) => x.type).sort()).toEqual(['and', 'xor']);
  });
});

describe('edit IC internals: a built-in part becomes a custom IC', () => {
  it('keeps id, position, rotation, name and pin order; the new IC is a normal custom IC', () => {
    const c = muxCircuit();
    const r = customize(c, 'U');
    expect(r.error).toBeUndefined();
    const u = r.circuit!.comps.find((x) => x.id === 'U')!;
    expect(u.type).toBe('ic');
    expect([u.x, u.y, u.rot, u.name]).toEqual([200, 40, 1, 'MyMux']);
    const def = r.circuit!.defs[u.props.def];
    expect(def.auto).toBeFalsy(); // shows up in the palette under Custom ICs
    expect(def.name).toBe('MUX 4:1 (custom)');
    expect(r.circuit!.wires).toEqual(c.wires);
    const orig = TYPES.mux;
    expect(def.inputs.map((p) => p.label)).toEqual(orig.ins({ s: 2, w: 4 }).map((p) => p.name));
    expect(def.inputs.map((p) => p.w)).toEqual(orig.ins({ s: 2, w: 4 }).map((p) => p.w));
    expect(def.outputs.map((p) => p.label)).toEqual(orig.outs({ s: 2, w: 4 }).map((p) => p.name));
    expect(pinsOf(u, r.circuit!.defs).ins).toHaveLength(orig.ins({ s: 2, w: 4 }).length);
  });

  it('names stay unique and parts without an expansion are refused', () => {
    const c: Circuit = { comps: [comp('m1', 'mux', 0, 0, { s: 1 }), comp('m2', 'mux', 400, 0, { s: 1 }), comp('g', 'and', 800, 0)], wires: [], defs: {}, probes: [] };
    const a = customize(c, 'm1').circuit!;
    const b = customize(a, 'm2');
    expect(Object.values(b.circuit!.defs).map((d) => d.name).sort()).toEqual(['MUX 2:1 (custom)', 'MUX 2:1 (custom) 2']);
    expect(customize(c, 'g').error).toBeTruthy();
  });
});
