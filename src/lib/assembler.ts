// Assembler for the toy 16-bit CPU.
// Instruction word: [15:12] opcode | [11:10] rd | [9:8] rs | [7:0] imm8

export interface AsmResult {
  words: number[];
  errors: string[];
  listing: { addr: number; word: number; text: string }[];
  labels: Record<string, number>;
}

type Fmt = 'none' | 'rd_imm' | 'rd_rs' | 'rd' | 'imm' | 'rd_target' | 'rd_pRs';
export const OPCODES: Record<string, { op: number; fmt: Fmt; doc: string }> = {
  NOP: { op: 0x0, fmt: 'none', doc: 'do nothing' },
  LDI: { op: 0x1, fmt: 'rd_imm', doc: 'rd = imm' },
  ADD: { op: 0x2, fmt: 'rd_rs', doc: 'rd = rd + rs' },
  SUB: { op: 0x3, fmt: 'rd_rs', doc: 'rd = rd - rs' },
  AND: { op: 0x4, fmt: 'rd_rs', doc: 'rd = rd & rs' },
  OR: { op: 0x5, fmt: 'rd_rs', doc: 'rd = rd | rs' },
  XOR: { op: 0x6, fmt: 'rd_rs', doc: 'rd = rd ^ rs' },
  MOV: { op: 0x7, fmt: 'rd_rs', doc: 'rd = rs' },
  ADDI: { op: 0x8, fmt: 'rd_imm', doc: 'rd = rd + imm' },
  JMP: { op: 0x9, fmt: 'imm', doc: 'pc = target' },
  JZ: { op: 0xa, fmt: 'rd_target', doc: 'if rd == 0: pc = target' },
  JNZ: { op: 0xb, fmt: 'rd_target', doc: 'if rd != 0: pc = target' },
  OUT: { op: 0xc, fmt: 'rd', doc: 'output register = rd' },
  LD: { op: 0xd, fmt: 'rd_pRs', doc: 'rd = mem[rs]' },
  ST: { op: 0xe, fmt: 'rd_pRs', doc: 'mem[rs] = rd' },
  HALT: { op: 0xf, fmt: 'none', doc: 'stop the program counter' },
};

export const EXAMPLE_PROGRAM = `; Sum 5+4+3+2+1, showing the running total on the output register
        LDI  R0, 0        ; running sum
        LDI  R1, 5        ; counter
        LDI  R2, 255      ; -1
loop:   ADD  R0, R1       ; sum += counter
        ADD  R1, R2       ; counter -= 1
        OUT  R0
        JNZ  R1, loop
        HALT
`;

// The "circuit file" for EVALUATOR_PROGRAM: 4-byte records [op, inA, inB, dest]
// stored in Data RAM at address 16. Ops: 0=HALT 1=AND 2=OR 3=XOR 4=NOT 5=PASS
// 6=CONST (net[dest] = inA). This netlist is a full adder built from gates.
const NETLIST_RECORDS: [number, number, number, number, string][] = [
  [6, 1, 0, 0, 'CONST: a = 1            → net 0'],
  [6, 1, 0, 1, 'CONST: b = 1            → net 1'],
  [6, 0, 0, 2, 'CONST: cin = 0          → net 2'],
  [3, 0, 1, 3, 'XOR:   x1 = a ^ b       → net 3'],
  [3, 3, 2, 4, 'XOR:   sum = x1 ^ cin   → net 4'],
  [1, 0, 1, 5, 'AND:   ab = a & b       → net 5'],
  [1, 0, 2, 6, 'AND:   ac = a & cin     → net 6'],
  [1, 1, 2, 7, 'AND:   bc = b & cin     → net 7'],
  [2, 5, 6, 8, 'OR:    t = ab | ac      → net 8'],
  [2, 8, 7, 9, 'OR:    cout = t | bc    → net 9'],
  [0, 0, 0, 0, 'HALT record: end of netlist'],
];

export const EVALUATOR_PROGRAM = `; =====================================================================
; A GATE-LEVEL NETLIST EVALUATOR, written in assembly.
; A logic simulator running on a CPU made of gates, simulated by Logic Sim.
;
; Data RAM map (64 bytes):
;   [0..15]  net values — the wires of the simulated circuit
;   [16...]  the "circuit file": 4-byte records [op, inA, inB, dest],
;            ending with an op=0 record. Ops:
;            0=HALT 1=AND 2=OR 3=XOR 4=NOT 5=PASS 6=CONST (net[dest]=inA)
; The demo netlist below is a full adder (a=1, b=1, cin=0 → sum=0, cout=1).
; Edit the record block to rewire the simulated circuit.
; Registers: R3 = walking table pointer, R0/R1 = scratch, R2 = scan counter.
; =====================================================================

; ---- copy the netlist into Data RAM at address 16 ----
        LDI  R3, 16       ; table base
${NETLIST_RECORDS.map(([op, a, bb, d, note], i) =>
  `; rec ${i}: ${note}\n` + [op, a, bb, d].map((v) => `        LDI  R0, ${v}\n        ST   R0, [R3]\n        ADDI R3, 1`).join('\n')
).join('\n')}

; ---- evaluate forever: fetch record, decode op, execute ----
        LDI  R3, 16       ; restart at the table
loop:   LD   R0, [R3]     ; op
        ADDI R3, 1        ; → inA
        JZ   R0, done     ; op 0: pass complete
        ADDI R0, 255      ; op -= 1
        JZ   R0, h_and
        ADDI R0, 255
        JZ   R0, h_or
        ADDI R0, 255
        JZ   R0, h_xor
        ADDI R0, 255
        JZ   R0, h_not
        ADDI R0, 255
        JZ   R0, h_pass
        ADDI R0, 255
        JZ   R0, h_const
        JMP  done         ; unknown op: restart the pass

h_and:  LD   R0, [R3]     ; inA
        ADDI R3, 1        ; → inB
        LD   R0, [R0]     ; net[inA]
        LD   R1, [R3]     ; inB
        ADDI R3, 1        ; → dest
        LD   R1, [R1]     ; net[inB]
        AND  R0, R1
        LD   R1, [R3]     ; dest
        ADDI R3, 1        ; → next op
        ST   R0, [R1]     ; net[dest] = result
        JMP  loop

h_or:   LD   R0, [R3]
        ADDI R3, 1
        LD   R0, [R0]
        LD   R1, [R3]
        ADDI R3, 1
        LD   R1, [R1]
        OR   R0, R1
        LD   R1, [R3]
        ADDI R3, 1
        ST   R0, [R1]
        JMP  loop

h_xor:  LD   R0, [R3]
        ADDI R3, 1
        LD   R0, [R0]
        LD   R1, [R3]
        ADDI R3, 1
        LD   R1, [R1]
        XOR  R0, R1
        LD   R1, [R3]
        ADDI R3, 1
        ST   R0, [R1]
        JMP  loop

h_not:  LD   R0, [R3]     ; inA
        LD   R0, [R0]     ; net[inA]
        LDI  R1, 1
        SUB  R1, R0       ; 1 - x = NOT for 1-bit nets
        ADDI R3, 2        ; skip inB → dest
        LD   R0, [R3]     ; dest
        ADDI R3, 1        ; → next op
        ST   R1, [R0]
        JMP  loop

h_pass: LD   R0, [R3]     ; inA
        LD   R0, [R0]     ; net[inA]
        ADDI R3, 2        ; skip inB → dest
        LD   R1, [R3]     ; dest
        ADDI R3, 1
        ST   R0, [R1]
        JMP  loop

h_const:LD   R0, [R3]     ; inA = the constant
        ADDI R3, 2        ; skip inB → dest
        LD   R1, [R3]     ; dest
        ADDI R3, 1
        ST   R0, [R1]
        JMP  loop

; ---- pass complete: sweep every net across the display, then restart ----
done:   LDI  R3, 0        ; net address
        LDI  R2, 16       ; net count
scan:   LD   R0, [R3]
        OUT  R0
        ADDI R3, 1
        ADDI R2, 255      ; count -= 1
        JNZ  R2, scan
        LDI  R0, 4        ; rest the display on SUM ...
        LD   R0, [R0]
        OUT  R0
        LDI  R0, 9        ; ... then COUT
        LD   R0, [R0]
        OUT  R0
        LDI  R3, 16       ; next pass
        JMP  loop
`;

export function assemble(src: string): AsmResult {
  const errors: string[] = [];
  const labels: Record<string, number> = {};
  const lines: { n: number; text: string; mn: string; args: string[] }[] = [];
  src.split('\n').forEach((raw, idx) => {
    let t = raw.replace(/[;#].*$/, '').trim();
    if (!t) return;
    const m = t.match(/^([A-Za-z_]\w*):\s*(.*)$/);
    if (m) {
      if (labels[m[1].toLowerCase()] !== undefined) errors.push(`Line ${idx + 1}: duplicate label "${m[1]}"`);
      labels[m[1].toLowerCase()] = lines.length;
      t = m[2].trim();
      if (!t) return;
    }
    const parts = t.split(/\s+/);
    const mn = parts[0].toUpperCase();
    const args = t.slice(parts[0].length).split(',').map((s) => s.trim()).filter(Boolean);
    lines.push({ n: idx + 1, text: t, mn, args });
  });

  const reg = (s: string | undefined, n: number): number => {
    const m = s?.match(/^[rR]([0-3])$/);
    if (!m) { errors.push(`Line ${n}: expected register R0–R3, got "${s ?? ''}"`); return 0; }
    return +m[1];
  };
  const memReg = (s: string | undefined, n: number): number => {
    const m = s?.match(/^\[\s*([rR][0-3])\s*\]$/);
    if (!m) { errors.push(`Line ${n}: expected [rs] — a register in square brackets — got "${s ?? ''}"`); return 0; }
    return +m[1][1];
  };
  const val = (s: string | undefined, n: number): number => {
    if (s === undefined) { errors.push(`Line ${n}: missing operand`); return 0; }
    const l = labels[s.toLowerCase()];
    if (l !== undefined) return l;
    let v = NaN;
    if (/^-?\d+$/.test(s)) v = parseInt(s, 10);
    else if (/^0x[0-9a-f]+$/i.test(s)) v = parseInt(s, 16);
    else if (/^0b[01]+$/i.test(s)) v = parseInt(s.slice(2), 2);
    if (isNaN(v)) { errors.push(`Line ${n}: unknown value or label "${s}"`); return 0; }
    if (v < -128 || v > 255) errors.push(`Line ${n}: immediate ${v} does not fit in 8 bits`);
    return v & 0xff;
  };

  const words: number[] = [];
  const listing: AsmResult['listing'] = [];
  lines.forEach((l, addr) => {
    const d = OPCODES[l.mn];
    if (!d) { errors.push(`Line ${l.n}: unknown instruction "${l.mn}"`); words.push(0); return; }
    let rd = 0, rs = 0, imm = 0;
    const need = { none: 0, rd_imm: 2, rd_rs: 2, rd: 1, imm: 1, rd_target: 2, rd_pRs: 2 }[d.fmt];
    if (l.args.length !== need) errors.push(`Line ${l.n}: ${l.mn} takes ${need} operand(s)`);
    switch (d.fmt) {
      case 'rd_imm': case 'rd_target': rd = reg(l.args[0], l.n); imm = val(l.args[1], l.n); break;
      case 'rd_rs': rd = reg(l.args[0], l.n); rs = reg(l.args[1], l.n); break;
      case 'rd_pRs': rd = reg(l.args[0], l.n); rs = memReg(l.args[1], l.n); break;
      case 'rd': rd = reg(l.args[0], l.n); break;
      case 'imm': imm = val(l.args[0], l.n); break;
      default: break;
    }
    const word = (d.op << 12) | (rd << 10) | (rs << 8) | imm;
    words.push(word);
    listing.push({ addr, word, text: l.text });
  });
  return { words, errors, listing, labels };
}
