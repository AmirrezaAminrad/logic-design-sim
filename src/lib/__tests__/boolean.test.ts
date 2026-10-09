import { describe, expect, it } from 'vitest';
import { minimize, formatSOP, gray, kmap } from '../boolean';

const covers = (p: { v: number; dc: number }, m: number) => (m & ~p.dc) === (p.v & ~p.dc);
const key = (p: { v: number; dc: number }) => `${p.v}:${p.dc}`;

describe('boolean minimization (Quine–McCluskey)', () => {
  it('finds the minimal SOP for A·B + A·C (minterms 5,6,7 of A,B,C)', () => {
    const imp = minimize([5, 6, 7]);
    // A·C = 1-1 → (5, dc=010); A·B = 11- → (6, dc=001)
    expect(new Set(imp.map(key))).toEqual(new Set(['5:2', '6:1']));
    expect(formatSOP(imp, ['A', 'B', 'C'])).toBe('A·B + A·C');
  });
  it('cannot simplify 3-input XOR (4 disjoint minterms)', () => {
    const imp = minimize([1, 2, 4, 7]);
    expect(imp).toHaveLength(4);
    expect(imp.every((p) => p.dc === 0)).toBe(true);
  });
  it('absorbs into a single term when one variable suffices', () => {
    // A·B·C + A·B·C' + A'·B·C + A'·B·C' = B
    const imp = minimize([2, 3, 6, 7]);
    expect(imp).toEqual([{ v: 2, dc: 5 }]);
    expect(formatSOP(imp, ['A', 'B', 'C'])).toBe('B');
  });
  it('handles the constant functions', () => {
    expect(formatSOP(minimize([]), ['A', 'B', 'C'])).toBe('0');
    expect(formatSOP(minimize([0, 1, 2, 3, 4, 5, 6, 7]), ['A', 'B', 'C'])).toBe('1');
  });
  it('formats literals with NOT as a trailing apostrophe', () => {
    expect(formatSOP([{ v: 4, dc: 3 }], ['A', 'B', 'C'])).toBe('A');   // 1-- → A
    expect(formatSOP([{ v: 0, dc: 3 }], ['A', 'B', 'C'])).toBe("A'");  // 0-- → A'
    expect(formatSOP([{ v: 5, dc: 2 }], ['A', 'B', 'C'])).toBe('A·C'); // 1-1 → A·C
  });
  it('covers every 1-minterm and no 0-minterm on random functions', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let trial = 0; trial < 25; trial++) {
      const n = 3 + Math.floor(rnd() * 2); // 3 or 4 vars
      const f: number[] = [];
      for (let m = 0; m < (1 << n); m++) if (rnd() < 0.5) f.push(m);
      const imp = minimize(f);
      for (let m = 0; m < (1 << n); m++) {
        expect(imp.some((p) => covers(p, m))).toBe(f.includes(m));
      }
    }
  });
});

describe('gray code and Karnaugh map layout', () => {
  it('gray codes are cyclic: successive codes differ in one bit', () => {
    for (const n of [1, 2, 3]) {
      const seq = gray(n);
      for (let i = 0; i < seq.length; i++) {
        const d = seq[i] ^ seq[(i + 1) % seq.length];
        expect(d !== 0 && (d & (d - 1)) === 0).toBe(true);
      }
    }
  });
  it('K-maps for 1–5 vars list every minterm once with 1-bit adjacency', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const vars = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
      const km = kmap(vars);
      expect(km.cells.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 1 << n }, (_, i) => i));
      for (let r = 0; r < km.cells.length; r++) {
        for (let c = 0; c < km.cells[0].length; c++) {
          if (c + 1 < km.cells[0].length) {
            const d = km.cells[r][c] ^ km.cells[r][c + 1];
            expect(d !== 0 && (d & (d - 1)) === 0).toBe(true);
          }
          if (r + 1 < km.cells.length) {
            const d = km.cells[r][c] ^ km.cells[r + 1][c];
            expect(d !== 0 && (d & (d - 1)) === 0).toBe(true);
          }
        }
      }
    }
  });
});
