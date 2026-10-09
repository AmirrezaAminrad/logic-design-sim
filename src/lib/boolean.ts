// Boolean function analysis for the truth-table view: Quine–McCluskey
// minimization and gray-code Karnaugh map layout.
//
// A function of n variables is given as a set of minterm numbers. Variable i
// (input column i of the table) is bit (n-1-i) of a minterm, so column 0 is
// the most significant bit — matching the table's row enumeration order.

export interface Implicant {
  /** minterm value with all dashed bits cleared */
  v: number;
  /** bits the implicant ignores (the dashes) */
  dc: number;
}

const covers = (p: Implicant, m: number) => (m & ~p.dc) === (p.v & ~p.dc);

/**
 * Minimal sum-of-products cover: prime implicants via Quine–McCluskey,
 * then essential primes plus a greedy cover of the remainder.
 */
export function minimize(minterms: number[]): Implicant[] {
  const uniqMinterms = [...new Set(minterms)];
  const key = (p: Implicant) => p.v + ':' + p.dc;
  let current: Implicant[] = uniqMinterms.map((m) => ({ v: m, dc: 0 }));
  const primes = new Map<string, Implicant>();
  while (current.length) {
    const merged: Implicant[] = [];
    const seen = new Set<string>();
    const used = new Set<number>();
    for (let a = 0; a < current.length; a++) {
      for (let b = a + 1; b < current.length; b++) {
        const x = current[a], y = current[b];
        if (x.dc !== y.dc) continue;
        const diff = x.v ^ y.v;
        if (diff && (diff & (diff - 1)) === 0) {
          used.add(a);
          used.add(b);
          const p = { v: Math.min(x.v, y.v), dc: x.dc | diff };
          if (!seen.has(key(p))) { seen.add(key(p)); merged.push(p); }
        }
      }
    }
    for (let i = 0; i < current.length; i++) if (!used.has(i)) primes.set(key(current[i]), current[i]);
    current = merged;
  }
  const primeList = [...primes.values()];
  const uncovered = new Set(uniqMinterms);
  const chosen: Implicant[] = [];
  const take = (p: Implicant) => {
    chosen.push(p);
    for (const m of [...uncovered]) if (covers(p, m)) uncovered.delete(m);
  };
  // essential primes: minterms covered by exactly one prime
  for (const m of uniqMinterms) {
    const cov = primeList.filter((p) => covers(p, m));
    if (cov.length === 1 && !chosen.includes(cov[0])) take(cov[0]);
  }
  while (uncovered.size) {
    let best: Implicant | null = null, bestCount = 0;
    for (const p of primeList) {
      if (chosen.includes(p)) continue;
      let cnt = 0;
      for (const m of uncovered) if (covers(p, m)) cnt++;
      if (cnt > bestCount) { bestCount = cnt; best = p; }
    }
    if (!best) break;
    take(best);
  }
  return chosen.sort((a, b) => a.dc - b.dc || a.v - b.v);
}

/** Formats implicants as SOP text, e.g. "A·B + A'·C". NOT is a trailing apostrophe. */
export function formatSOP(imp: Implicant[], vars: string[]): string {
  if (!vars.length) return imp.length ? '1' : '0';
  if (!imp.length) return '0';
  const terms = imp.map((p) => {
    const cared = ((1 << vars.length) - 1) & ~p.dc;
    if (!cared) return '1';
    let s = '';
    for (let i = 0; i < vars.length; i++) {
      const bit = 1 << (vars.length - 1 - i);
      if (!(cared & bit)) continue;
      const lit = vars[i];
      s += (s ? '·' : '') + ((p.v & bit) ? lit : lit + "'");
    }
    return s;
  });
  return terms.join(' + ');
}

/** Binary-reflected gray code sequence of length 2ⁿ. */
export function gray(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < (1 << n); i++) out.push(i ^ (i >> 1));
  return out;
}

export interface KMap {
  /** variable indexes labeling the rows / columns (row variables are the high bits) */
  rowVars: number[];
  colVars: number[];
  rowHeads: { code: number; label: string }[];
  colHeads: { code: number; label: string }[];
  /** cells[r][c] = minterm number */
  cells: number[][];
}

/**
 * Karnaugh map layout for n ≤ 5: variables are split between rows and columns,
 * both axes walk in gray-code order so adjacent cells differ in one variable.
 */
export function kmap(vars: string[]): KMap {
  const n = vars.length;
  const nRows = Math.ceil(n / 2);
  const rowVars = Array.from({ length: nRows }, (_, i) => i);
  const colVars = Array.from({ length: n - nRows }, (_, i) => nRows + i);
  const rowHeads = gray(nRows).map((code) => ({
    code,
    label: Array.from({ length: nRows }, (_, k) => ((code >> (nRows - 1 - k)) & 1) ? vars[k] : vars[k] + "'").join(''),
  }));
  const colHeads = gray(n - nRows).map((code) => ({
    code,
    label: Array.from({ length: n - nRows }, (_, k) => ((code >> (n - nRows - 1 - k)) & 1) ? vars[nRows + k] : vars[nRows + k] + "'").join(''),
  }));
  const cells: number[][] = rowHeads.map((rh) =>
    colHeads.map((ch) => (rh.code << (n - nRows)) | ch.code),
  );
  return { rowVars, colVars, rowHeads, colHeads, cells };
}
