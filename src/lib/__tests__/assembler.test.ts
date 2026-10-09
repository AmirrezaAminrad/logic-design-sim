import { describe, expect, it } from 'vitest';
import { assemble, EXAMPLE_PROGRAM, OPCODES } from '../assembler';

describe('assembler', () => {
  it('encodes the example program correctly', () => {
    const r = assemble(EXAMPLE_PROGRAM);
    expect(r.errors).toEqual([]);
    expect(r.words).toEqual([
      0x1000, // LDI R0, 0
      0x1405, // LDI R1, 5
      0x18ff, // LDI R2, 255
      0x2100, // loop: ADD R0, R1
      0x2600, // ADD R1, R2
      0xc000, // OUT R0
      0xb403, // JNZ R1, loop
      0xf000, // HALT
    ]);
    expect(r.labels).toEqual({ loop: 3 });
  });
  it('supports all addressing formats', () => {
    const r = assemble([
      'NOP',
      'LDI R3, 0x2a',
      'MOV R1, R2',
      'JMP 5',
      'JZ R0, 5',
      'OUT R2',
      'HALT',
    ].join('\n'));
    expect(r.errors).toEqual([]);
    expect(r.words).toEqual([0x0000, 0x1c2a, 0x7600, 0x9005, 0xa005, 0xc800, 0xf000]);
  });
  it('accepts binary, hex and negative immediates', () => {
    expect(assemble('LDI R0, 0b101').words[0]).toBe(0x1005);
    expect(assemble('LDI R0, -1').words[0]).toBe(0x10ff);
    expect(assemble('LDI R0, 255').errors).toEqual([]);
  });
  it('reports errors: bad register, range, duplicates, unknown mnemonics', () => {
    expect(assemble('LDI R9, 1').errors.join(' ')).toMatch(/R0–R3/);
    expect(assemble('LDI R0, 300').errors.join(' ')).toMatch(/does not fit/);
    expect(assemble('LDI R0, 1').errors).toEqual([]); // sanity
    const dup = assemble('x: NOP\nx: NOP');
    expect(dup.errors.join(' ')).toMatch(/duplicate label/);
    expect(assemble('FROB R1').errors.join(' ')).toMatch(/unknown instruction/i);
    expect(assemble('ADD R1').errors.join(' ')).toMatch(/operand/);
  });
  it('ignores comments and blank lines, case-insensitive mnemonics', () => {
    const r = assemble('; comment\n\n  add R0, R1  ; inline\n');
    expect(r.errors).toEqual([]);
    expect(r.words).toEqual([0x2100]);
  });
  it('encodes LD/ST with bracketed indirect operands', () => {
    const r = assemble([
      'LD  R0, [R3]',
      'ST  R0, [R1]',
      'ld r2,[r3]',
      'ST R3, [ R0 ]',
    ].join('\n'));
    expect(r.errors).toEqual([]);
    expect(r.words).toEqual([0xd300, 0xe100, 0xdb00, 0xec00]);
  });
  it('rejects LD/ST without brackets or with a bad register inside', () => {
    expect(assemble('LD R0, R3').errors.join(' ')).toMatch(/expected \[rs\]/);
    expect(assemble('ST R0, R3').errors.join(' ')).toMatch(/expected \[rs\]/);
    expect(assemble('LD R0, [R9]').errors.join(' ')).toMatch(/expected \[rs\]/);
    expect(assemble('LD R0').errors.join(' ')).toMatch(/operand/);
  });
  it('documents every opcode', () => {
    for (const v of Object.values(OPCODES)) expect(v.doc.length).toBeGreaterThan(3);
  });
});
