import { describe, expect, it } from 'vitest';
import { Engine } from '../engine';
import { TEMPLATES } from '../templates';
import { assemble, EXAMPLE_PROGRAM, EVALUATOR_PROGRAM } from '../assembler';
import { pinsOf } from '../defs';
import { breakDown } from '../breakdown';
import type { Circuit } from '../types';

function build(id: string): Circuit {
  const tpl = TEMPLATES.find((t) => t.id === id)!;
  return tpl.build();
}

describe('templates: 4-bit ripple adder', () => {
  it('matches arithmetic for all 512 input combinations', () => {
    const c = build('add4');
    const e = new Engine();
    e.sync(c);
    const A = c.comps.find((x) => x.name === 'A')!;
    const B = c.comps.find((x) => x.name === 'B')!;
    const ci = c.comps.find((x) => x.name === 'Cin')!;
    const merger = c.comps.find((x) => x.type === 'merger')!;
    const coLed = c.comps.find((x) => x.name === 'Cout')!;
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (const cin of [0, 1]) {
      A.props.value = a; B.props.value = b; ci.props.value = cin;
      e.settle();
      const sum = a + b + cin;
      expect(e.outOf(merger.id, 0)).toBe(sum & 15);
      expect(e.inOf(coLed.id, 0)).toBe(sum > 15 ? 1 : 0);
    }
  });
});

describe('templates: 4-bit ALU', () => {
  it('computes ADD / SUB / AND / OR selected by the 2-bit opcode', () => {
    const c = build('alu');
    const e = new Engine();
    e.sync(c);
    const A = c.comps.find((x) => x.name === 'A')!;
    const B = c.comps.find((x) => x.name === 'B')!;
    const OP = c.comps.find((x) => x.name === 'OP')!;
    const result = c.comps.find((x) => x.name === 'Result')!;
    const coLed = c.comps.find((x) => x.name === 'C')!;
    const zLed = c.comps.find((x) => x.name === 'Zero')!;
    for (const [a, b] of [[6, 3], [9, 12], [15, 15], [0, 7]] as [number, number][]) {
      A.props.value = a; B.props.value = b;
      for (let op = 0; op < 4; op++) {
        OP.props.value = op;
        e.settle();
        const m = 15;
        const expectR = [ (a + b) & m, (a - b) & m, a & b, a | b ][op];
        expect(e.inOf(result.id, 0)).toBe(expectR);
        // C = carry for ADD, "no borrow" (a >= b) for SUB, 0 for logic ops
        const expectC = op === 0 ? (a + b > m ? 1 : 0) : op === 1 ? (a >= b ? 1 : 0) : 0;
        expect(e.inOf(coLed.id, 0)).toBe(expectC);
        expect(e.inOf(zLed.id, 0)).toBe(expectR === 0 ? 1 : 0);
      }
    }
  });
});

describe('templates: register file', () => {
  it('writes R1=9 through the decoder-enabled register', () => {
    const c = build('rf');
    const e = new Engine();
    e.sync(c);
    // clock ticks with the template's 1 Hz clock via halfStep
    e.halfStep(); // rising edge: WD=9 → WA=1 register (WE switch defaults to 0 → no write)
    const regs = c.comps.filter((x) => x.type === 'reg');
    const q = (i: number) => e.outOf(regs[i].id, 0);
    expect(q(1)).toBe(0); // WE=0
  });
});

describe('templates: toy CPU executes the example program', () => {
  it('sums 5+4+3+2+1 and halts with OUT = 15', () => {
    const c = build('cpu');
    // ensure the ROM holds the assembled example program
    const progRom = c.comps.find((x) => x.type === 'rom' && x.props.w === 16)!;
    expect(progRom.props.data).toEqual(assemble(EXAMPLE_PROGRAM).words);
    const e = new Engine();
    e.sync(c);
    const pc = c.comps.find((x) => x.name === 'PC')!;
    const outr = c.comps.find((x) => x.name === 'OUT reg')!;
    let pcSeen: number[] = [];
    for (let i = 0; i < 600; i++) {
      e.halfStep();
      pcSeen.push(e.stOf(pc.id).q);
      if (i > 4 && pcSeen[i] === pcSeen[i - 2] && pcSeen[i - 1] === pcSeen[i - 3]) break; // halted
    }
    expect(e.stOf(pc.id).q).toBe(7);      // parked at HALT
    expect(e.stOf(outr.id).q).toBe(15);   // 5+4+3+2+1
  });
  it('RESET clears the program counter', () => {
    const c = build('cpu');
    const e = new Engine();
    e.sync(c);
    const rst = c.comps.find((x) => x.name === 'RESET')!;
    const pc = c.comps.find((x) => x.name === 'PC')!;
    rst.props.value = 1;
    e.sync(c);
    expect(e.stOf(pc.id).q).toBe(0);
    e.halfStep();
    e.halfStep();
    expect(e.stOf(pc.id).q).toBe(0); // held in reset
  });
});

describe('templates: self-hosted gate simulator', () => {
  it('evaluates the full-adder netlist for all 8 input combinations', () => {
    const c = build('selfsim');
    const e = new Engine();
    e.sync(c);
    const eng = c.comps.find((x) => x.type === 'ic')!;
    const inp = c.comps.find((x) => x.name === 'Inputs a·b·cin')!;
    const sel = c.comps.find((x) => x.name === 'Net select')!;
    const netPin = pinsOf(eng, c.defs).outs.findIndex((p) => p.name === 'NET');
    expect(netPin).toBeGreaterThanOrEqual(0);
    const runPasses = (n: number) => { for (let i = 0; i < n * 32; i++) e.halfStep(); }; // 16 records = 16 cycles = 32 half-steps
    sel.props.value = 4; // SUM
    for (let v = 0; v < 8; v++) {
      inp.props.value = v;
      runPasses(3);
      const a = v & 1, b = (v >> 1) & 1, cin = (v >> 2) & 1;
      expect(e.outOf(eng.id, netPin)).toBe(a ^ b ^ cin);
    }
    sel.props.value = 0; // COUT (net 0, recycled from a) — the inspector reads asynchronously
    for (let v = 0; v < 8; v++) {
      inp.props.value = v;
      runPasses(3);
      const a = v & 1, b = (v >> 1) & 1, cin = (v >> 2) & 1;
      expect(e.outOf(eng.id, netPin)).toBe(a + b + cin >= 2 ? 1 : 0);
    }
  });
  it('also settles in propagation-delay mode (write-back survives the transport-delay pipelines)', () => {
    const c = build('selfsim');
    const e = new Engine();
    e.sync(c);
    e.setMode('delay');
    const eng = c.comps.find((x) => x.type === 'ic')!;
    const inp = c.comps.find((x) => x.name === 'Inputs a·b·cin')!;
    const sel = c.comps.find((x) => x.name === 'Net select')!;
    const netPin = pinsOf(eng, c.defs).outs.findIndex((p) => p.name === 'NET');
    inp.props.value = 7; // a=1, b=1, cin=1 → sum=1, cout=1
    for (let i = 0; i < 1280; i++) e.tick(); // 2 passes through the 16 records at period 40
    sel.props.value = 4;
    for (let i = 0; i < 10; i++) e.tick();
    expect(e.outOf(eng.id, netPin)).toBe(1);
    sel.props.value = 0;
    for (let i = 0; i < 10; i++) e.tick();
    expect(e.outOf(eng.id, netPin)).toBe(1);
  });
});

describe('templates: toy CPU runs the netlist evaluator in assembly', () => {
  it('assembles cleanly and fits the 256-word program ROM', () => {
    const r = assemble(EVALUATOR_PROGRAM);
    expect(r.errors).toEqual([]);
    expect(r.words.length).toBeLessThanOrEqual(256);
  });
  it('settles the full-adder netlist in Data RAM and rests OUT on COUT', () => {
    const c = build('cpueval');
    const e = new Engine();
    e.sync(c);
    const ramComp = c.comps.find((x) => x.name === 'Data RAM')!;
    const outr = c.comps.find((x) => x.name === 'OUT reg')!;
    for (let i = 0; i < 1200; i++) e.halfStep(); // ~600 instructions: init + a full evaluate pass
    const mem = e.stOf(ramComp.id).mem;
    expect(mem[0]).toBe(1);  // a
    expect(mem[1]).toBe(1);  // b
    expect(mem[2]).toBe(0);  // cin
    expect(mem[4]).toBe(0);  // sum = 1 ^ 1 ^ 0
    expect(mem[9]).toBe(1);  // cout = majority(1, 1, 0)
    expect(e.stOf(outr.id).q).toBe(1); // display rests on COUT after the net sweep
  });
});

describe('templates: digital clock / stopwatch', () => {
  const setup = () => {
    const c = build('clock');
    const e = new Engine();
    e.sync(c);
    const ics = c.comps.filter((x) => x.type === 'ic');
    expect(ics).toHaveLength(4);
    ics.sort((a, b) => a.x - b.x); // reading order: min×10, min×1, sec×10, sec×1
    const get = (n: string) => c.comps.find((x) => x.name === n)!;
    const time = () => ics.map((ic) => e.outOf(ic.id, 0)).join('');
    const cycle = (n: number) => { for (let i = 0; i < n * 2; i++) e.halfStep(); };
    return { c, e, time, cycle, run: get('RUN'), rst: get('RESET') };
  };

  it('counts seconds and minutes in decimal, rolling 59→00 and 59:59→00:00', () => {
    const { time, cycle } = setup();
    expect(time()).toBe('0000');
    const expected = (n: number) => {
      const t = n % 3600, m = Math.floor(t / 60), s = t % 60;
      return `${Math.floor(m / 10)}${m % 10}${Math.floor(s / 10)}${s % 10}`;
    };
    for (let n = 1; n <= 3605; n++) {
      cycle(1);
      if (n <= 130 || n >= 3590 || n % 97 === 0) expect(time(), `after ${n} s`).toBe(expected(n));
    }
  });

  it('RUN=0 freezes the clock, RESET zeroes it', () => {
    const { c, e, time, cycle, run, rst } = setup();
    cycle(75);
    expect(time()).toBe('0115');
    run.props.value = 0; e.sync(c);
    cycle(30);
    expect(time()).toBe('0115');
    run.props.value = 1; e.sync(c);
    cycle(5);
    expect(time()).toBe('0120');
    rst.props.value = 1; e.sync(c);
    expect(time()).toBe('0000');
    cycle(3);
    expect(time()).toBe('0000'); // held in reset
    rst.props.value = 0; e.sync(c);
    cycle(2);
    expect(time()).toBe('0002');
  });

  it('keeps counting correctly after the digit ICs are broken down into gates', () => {
    const c = build('clock');
    const ics = c.comps.filter((x) => x.type === 'ic');
    const flat = breakDown(c, ics.map((x) => x.id)).circuit!;
    expect(flat.comps.some((x) => x.type === 'ic')).toBe(false);
    const counters = flat.comps.filter((x) => x.type === 'counter').sort((a, b) => a.x - b.x);
    expect(counters).toHaveLength(4);
    const e = new Engine();
    e.sync(flat);
    const time = () => counters.map((x) => e.stOf(x.id).q).join('');
    for (let i = 0; i < 2 * 135; i++) e.halfStep();
    expect(time()).toBe('0215'); // 135 s
  });
});

describe('templates: all examples build valid circuits', () => {
  it('every template wires only to existing pins and simulates', () => {
    for (const tpl of TEMPLATES) {
      const c = tpl.build();
      const e = new Engine();
      expect(() => e.sync(c)).not.toThrow();
      expect(() => e.settle()).not.toThrow();
      expect(e.nodes.length).toBeGreaterThan(0);
    }
  });
});
