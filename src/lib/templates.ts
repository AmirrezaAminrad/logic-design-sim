import type { Circuit, Comp, ICDef, Probe, Wire } from './types';
import { emptyCircuit, uid } from './types';
import { newComp, pinsOf } from './defs';
import { packageSelection } from './ic';
import { assemble, EXAMPLE_PROGRAM, EVALUATOR_PROGRAM } from './assembler';

class B {
  comps: Comp[] = [];
  wires: Wire[] = [];
  defs: Record<string, ICDef> = {};
  probes: Probe[] = [];
  add(type: string, x: number, y: number, props: Record<string, any> = {}, name?: string, rot = 0): string {
    const id = uid('t');
    const c = newComp(type, x, y, props, this.comps, id);
    if (name !== undefined) c.name = name;
    c.rot = rot;
    this.comps.push(c);
    return id;
  }
  ic(def: ICDef, x: number, y: number, name = '', rot = 0): string {
    this.defs[def.id] = def;
    return this.add('ic', x, y, { def: def.id }, name, rot);
  }
  w(a: string, ap: string | number, b: string, bp: string | number) {
    const ca = this.comps.find((c) => c.id === a)!, cb = this.comps.find((c) => c.id === b)!;
    const ai = typeof ap === 'number' ? ap : pinsOf(ca, this.defs).outs.findIndex((p) => p.name === ap);
    const bi = typeof bp === 'number' ? bp : pinsOf(cb, this.defs).ins.findIndex((p) => p.name === bp);
    if (ai < 0 || bi < 0) throw new Error(`Template wiring error: ${ca.type}.${ap} -> ${cb.type}.${bp}`);
    this.wires.push({ id: uid('w'), from: { c: a, p: ai }, to: { c: b, p: bi } });
  }
  probe(comp: string, pin: number, label: string, kind: 'out' | 'in' = 'out') {
    this.probes.push({ id: uid('p'), comp, pin, kind, label });
  }
  circuit(): Circuit {
    return { comps: this.comps, wires: this.wires, defs: this.defs, probes: this.probes };
  }
}

function packAll(b: B, name: string): { def: ICDef; defs: Record<string, ICDef> } {
  const c = b.circuit();
  const r = packageSelection(c, c.comps.map((x) => x.id), name);
  if (!r.def || !r.circuit) throw new Error(r.error);
  return { def: r.def, defs: r.circuit.defs };
}

function halfAdderDef() {
  const b = new B();
  const a = b.add('switch', 0, 0, {}, 'A'), bb = b.add('switch', 0, 100, {}, 'B');
  const x = b.add('xor', 160, 0), n = b.add('and', 160, 100);
  const s = b.add('led', 320, 20, {}, 'Sum'), c = b.add('led', 320, 120, {}, 'Carry');
  b.w(a, 'Q', x, 'A'); b.w(bb, 'Q', x, 'B'); b.w(a, 'Q', n, 'A'); b.w(bb, 'Q', n, 'B');
  b.w(x, 'Y', s, 'A'); b.w(n, 'Y', c, 'A');
  return packAll(b, 'Half Adder');
}

function fullAdderDef() {
  const ha = halfAdderDef();
  const b = new B();
  b.defs = { ...ha.defs };
  const a = b.add('switch', 0, 0, {}, 'A'), bb = b.add('switch', 0, 80, {}, 'B'), ci = b.add('switch', 0, 200, {}, 'Cin');
  const h1 = b.ic(ha.def, 160, 20), h2 = b.ic(ha.def, 340, 100);
  const or = b.add('or', 520, 180);
  const s = b.add('led', 520, 100, {}, 'Sum'), co = b.add('led', 680, 190, {}, 'Cout');
  b.w(a, 'Q', h1, 'A'); b.w(bb, 'Q', h1, 'B');
  b.w(h1, 'Sum', h2, 'A'); b.w(ci, 'Q', h2, 'B');
  b.w(h1, 'Carry', or, 'A'); b.w(h2, 'Carry', or, 'B');
  b.w(h2, 'Sum', s, 'A'); b.w(or, 'Y', co, 'A');
  return packAll(b, 'Full Adder');
}

function tHalfAdder(): Circuit {
  const b = new B();
  const a = b.add('switch', 60, 80, {}, 'A'), bb = b.add('switch', 60, 160, {}, 'B');
  const x = b.add('xor', 260, 60), n = b.add('and', 260, 180);
  const s = b.add('led', 460, 80, {}, 'Sum'), c = b.add('led', 460, 200, {}, 'Carry');
  b.w(a, 'Q', x, 'A'); b.w(bb, 'Q', x, 'B'); b.w(a, 'Q', n, 'A'); b.w(bb, 'Q', n, 'B');
  b.w(x, 'Y', s, 'A'); b.w(n, 'Y', c, 'A');
  return b.circuit();
}

function tFullAdder(): Circuit {
  const ha = halfAdderDef();
  const b = new B();
  const a = b.add('switch', 60, 60, {}, 'A'), bb = b.add('switch', 60, 140, {}, 'B'), ci = b.add('switch', 60, 260, {}, 'Cin');
  const h1 = b.ic(ha.def, 260, 80), h2 = b.ic(ha.def, 480, 160);
  const or = b.add('or', 700, 240);
  const s = b.add('led', 700, 160, {}, 'Sum'), co = b.add('led', 860, 250, {}, 'Cout');
  b.defs = { ...ha.defs };
  b.w(a, 'Q', h1, 'A'); b.w(bb, 'Q', h1, 'B');
  b.w(h1, 'Sum', h2, 'A'); b.w(ci, 'Q', h2, 'B');
  b.w(h1, 'Carry', or, 'A'); b.w(h2, 'Carry', or, 'B');
  b.w(h2, 'Sum', s, 'A'); b.w(or, 'Y', co, 'A');
  return b.circuit();
}

function tAdder4(): Circuit {
  const fa = fullAdderDef();
  const b = new B();
  b.defs = { ...fa.defs };
  const A = b.add('numin', 40, 60, { w: 4, value: 5 }, 'A'), Bn = b.add('numin', 40, 260, { w: 4, value: 3 }, 'B');
  const ci = b.add('switch', 40, 420, {}, 'Cin');
  const sa = b.add('splitter', 200, 40, { w: 4 }), sb = b.add('splitter', 200, 240, { w: 4 });
  b.w(A, 'Q', sa, 'Bus'); b.w(Bn, 'Q', sb, 'Bus');
  const fas: string[] = [];
  for (let i = 0; i < 4; i++) {
    const f = b.ic(fa.def, 480, 40 + 140 * i);
    fas.push(f);
    b.w(sa, 'b' + i, f, 'A'); b.w(sb, 'b' + i, f, 'B');
    if (i > 0) b.w(fas[i - 1], 'Cout', f, 'Cin');
  }
  b.w(ci, 'Q', fas[0], 'Cin');
  const m = b.add('merger', 720, 140, { w: 4 });
  for (let i = 0; i < 4; i++) b.w(fas[i], 'Sum', m, 'b' + i);
  const hd = b.add('hexdisp', 880, 160, { w: 4 }, 'Sum');
  const co = b.add('led', 880, 440, {}, 'Cout');
  b.w(m, 'Bus', hd, 'A'); b.w(fas[3], 'Cout', co, 'A');
  return b.circuit();
}

function tAlu(): Circuit {
  const b = new B();
  const A = b.add('numin', 40, 40, { w: 4, value: 6 }, 'A'), Bn = b.add('numin', 40, 160, { w: 4, value: 3 }, 'B');
  const op = b.add('numin', 40, 320, { w: 2, value: 0 }, 'OP');
  const o0 = b.add('slice', 220, 300, { w: 2, lo: 0, n: 1 }), o1 = b.add('slice', 220, 360, { w: 2, lo: 1, n: 1 });
  const nt = b.add('not', 380, 360);
  const sub = b.add('and', 520, 320);
  b.w(op, 'Q', o0, 'In'); b.w(op, 'Q', o1, 'In'); b.w(o1, 'Out', nt, 'A'); b.w(o0, 'Out', sub, 'A'); b.w(nt, 'Y', sub, 'B');
  const mk = b.add('merger', 680, 380, { w: 4 });
  for (let i = 0; i < 4; i++) b.w(sub, 'Y', mk, 'b' + i);
  const bx = b.add('xor', 860, 200, { w: 4 });
  b.w(Bn, 'Q', bx, 'A'); b.w(mk, 'Bus', bx, 'B');
  const add = b.add('adder', 1040, 120, { w: 4 });
  b.w(A, 'Q', add, 'A'); b.w(bx, 'Y', add, 'B'); b.w(sub, 'Y', add, 'Cin');
  const an = b.add('and', 1040, 300, { w: 4 }), or = b.add('or', 1040, 420, { w: 4 });
  b.w(A, 'Q', an, 'A'); b.w(Bn, 'Q', an, 'B'); b.w(A, 'Q', or, 'A'); b.w(Bn, 'Q', or, 'B');
  const mx = b.add('mux', 1260, 220, { s: 2, w: 4 });
  b.w(add, 'S', mx, 'D0'); b.w(add, 'S', mx, 'D1'); b.w(an, 'Y', mx, 'D2'); b.w(or, 'Y', mx, 'D3'); b.w(op, 'Q', mx, 'S');
  const res = b.add('hexdisp', 1440, 220, { w: 4 }, 'Result');
  const co = b.add('led', 1440, 140, { color: 'yellow' }, 'C');
  const z0 = b.add('const', 1260, 420, { w: 4, value: 0 }, '0');
  const cmp = b.add('comparator', 1400, 380, { w: 4 });
  const zl = b.add('led', 1580, 400, { color: 'green' }, 'Zero');
  // carry flag is only meaningful for ADD/SUB (opcode bit 1 clear): C = adder.Cout AND NOT op1
  const no1 = b.add('not', 220, 420);
  const cg = b.add('and', 1300, 140);
  b.w(o1, 'Out', no1, 'A'); b.w(add, 'Cout', cg, 'A'); b.w(no1, 'Y', cg, 'B');
  b.w(mx, 'Y', res, 'A'); b.w(mx, 'Y', cmp, 'A'); b.w(z0, 'Q', cmp, 'B'); b.w(cmp, 'A=B', zl, 'A');
  b.w(cg, 'Y', co, 'A');
  return b.circuit();
}

function tRegFile(): Circuit {
  const b = new B();
  const clk = b.add('clock', 40, 40, { freq: 1 }, 'CLK');
  const wd = b.add('numin', 40, 140, { w: 4, value: 9 }, 'WD'), wa = b.add('numin', 40, 240, { w: 2, value: 1 }, 'WA');
  const we = b.add('switch', 40, 340, {}, 'WE');
  const ra = b.add('numin', 40, 440, { w: 2, value: 1 }, 'RA'), rb = b.add('numin', 40, 540, { w: 2, value: 0 }, 'RB');
  const dec = b.add('decoder', 260, 240, { n: 2 });
  b.w(wa, 'Q', dec, 'A'); b.w(we, 'Q', dec, 'EN');
  const regs: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = b.add('reg', 520, 40 + 140 * i, { w: 4 }, 'R' + i);
    regs.push(r);
    b.w(wd, 'Q', r, 'D'); b.w(clk, 'CLK', r, 'CLK'); b.w(dec, 'Y' + i, r, 'EN');
  }
  const ma = b.add('mux', 780, 100, { s: 2, w: 4 }), mb = b.add('mux', 780, 380, { s: 2, w: 4 });
  regs.forEach((r, i) => { b.w(r, 'Q', ma, 'D' + i); b.w(r, 'Q', mb, 'D' + i); });
  b.w(ra, 'Q', ma, 'S'); b.w(rb, 'Q', mb, 'S');
  const qa = b.add('hexdisp', 960, 120, { w: 4 }, 'QA'), qb = b.add('hexdisp', 960, 400, { w: 4 }, 'QB');
  b.w(ma, 'Y', qa, 'A'); b.w(mb, 'Y', qb, 'A');
  b.probe(clk, 0, 'CLK');
  return b.circuit();
}

export const CPU_CONTROL_ROM = (() => {
  // control word: bit0 regWrite · bit1 useImm · bits4:2 aluOp · bit5 jmp · bit6 jz
  //               · bit7 jnz · bit8 out · bit9 halt · bit10 memRd · bit11 memWr
  const RW = 1, IMM = 2, JMP = 1 << 5, JZ = 1 << 6, JNZ = 1 << 7, OUT = 1 << 8, HALT = 1 << 9,
    MEMRD = 1 << 10, MEMWR = 1 << 11;
  const op = (n: number) => n << 2;
  const t = new Array(16).fill(0);
  t[0x1] = RW | IMM | op(5); t[0x2] = RW | op(0); t[0x3] = RW | op(1); t[0x4] = RW | op(2); t[0x5] = RW | op(3);
  t[0x6] = RW | op(4); t[0x7] = RW | op(5); t[0x8] = RW | IMM | op(0);
  t[0x9] = JMP; t[0xa] = JZ; t[0xb] = JNZ; t[0xc] = OUT;
  t[0xd] = RW | MEMRD; t[0xe] = MEMWR; t[0xf] = HALT;
  return t as number[];
})();

function cpuDatapath(prog: number[]): Circuit {
  const b = new B();
  const clk = b.add('clock', 40, 40, { freq: 2, period: 40 }, 'CLK');
  const rst = b.add('switch', 40, 120, {}, 'RESET');
  const pc = b.add('reg', 180, 200, { w: 8 }, 'PC');
  const one = b.add('const', 40, 400, { w: 8, value: 1 }, '1');
  const inc = b.add('adder', 180, 380, { w: 8 }, 'PC+1');
  b.w(one, 'Q', inc, 'B'); b.w(pc, 'Q', inc, 'A');
  b.w(clk, 'CLK', pc, 'CLK'); b.w(rst, 'Q', pc, 'CLR');
  const rom = b.add('rom', 380, 200, { a: 8, w: 16, data: prog }, 'Program ROM');
  b.w(pc, 'Q', rom, 'ADDR');
  const sl = (lo: number, n: number, y: number, name: string) => {
    const s = b.add('slice', 600, y, { w: 16, lo, n }, name);
    b.w(rom, 'DATA', s, 'In');
    return s;
  };
  const opc = sl(12, 4, 40, 'opcode'), rd = sl(10, 2, 140, 'rd'), rs = sl(8, 2, 240, 'rs'), imm = sl(0, 8, 340, 'imm');
  const cr = b.add('rom', 800, 40, { a: 4, w: 12, data: CPU_CONTROL_ROM }, 'Control ROM');
  b.w(opc, 'Out', cr, 'ADDR');
  const ctl = (lo: number, n: number, i: number, name: string) => {
    const s = b.add('slice', i > 7 ? 1180 : 1000, i > 7 ? 140 + 60 * (i - 8) : 20 + 60 * i, { w: 12, lo, n }, name);
    b.w(cr, 'DATA', s, 'In');
    return s;
  };
  const cRW = ctl(0, 1, 0, 'regWrite'), cImm = ctl(1, 1, 1, 'useImm'), cOp = ctl(2, 3, 2, 'aluOp'), cJmp = ctl(5, 1, 3, 'jmp');
  const cJz = ctl(6, 1, 4, 'jz'), cJnz = ctl(7, 1, 5, 'jnz'), cOut = ctl(8, 1, 6, 'out'), cHalt = ctl(9, 1, 7, 'halt');
  const cMemRd = ctl(10, 1, 8, 'memRd'), cMemWr = ctl(11, 1, 9, 'memWr');
  const nh = b.add('not', 1180, 40);
  b.w(cHalt, 'Out', nh, 'A'); b.w(nh, 'Y', pc, 'EN');
  const rf = b.add('regfile', 800, 320, { a: 2, w: 8 }, 'Registers');
  b.w(rd, 'Out', rf, 'RA'); b.w(rs, 'Out', rf, 'RB'); b.w(rd, 'Out', rf, 'WA'); b.w(cRW, 'Out', rf, 'WE'); b.w(clk, 'CLK', rf, 'CLK');
  const mx = b.add('mux', 1000, 540, { s: 1, w: 8 }, 'B select');
  b.w(rf, 'QB', mx, 'D0'); b.w(imm, 'Out', mx, 'D1'); b.w(cImm, 'Out', mx, 'S');
  const alu = b.add('alu', 1200, 540, { w: 8 }, 'ALU');
  b.w(rf, 'QA', alu, 'A'); b.w(mx, 'Y', alu, 'B'); b.w(cOp, 'Out', alu, 'OP');
  // Data RAM: both LD and ST address through rs, so QB drives ADDR permanently;
  // ST stores QA at that address, LD routes DOUT back to rd through the WD mux.
  const ram = b.add('ram', 1200, 200, { a: 6, w: 8 }, 'Data RAM');
  b.w(rf, 'QB', ram, 'ADDR'); b.w(rf, 'QA', ram, 'DIN'); b.w(cMemWr, 'Out', ram, 'WE'); b.w(clk, 'CLK', ram, 'CLK');
  const wb = b.add('mux', 1420, 540, { s: 1, w: 8 }, 'WD select');
  b.w(alu, 'R', wb, 'D0'); b.w(ram, 'DOUT', wb, 'D1'); b.w(cMemRd, 'Out', wb, 'S');
  b.w(wb, 'Y', rf, 'WD');
  const z0 = b.add('const', 1000, 740, { w: 8, value: 0 }, '0');
  const cz = b.add('comparator', 1200, 740, { w: 8 }, 'rd == 0');
  b.w(rf, 'QA', cz, 'A'); b.w(z0, 'Q', cz, 'B');
  const az = b.add('and', 1600, 700), nz = b.add('not', 1600, 800), anz = b.add('and', 1740, 800);
  b.w(cJz, 'Out', az, 'A'); b.w(cz, 'A=B', az, 'B'); b.w(cz, 'A=B', nz, 'A'); b.w(cJnz, 'Out', anz, 'A'); b.w(nz, 'Y', anz, 'B');
  const take = b.add('or', 1880, 720, { n: 3 }, 'take jump');
  b.w(cJmp, 'Out', take, 'A'); b.w(az, 'Y', take, 'B'); b.w(anz, 'Y', take, 'C');
  const pm = b.add('mux', 1600, 300, { s: 1, w: 8 }, 'next PC');
  b.w(inc, 'S', pm, 'D0'); b.w(imm, 'Out', pm, 'D1'); b.w(take, 'Y', pm, 'S'); b.w(pm, 'Y', pc, 'D');
  const outr = b.add('reg', 1700, 540, { w: 8 }, 'OUT reg');
  b.w(rf, 'QA', outr, 'D'); b.w(clk, 'CLK', outr, 'CLK'); b.w(cOut, 'Out', outr, 'EN'); b.w(rst, 'Q', outr, 'CLR');
  const hd = b.add('hexdisp', 1900, 560, { w: 8 }, 'OUT');
  b.w(outr, 'Q', hd, 'A');
  b.probe(clk, 0, 'CLK'); b.probe(pc, 0, 'PC'); b.probe(outr, 0, 'OUT');
  return b.circuit();
}

function tCpu(): Circuit {
  return cpuDatapath(assemble(EXAMPLE_PROGRAM).words);
}

function tCpuEval(): Circuit {
  return cpuDatapath(assemble(EVALUATOR_PROGRAM).words);
}

// ---------- self-hosted gate simulator: a netlist evaluator built from parts ----------
// One 16-bit ROM word per simulated gate ("circuit file"):
//   op[14:12] · inA[11:8] · inB[7:4] · dest[3:0]
// op maps straight onto the ALU's 3-bit OP input (2=AND 3=OR 4=XOR 5=PASS B 7=NOT A),
// plus 6=INPUT (dest = bit inA of the external CONST input) and 0/1 = ADD/SUB.
// dest addresses the 8-net store (0–7; fields hold 4 bits, extra bits ignored).
export const netRec = (op: number, a: number, b: number, d: number) =>
  ((op & 7) << 12) | ((a & 15) << 8) | ((b & 15) << 4) | (d & 15);

// A full adder as an 8-net netlist. cout = ab | (cin & (a|b)) saves a net, and
// net 0 is recycled: a's last use is the a|b record, so cout overwrites it —
// register allocation, 1970s style. Every pass rewrites everything, so it is
// self-restoring. SUM lives in net 4, COUT in net 0.
export const FULL_ADDER_NETLIST = [
  netRec(6, 0, 0, 0),   // a = IN bit 0            → net 0
  netRec(6, 1, 0, 1),   // b = IN bit 1            → net 1
  netRec(6, 2, 0, 2),   // cin = IN bit 2          → net 2
  netRec(4, 0, 1, 3),   // x1 = a ^ b              → net 3
  netRec(4, 3, 2, 4),   // SUM = x1 ^ cin          → net 4
  netRec(2, 0, 1, 5),   // ab = a & b              → net 5
  netRec(3, 0, 1, 6),   // aor = a | b             → net 6
  netRec(2, 2, 6, 7),   // t = cin & aor           → net 7
  netRec(3, 5, 7, 0),   // COUT = ab | t           → net 0 (recycled)
  netRec(5, 0, 0, 0), netRec(5, 0, 0, 0), netRec(5, 0, 0, 0),
  netRec(5, 0, 0, 0), netRec(5, 0, 0, 0), netRec(5, 0, 0, 0), netRec(5, 0, 0, 0),
];

function netlistEngineDef() {
  const b = new B();
  // boundary markers: switches/numins become IC inputs, hexdisps/LEDs become outputs
  const clk = b.add('switch', 0, 0, {}, 'CLK');
  const run = b.add('switch', 0, 60, { value: 1 }, 'RUN');
  const rst = b.add('switch', 0, 120, {}, 'RST');
  const cin = b.add('numin', 0, 200, { w: 8 }, 'CONST');
  const nsel = b.add('numin', 0, 320, { w: 4 }, 'NETSEL');
  const pcp = b.add('hexdisp', 1160, 0, { w: 4 }, 'PC');
  const recp = b.add('hexdisp', 1160, 80, { w: 16 }, 'REC');
  const netp = b.add('hexdisp', 1160, 180, { w: 8 }, 'NET');
  const wrapp = b.add('led', 1160, 280, {}, 'WRAP');
  // the walker: a counter steps through the circuit file, one gate per clock
  const ct = b.add('counter', 160, 60, { w: 4 }, 'walker');
  const up1 = b.add('const', 160, 200, { w: 1, value: 1 }, 'UP=1');
  const ld0 = b.add('const', 160, 260, { w: 1, value: 0 }, 'LD=0');
  const d0 = b.add('const', 160, 320, { w: 4, value: 0 }, 'D=0');
  b.w(clk, 'Q', ct, 'CLK'); b.w(run, 'Q', ct, 'EN'); b.w(rst, 'Q', ct, 'CLR');
  b.w(up1, 'Q', ct, 'UP'); b.w(ld0, 'Q', ct, 'LD'); b.w(d0, 'Q', ct, 'D');
  const rom = b.add('rom', 360, 60, { a: 4, w: 16, data: FULL_ADDER_NETLIST }, 'circuit file');
  b.w(ct, 'Q', rom, 'ADDR');
  const fld = (lo: number, n: number, y: number, name: string) => {
    const s = b.add('slice', 560, y, { w: 16, lo, n }, name);
    b.w(rom, 'DATA', s, 'In');
    return s;
  };
  const op = fld(12, 3, 0, 'op'), ia = fld(8, 4, 80, 'inA'), ib = fld(4, 4, 160, 'inB'), id = fld(0, 4, 240, 'dest');
  // net store: two mirrored register files written identically each tick —
  // that's 2 operand read ports + 1 inspector read port out of a 1-write-port part
  const we1 = b.add('const', 860, 480, { w: 1, value: 1 }, 'WE=1');
  const rf = b.add('regfile', 620, 60, { a: 3, w: 8 }, 'nets');
  b.w(ia, 'Out', rf, 'RA'); b.w(ib, 'Out', rf, 'RB'); b.w(id, 'Out', rf, 'WA');
  const rfN = b.add('regfile', 620, 300, { a: 3, w: 8 }, 'net inspector');
  b.w(nsel, 'Q', rfN, 'RA'); b.w(nsel, 'Q', rfN, 'RB'); b.w(id, 'Out', rfN, 'WA');
  const alu = b.add('alu', 880, 100, { w: 8 }, 'gate');
  b.w(rf, 'QA', alu, 'A'); b.w(rf, 'QB', alu, 'B'); b.w(op, 'Out', alu, 'OP');
  // op 6 (INPUT) writes a bit of the external CONST input instead of the ALU result
  const six = b.add('const', 880, 260, { w: 3, value: 6 }, '6');
  const isin = b.add('comparator', 1040, 260, { w: 3 }, 'op==6');
  b.w(op, 'Out', isin, 'A'); b.w(six, 'Q', isin, 'B');
  const bits = b.add('splitter', 560, 380, { w: 8 }, 'CONST bits');
  b.w(cin, 'Q', bits, 'Bus');
  const bitmux = b.add('mux', 700, 440, { s: 3, w: 1 }, 'INPUT bit');
  for (let k = 0; k < 8; k++) b.w(bits, 'b' + k, bitmux, 'D' + k);
  b.w(ia, 'Out', bitmux, 'S');
  const wb = b.add('mux', 1040, 100, { s: 1, w: 8 }, 'writeback');
  b.w(alu, 'R', wb, 'D0'); b.w(bitmux, 'Y', wb, 'D1'); b.w(isin, 'A=B', wb, 'S');
  for (const r of [rf, rfN]) { b.w(wb, 'Y', r, 'WD'); b.w(we1, 'Q', r, 'WE'); b.w(clk, 'Q', r, 'CLK'); }
  b.w(ct, 'Q', pcp, 'A'); b.w(rom, 'DATA', recp, 'A'); b.w(rfN, 'QA', netp, 'A'); b.w(ct, 'CO', wrapp, 'A');
  const { def, defs } = packAll(b, 'Netlist Engine');
  // drop outputs that dangle inside (ALU Z/C, comparator A>B/A<B, spare inspector port)
  const keep = new Set(['PC', 'REC', 'NET', 'WRAP']);
  const dropIds = new Set(def.outputs.filter((o) => !keep.has(o.label)).map((o) => o.id));
  def.outputs = def.outputs.filter((o) => keep.has(o.label));
  def.comps = def.comps.filter((c) => !dropIds.has(c.id));
  def.wires = def.wires.filter((w) => !dropIds.has(w.from.c) && !dropIds.has(w.to.c));
  return { def, defs };
}

function tSelfSim(): Circuit {
  const b = new B();
  const ne = netlistEngineDef();
  b.defs = { ...ne.defs };
  const clk = b.add('clock', 40, 80, { freq: 1, period: 40 }, 'CLK');
  const rst = b.add('switch', 40, 200, {}, 'RESET');
  const run = b.add('switch', 40, 300, { value: 1 }, 'RUN');
  const inp = b.add('numin', 40, 420, { w: 8, value: 3 }, 'Inputs a·b·cin');
  const sel = b.add('numin', 40, 560, { w: 4, value: 4 }, 'Net select');
  const eng = b.ic(ne.def, 340, 160);
  const pc = b.add('hexdisp', 1160, 160, { w: 4 }, 'Gate #');
  const nv = b.add('hexdisp', 1160, 260, { w: 8 }, 'Net value');
  const rec = b.add('hexdisp', 1160, 360, { w: 16 }, 'Record');
  const wrap = b.add('led', 1160, 480, { color: 'yellow' }, 'Pass done');
  b.w(clk, 'CLK', eng, 'CLK'); b.w(rst, 'Q', eng, 'RST'); b.w(run, 'Q', eng, 'RUN');
  b.w(inp, 'Q', eng, 'CONST'); b.w(sel, 'Q', eng, 'NETSEL');
  b.w(eng, 'PC', pc, 'A'); b.w(eng, 'NET', nv, 'A'); b.w(eng, 'REC', rec, 'A'); b.w(eng, 'WRAP', wrap, 'A');
  b.probe(clk, 0, 'CLK'); b.probe(eng, 0, 'Gate #'); b.probe(eng, 1, 'Record'); b.probe(eng, 2, 'Net value');
  return b.circuit();
}

function tSrLatch(): Circuit {
  const b = new B();
  const r = b.add('button', 60, 60, {}, 'R'), s = b.add('button', 60, 200, {}, 'S');
  const n1 = b.add('nor', 260, 40), n2 = b.add('nor', 260, 180);
  const q = b.add('led', 460, 60, { color: 'green' }, 'Q'), qn = b.add('led', 460, 200, { color: 'red' }, 'Q̅');
  b.w(r, 'Q', n1, 'A'); b.w(s, 'Q', n2, 'B');
  b.w(n1, 'Y', n2, 'A'); b.w(n2, 'Y', n1, 'B');
  b.w(n1, 'Y', q, 'A'); b.w(n2, 'Y', qn, 'A');
  return b.circuit();
}

function tCounter(): Circuit {
  const b = new B();
  const clk = b.add('clock', 40, 80, { freq: 2 }, 'CLK');
  const ct = b.add('counter', 220, 60, { w: 4, mode: 'bcd' }, 'BCD');
  const dec = b.add('seg7dec', 440, 60);
  const seg = b.add('seg7', 640, 40);
  b.w(clk, 'CLK', ct, 'CLK'); b.w(ct, 'Q', dec, 'D');
  for (const s of 'abcdefg') b.w(dec, s, seg, s);
  b.probe(clk, 0, 'CLK'); b.probe(ct, 0, 'Count');
  return b.circuit();
}

// ---------- digital clock / stopwatch ----------
/**
 * One decimal digit of the clock as a reusable IC: a BCD counter plus the logic that
 * says when the NEXT digit must tick. EN in = "this digit ticks on the next clock edge",
 * ENo out = "the digit after me ticks too" = EN and I am on my last value.
 * mod6=true gives the 0-5 tens digit: it is loaded with 0 instead of counting on to 6.
 */
function clockDigitDef(mod6: boolean): ICDef {
  const b = new B();
  const en = b.add('pin_in', 0, 0, { w: 1 }, 'EN'), clk = b.add('pin_in', 0, 100, { w: 1 }, 'CLK'), clr = b.add('pin_in', 0, 200, { w: 1 }, 'CLR');
  const ct = b.add('counter', 220, 60, { w: 4, mode: 'bcd' }, mod6 ? 'tens 0-5' : 'ones 0-9');
  b.w(clk, 'out', ct, 'CLK'); b.w(en, 'out', ct, 'EN'); b.w(clr, 'out', ct, 'CLR');
  const q = b.add('pin_out', 620, 40, { w: 4 }, 'Q'), eno = b.add('pin_out', 620, 220, { w: 1 }, 'ENo');
  b.w(ct, 'Q', q, 'in');
  if (mod6) {
    const five = b.add('const', 220, 300, { w: 4, value: 5 }, '5');
    const cmp = b.add('comparator', 400, 300, { w: 4 });
    b.w(ct, 'Q', cmp, 'A'); b.w(five, 'Q', cmp, 'B');
    const wrap = b.add('and', 520, 240);
    b.w(en, 'out', wrap, 'A'); b.w(cmp, 'A=B', wrap, 'B');
    b.w(wrap, 'Y', ct, 'LD'); // D is left unconnected = 0: load zero instead of counting on to 6
    b.w(wrap, 'Y', eno, 'in');
  } else {
    const g = b.add('and', 480, 200);
    b.w(en, 'out', g, 'A'); b.w(ct, 'CO', g, 'B'); // CO = the digit is on 9
    b.w(g, 'Y', eno, 'in');
  }
  const pin = (id: string) => { const c = b.comps.find((x) => x.id === id)!; return { id, label: c.name, w: c.props.w }; };
  return { id: uid('ic'), name: mod6 ? 'Digit 0-5' : 'Digit 0-9', comps: b.comps, wires: b.wires, inputs: [en, clk, clr].map(pin), outputs: [q, eno].map(pin) };
}

function tClock(): Circuit {
  const b = new B();
  const d10 = clockDigitDef(false), d6 = clockDigitDef(true);
  // control rails across the top: RUN is the outermost, so no rail crosses another
  const run = b.add('switch', 40, 80, { value: 1 }, 'RUN');
  const clk = b.add('clock', 40, 140, { freq: 1, period: 40 }, 'CLK 1 Hz');
  const rst = b.add('button', 40, 200, {}, 'RESET');
  const tick = b.add('led', 200, 20, { color: 'yellow' }, 'tick');
  b.w(clk, 'CLK', tick, 'A');
  // four digit ICs in reading order (MM:SS), turned 90° so inputs enter from above and outputs leave below
  const cols = [
    { x: 200, def: d6, label: 'min ×10' }, { x: 600, def: d10, label: 'min ×1' },
    { x: 1080, def: d6, label: 'sec ×10' }, { x: 1480, def: d10, label: 'sec ×1' },
  ];
  const ics = cols.map((c) => b.ic(c.def, c.x, 300, '', 1));
  ics.forEach((ic, i) => {
    b.w(clk, 'CLK', ic, 'CLK'); b.w(rst, 'Q', ic, 'CLR');
    if (i < 3) b.w(ics[i + 1], 'ENo', ic, 'EN'); // the digit to the right ticks over → I tick
  });
  b.w(run, 'Q', ics[3], 'EN');
  cols.forEach((c, i) => {
    const dec = b.add('seg7dec', c.x + 160, 500);
    const seg = b.add('seg7', c.x + 340, 500, {}, c.label);
    b.w(ics[i], 'Q', dec, 'D');
    for (const s of 'abcdefg') b.w(dec, s, seg, s);
  });
  b.probe(clk, 0, 'CLK');
  ics.slice().reverse().forEach((ic, i) => b.probe(ic, 0, ['sec ×1', 'sec ×10', 'min ×1', 'min ×10'][i]));
  return b.circuit();
}

function tRipple(): Circuit {
  const b = new B();
  const clk = b.add('clock', 40, 80, { freq: 2 }, 'CLK');
  const one = b.add('const', 40, 200, { w: 1, value: 1 }, '1');
  const f: string[] = [];
  for (let i = 0; i < 3; i++) {
    const t = b.add('tff', 240 + i * 220, 80, {}, 'T' + i);
    f.push(t);
    b.w(one, 'Q', t, 'T');
    if (i === 0) b.w(clk, 'CLK', t, 'CLK'); else b.w(f[i - 1], 'Q̅', t, 'CLK');
  }
  f.forEach((t, i) => { const l = b.add('led', 240 + i * 220, 240, { color: 'green' }, 'Q' + i); b.w(t, 'Q', l, 'A'); b.probe(t, 0, 'Q' + i); });
  b.probe(clk, 0, 'CLK');
  return b.circuit();
}

export interface Template { id: string; name: string; desc: string; tag: string; build: () => Circuit }
export const TEMPLATES: Template[] = [
  { id: 'ha', name: 'Half Adder', tag: 'Combinational', desc: 'XOR gives the sum bit, AND gives the carry. Click the switches and watch the wires.', build: tHalfAdder },
  { id: 'fa', name: 'Full Adder', tag: 'Combinational', desc: 'Two half-adder ICs plus an OR gate — a hierarchy built with the "Package IC" feature.', build: tFullAdder },
  { id: 'add4', name: '4-bit Ripple Adder', tag: 'Combinational', desc: 'Four full-adder ICs chained by carry, with bus splitters/merger. Change A and B (click the number inputs). Try the critical-path button!', build: tAdder4 },
  { id: 'alu', name: '4-bit ALU', tag: 'Combinational', desc: 'ADD / SUB / AND / OR selected by a 2-bit opcode, built from adder, wide gates, a mux and a zero flag.', build: tAlu },
  { id: 'sr', name: 'SR Latch (NOR)', tag: 'Sequential', desc: 'Cross-coupled NOR gates: the simplest memory. Press S then R. Switch to propagation-delay mode to see real settling.', build: tSrLatch },
  { id: 'rip', name: '3-bit Ripple Counter', tag: 'Sequential', desc: 'Toggle flip-flops each dividing the clock by two. Open the waveform viewer to see the staircase.', build: tRipple },
  { id: 'bcd', name: 'BCD Counter + 7-segment', tag: 'Sequential', desc: 'A decade counter driving a 7-segment decoder and display.', build: tCounter },
  { id: 'clock', name: 'Digital Clock / Stopwatch (MM:SS)', tag: 'Sequential', desc: 'Four BCD counter digits (0-5 and 0-9, each packaged as an IC with its carry logic) cascaded into a 59:59 clock, clocked at 1 Hz and shown on 7-segment displays. RUN pauses it, hold RESET to zero it. Raise the CLK frequency in Properties to fast-forward. Double-click a digit IC to see inside, or select one and use Break down to spill its internals onto the canvas.', build: tClock },
  { id: 'rf', name: 'Register File (4×4)', tag: 'CPU block', desc: 'Four 4-bit registers, a write-enable decoder and two read-port multiplexers.', build: tRegFile },
  { id: 'cpu', name: 'Toy CPU Datapath (runs code!)', tag: 'CPU', desc: 'PC, program ROM, control ROM, register file, ALU, data RAM with LD/ST and jump logic. Edit the program in the Assembler, hit Reset, then Run.', build: tCpu },
  { id: 'selfsim', name: 'Self-Hosted Gate Simulator', tag: 'Meta', desc: 'Logic Sim simulating itself: this IC evaluates a stored netlist, one gate per clock tick. The ROM is the "circuit file" — each word packs op·inA·inB·dest (op: 2=AND 3=OR 4=XOR 5=BUF 6=IN 7=NOT); two mirrored register files hold the 8 net values (2 operand reads + an inspector port); an ALU applies the gate and writes back. Demo netlist: a full adder. Set the Inputs numin (a=bit0, b=bit1, cin=bit2) and watch net 4 (SUM) / net 0 (COUT — it recycles a\'s net after its last use) re-settle. Edit the ROM hex in properties to rewire the simulated circuit.', build: tSelfSim },
  { id: 'cpueval', name: 'Toy CPU: Gate Simulator in Assembly', tag: 'CPU', desc: 'The genuine article: a table-driven netlist evaluator written in assembly, running on the CPU — which is itself made of gates being simulated by Logic Sim. Data RAM holds 16 nets + a record table ([op, inA, inB, dest], ops 1=AND 2=OR 3=XOR 4=NOT 5=PASS 6=CONST 0=HALT); each pass re-evaluates the full-adder netlist and sweeps every net across the display. Crank the clock to ~50 Hz to watch passes complete. View the source in the Assembler.', build: tCpuEval },
];

export { emptyCircuit };
