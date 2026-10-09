import { TYPES, mask, pinsOf, delayOf } from './defs';
import type { Circuit, Comp, ICDef, Probe, Wire } from './types';

interface Src { n: number; p: number }
interface SNode {
  id: string; top: string; type: string; props: any;
  inW: number[]; inDef: number[]; src: (Src | null)[]; outW: number[];
  delay: number; seq: boolean;
}
export interface Rec { t: number; v: Record<string, number> }
export interface CritInfo { delay: number; ids: string[]; tops: string[]; pairs: Set<string>; topSet: Set<string>; loops: boolean }

const MAX_ITER = 120;

// Definitions are replaced immutably when edited, so array identity is a cheap, reliable change detector
// (stringifying every IC's contents on every sync would be slow).
const refIds = new WeakMap<object, number>();
let refCounter = 0;
const refId = (o: object) => {
  let i = refIds.get(o);
  if (i === undefined) { i = ++refCounter; refIds.set(o, i); }
  return i;
};

export class Engine {
  nodes: SNode[] = [];
  index = new Map<string, number>();
  out: number[][] = [];
  st: any[] = [];
  pipe: number[][][] = [];
  icOut = new Map<string, string[]>();
  icIn = new Map<string, string[]>();
  clocks: number[] = [];
  zero: number[] = [];
  mode: 'instant' | 'delay' = 'instant';
  unstable = false;
  truncated = false;
  time = 0;
  stamp = 0;
  sig = '';
  probes: Probe[] = [];
  rec: Rec[] = [];
  circuit: Circuit = { comps: [], wires: [], defs: {}, probes: [] };

  /** Returns true if the structure changed and the netlist was rebuilt. */
  sync(c: Circuit): boolean {
    this.circuit = c;
    this.probes = c.probes;
    const sig =
      c.comps.map((x) => x.id + x.type + JSON.stringify(x.props)).join('|') + '#' +
      c.wires.map((w) => `${w.from.c}.${w.from.p}>${w.to.c}.${w.to.p}`).join('|') + '#' +
      Object.entries(c.defs).map(([k, d]) => `${k}:${refId(d.comps)}:${refId(d.wires)}`).join(',');
    if (sig === this.sig) return false;
    this.sig = sig;
    this.rebuild(c);
    return true;
  }

  private rebuild(c: Circuit) {
    const defs = c.defs;
    type Raw = { top: string; type: string; props: any; ins: ReturnType<typeof pinsOf>['ins']; outs: ReturnType<typeof pinsOf>['outs']; src: ({ id: string; p: number } | null)[] };
    const raw = new Map<string, Raw>();
    this.icOut.clear();
    this.icIn.clear();
    this.truncated = false;
    const rec = (comps: Comp[], wires: Wire[], prefix: string, top: string | null, depth: number) => {
      if (depth > 8) { this.truncated = true; return; }
      for (const cm of comps) {
        const full = prefix + cm.id;
        const tp = top ?? cm.id;
        if (cm.type === 'ic') {
          const d: ICDef | undefined = defs[cm.props.def];
          if (!d) continue;
          this.icIn.set(full, d.inputs.map((x) => full + '/' + x.id));
          this.icOut.set(full, d.outputs.map((x) => full + '/' + x.id));
          rec(d.comps, d.wires, full + '/', tp, depth + 1);
          continue;
        }
        if (!TYPES[cm.type]) continue;
        const { ins, outs } = pinsOf(cm, defs);
        raw.set(full, { top: tp, type: cm.type, props: cm.props, ins, outs, src: new Array(ins.length).fill(null) });
      }
      for (const w of wires) {
        const sf = prefix + w.from.c, stt = prefix + w.to.c;
        const so = this.icOut.get(sf);
        const src = so ? { id: so[w.from.p], p: 0 } : { id: sf, p: w.from.p };
        const di = this.icIn.get(stt);
        const dst = di ? { id: di[w.to.p], p: 0 } : { id: stt, p: w.to.p };
        const n = raw.get(dst.id);
        if (n && src.id && raw.has(src.id) && dst.p < n.src.length) n.src[dst.p] = src;
      }
    };
    rec(c.comps, c.wires, '', null, 0);

    const oldIdx = this.index, oldOut = this.out, oldSt = this.st, oldPipe = this.pipe, oldNodes = this.nodes;
    this.nodes = [];
    this.index = new Map();
    const ids = [...raw.keys()];
    ids.forEach((id, i) => this.index.set(id, i));
    this.out = []; this.st = []; this.pipe = []; this.clocks = []; this.zero = [];
    ids.forEach((id, i) => {
      const r = raw.get(id)!;
      const delay = delayOf(r.type, r.props);
      const nd: SNode = {
        id, top: r.top, type: r.type, props: r.props,
        inW: r.ins.map((p) => p.w), inDef: r.ins.map((p) => p.def ?? 0),
        src: r.src.map((s) => (s ? { n: this.index.get(s.id)!, p: s.p } : null)),
        outW: r.outs.map((p) => p.w), delay, seq: !!TYPES[r.type].seq,
      };
      this.nodes.push(nd);
      const j = oldIdx.get(id);
      const old = j !== undefined && oldNodes[j].type === r.type ? j : -1;
      const out = r.outs.map((_, k) => (old >= 0 ? oldOut[old][k] ?? 0 : 0));
      this.out.push(out);
      this.st.push(old >= 0 && oldSt[old] !== undefined ? oldSt[old] : TYPES[r.type].init?.(r.props));
      const d = Math.max(delay, 1);
      this.pipe.push(
        out.map((v, k) => {
          const op = old >= 0 ? oldPipe[old]?.[k] : undefined;
          return op && op.length === d ? op.slice() : new Array(d).fill(v);
        })
      );
      if (r.type === 'clock') this.clocks.push(i);
      if (delay === 0) this.zero.push(i);
    });
    if (this.mode === 'instant') this.settle(); else this.zeroSettle();
    this.record();
  }

  private evalNode(i: number): { o: number[]; st: any } {
    const nd = this.nodes[i];
    const ins = nd.src.map((s, k) => ((s ? this.out[s.n][s.p] ?? 0 : nd.inDef[k]) & mask(nd.inW[k])));
    const r = TYPES[nd.type].eval(ins, nd.props, this.st[i]);
    const o = (Array.isArray(r) ? r : r.o).map((v, k) => v & mask(nd.outW[k] ?? 1));
    return { o, st: Array.isArray(r) ? this.st[i] : r.st };
  }

  settle() {
    const N = this.nodes.length;
    this.unstable = false;
    for (let it = 0; it < MAX_ITER; it++) {
      const res = new Array(N);
      for (let i = 0; i < N; i++) res[i] = this.evalNode(i);
      let changed = false;
      for (let i = 0; i < N; i++) {
        const o = this.out[i];
        for (let k = 0; k < o.length; k++) {
          const v = res[i].o[k] ?? 0;
          if (o[k] !== v) { o[k] = v; changed = true; }
        }
        this.st[i] = res[i].st;
      }
      if (!changed) return;
    }
    // Jacobi iteration oscillated (e.g. symmetric latch power-up): fall back to ordered updates, which break the tie.
    for (let it = 0; it < 100; it++) {
      let changed = false;
      for (let i = 0; i < N; i++) {
        const r = this.evalNode(i);
        const o = this.out[i];
        for (let k = 0; k < o.length; k++) {
          const v = r.o[k] ?? 0;
          if (o[k] !== v) { o[k] = v; changed = true; }
        }
        this.st[i] = r.st;
      }
      if (!changed) return;
    }
    this.unstable = true;
  }

  private zeroSettle() {
    for (let it = 0; it < 40; it++) {
      let ch = false;
      for (const i of this.zero) {
        const r = this.evalNode(i);
        const o = this.out[i];
        for (let k = 0; k < o.length; k++) {
          const v = r.o[k] ?? 0;
          if (o[k] !== v) { o[k] = v; ch = true; }
        }
      }
      if (!ch) break;
    }
  }

  /** Propagation-delay mode: advance one tick (1 ns). Transport-delay model so glitches/races are visible. */
  tick() {
    this.time++;
    for (const i of this.clocks) {
      const s = this.st[i];
      s.t++;
      const half = Math.max(1, Math.round((this.nodes[i].props.period ?? 20) / 2));
      if (s.t >= half) { s.lvl ^= 1; s.t = 0; }
    }
    const N = this.nodes.length;
    const res = new Array(N);
    for (let i = 0; i < N; i++) res[i] = this.evalNode(i);
    for (let i = 0; i < N; i++) {
      const nd = this.nodes[i], o = this.out[i];
      for (let k = 0; k < o.length; k++) {
        const v = res[i].o[k] ?? 0;
        if (nd.delay === 0) o[k] = v;
        else { const pp = this.pipe[i][k]; pp.push(v); o[k] = pp.shift()!; }
      }
      this.st[i] = res[i].st;
    }
    this.zeroSettle();
    this.record();
  }

  /** Instant mode: advance wall-clock time by dt seconds. */
  advance(dt: number): boolean {
    const counts: number[] = [];
    let maxN = 0;
    for (const i of this.clocks) {
      const s = this.st[i];
      s.acc += dt * (this.nodes[i].props.freq ?? 1) * 2;
      const fl = Math.floor(s.acc);
      s.acc -= fl;
      const n = Math.min(fl, 16);
      counts.push(n);
      maxN = Math.max(maxN, n);
    }
    for (let step = 1; step <= maxN; step++) {
      this.clocks.forEach((i, idx) => { if (counts[idx] >= step) this.st[i].lvl ^= 1; });
      this.settle();
      this.record();
    }
    return maxN > 0;
  }

  halfStep() {
    if (this.mode === 'delay') { this.tick(); return; }
    if (!this.clocks.length) return;
    for (const i of this.clocks) this.st[i].lvl ^= 1;
    this.settle();
    this.record();
  }

  fullStep() {
    if (this.mode === 'delay') {
      const per = Math.max(10, ...this.clocks.map((i) => this.nodes[i].props.period ?? 20));
      for (let k = 0; k < per; k++) this.tick();
      return;
    }
    this.halfStep();
    this.halfStep();
  }

  toggleClock(id: string) {
    const i = this.index.get(id);
    if (i === undefined) return;
    this.st[i].lvl ^= 1;
    if (this.mode === 'instant') this.settle(); else this.zeroSettle();
    this.record();
  }

  reset() {
    this.nodes.forEach((nd, i) => {
      this.out[i] = nd.outW.map(() => 0);
      this.st[i] = TYPES[nd.type].init?.(nd.props);
      this.pipe[i] = this.out[i].map(() => new Array(Math.max(nd.delay, 1)).fill(0));
    });
    this.time = 0;
    this.stamp = 0;
    this.rec = [];
    if (this.mode === 'instant') this.settle(); else this.zeroSettle();
    this.record();
  }

  setMode(m: 'instant' | 'delay') {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'instant') this.settle();
    else this.nodes.forEach((_nd, i) => this.pipe[i].forEach((pp, k) => pp.fill(this.out[i][k])));
  }

  outOf(top: string, pin: number): number {
    const io = this.icOut.get(top);
    const i = this.index.get(io ? io[pin] : top);
    if (i === undefined) return 0;
    return this.out[i][io ? 0 : pin] ?? 0;
  }

  inOf(top: string, pin: number): number {
    const ii = this.icIn.get(top);
    const i = this.index.get(ii ? ii[pin] : top);
    if (i === undefined) return 0;
    const nd = this.nodes[i];
    const k = ii ? 0 : pin;
    const s = nd.src[k];
    return (s ? this.out[s.n][s.p] ?? 0 : nd.inDef[k] ?? 0) & mask(nd.inW[k] ?? 1);
  }

  stOf(top: string): any {
    const i = this.index.get(top);
    return i === undefined ? undefined : this.st[i];
  }

  probeVal(p: Probe) {
    return p.kind === 'out' ? this.outOf(p.comp, p.pin) : this.inOf(p.comp, p.pin);
  }

  record() {
    const v: Record<string, number> = {};
    for (const p of this.probes) v[p.id] = this.probeVal(p);
    this.rec.push({ t: ++this.stamp, v });
    if (this.rec.length > 5000) this.rec.splice(0, this.rec.length - 5000);
  }

  /** Longest combinational path (static timing analysis using each component's propagation delay). */
  critical(): CritInfo | null {
    const N = this.nodes.length;
    if (!N) return null;
    const arr = new Array<number>(N).fill(0);
    const pred = new Array<number>(N).fill(-1);
    const state = new Uint8Array(N);
    let loops = false;
    const visit = (i: number): number => {
      if (state[i] === 2) return arr[i];
      if (state[i] === 1) { loops = true; return 0; }
      state[i] = 1;
      const nd = this.nodes[i];
      let best = 0, bp = -1;
      if (!nd.seq) {
        for (const s of nd.src) {
          if (!s) continue;
          const a = visit(s.n);
          if (a > best || bp < 0) { best = a; bp = s.n; }
        }
      }
      arr[i] = nd.delay + best;
      pred[i] = bp;
      state[i] = 2;
      return arr[i];
    };
    for (let i = 0; i < N; i++) visit(i);
    let bestV = -1, bestEnd = -1, endPred = -1;
    for (let i = 0; i < N; i++) {
      const nd = this.nodes[i];
      if (nd.seq) {
        let m = -1, mp = -1;
        for (const s of nd.src) if (s && arr[s.n] > m) { m = arr[s.n]; mp = s.n; }
        if (m > bestV) { bestV = m; bestEnd = i; endPred = mp; }
      } else if (arr[i] > bestV) { bestV = arr[i]; bestEnd = i; endPred = pred[i]; }
    }
    if (bestEnd < 0) return null;
    const path: number[] = [bestEnd];
    let cur = endPred;
    let guard = 0;
    while (cur >= 0 && guard++ < N) {
      path.push(cur);
      cur = this.nodes[cur].seq ? -1 : pred[cur];
    }
    path.reverse();
    const ids = path.map((i) => this.nodes[i].id);
    const tops: string[] = [];
    for (const i of path) { const t = this.nodes[i].top; if (tops[tops.length - 1] !== t) tops.push(t); }
    const pairs = new Set<string>();
    for (let k = 0; k + 1 < tops.length; k++) pairs.add(tops[k] + '>' + tops[k + 1]);
    return { delay: Math.max(0, bestV + (this.nodes[bestEnd].seq ? 0 : 0)), ids, tops, pairs, topSet: new Set(tops), loops };
  }
}

export const engine = new Engine();

// ---------------- Truth table ----------------
export interface TTResult {
  inCols: { label: string; w: number }[];
  outCols: { label: string; w: number }[];
  rows: { ins: number[]; outs: number[] }[];
  /** the drivers feeding the table, in column order; real=false for synthesized drivers of unconnected pins */
  setters: { id: string; w: number; label: string; real: boolean }[];
  /** true when the selection contains state elements */
  hasSeq: boolean;
  note?: string;
  error?: string;
}

export function truthTable(c: Circuit, ids: string[], opts: { resetState?: boolean } = {}): TTResult {
  const empty: TTResult = { inCols: [], outCols: [], rows: [], setters: [], hasSeq: false };
  const sel = new Set(ids);
  const comps = c.comps.filter((x) => sel.has(x.id) && TYPES[x.type] ? true : sel.has(x.id) && x.type === 'ic');
  if (!comps.length) return { ...empty, error: 'Select some components first (drag a box around a sub-circuit).' };
  const wires = c.wires.filter((w) => sel.has(w.from.c) && sel.has(w.to.c));
  const drvTypes = ['switch', 'button', 'numin'];
  const isSink = (x: Comp) => !!TYPES[x.type]?.sink || x.type === 'pin_out';
  const label = (x: Comp) => x.name || (x.type === 'ic' ? c.defs[x.props.def]?.name : TYPES[x.type]?.label) || x.type;

  const synthComps: Comp[] = comps.map((x) => ({ ...x, props: { ...x.props } }));
  const synthWires: Wire[] = wires.map((w) => ({ ...w }));
  const setters: { id: string; w: number; label: string; real: boolean }[] = [];
  const outSpecs: { id: string; pin: number; kind: 'out' | 'in'; label: string; w: number }[] = [];

  for (const x of comps) {
    const { ins, outs } = pinsOf(x, c.defs);
    if (drvTypes.includes(x.type)) { setters.push({ id: x.id, w: outs[0].w, label: label(x), real: true }); continue; }
    if (x.type === 'clock' || x.type === 'const') continue;
    if (!isSink(x)) {
      ins.forEach((p, k) => {
        const internal = wires.some((w) => w.to.c === x.id && w.to.p === k);
        if (internal) return;
        const external = c.wires.some((w) => w.to.c === x.id && w.to.p === k);
        if (!external && p.def !== undefined) return;
        const did = '__d' + setters.length;
        synthComps.push({ id: did, type: 'numin', x: 0, y: 0, rot: 0, name: '', props: { w: p.w, value: 0 } });
        synthWires.push({ id: '__w' + did, from: { c: did, p: 0 }, to: { c: x.id, p: k } });
        setters.push({ id: did, w: p.w, label: `${label(x)}${ins.length > 1 ? '.' + p.name : ''}`, real: false });
      });
    }
    if (isSink(x)) {
      ins.forEach((p, k) => {
        if (wires.some((w) => w.to.c === x.id && w.to.p === k)) outSpecs.push({ id: x.id, pin: k, kind: 'in', label: `${label(x)}${ins.length > 1 ? '.' + p.name : ''}`, w: p.w });
      });
    } else {
      outs.forEach((p, k) => {
        const fromHere = c.wires.filter((w) => w.from.c === x.id && w.from.p === k);
        const external = fromHere.some((w) => !sel.has(w.to.c));
        if (external || fromHere.length === 0) outSpecs.push({ id: x.id, pin: k, kind: 'out', label: `${label(x)}${outs.length > 1 ? '.' + p.name : ''}`, w: p.w });
      });
    }
  }
  const bits = setters.reduce((a, s) => a + s.w, 0);
  if (!setters.length) return { ...empty, error: 'No inputs found in the selection.' };
  if (!outSpecs.length) return { ...empty, error: 'No outputs found in the selection.' };
  if (bits > 12) return { ...empty, error: `Too many input bits (${bits}). Exhaustive testing is limited to 12 input bits (4096 rows) — select a smaller sub-circuit.` };

  const hasSeq = comps.some((x) => TYPES[x.type]?.seq);
  const e = new Engine();
  e.sync({ comps: synthComps, wires: synthWires, defs: c.defs, probes: [] });
  const props = setters.map((s) => synthComps.find((x) => x.id === s.id)!.props);
  const rows: TTResult['rows'] = [];
  for (let r = 0; r < 1 << bits; r++) {
    let shift = bits;
    const vals = setters.map((s, k) => {
      shift -= s.w;
      const v = (r >> shift) & mask(s.w);
      props[k].value = v;
      return v;
    });
    if (opts.resetState && hasSeq) e.reset();
    e.settle();
    rows.push({ ins: vals, outs: outSpecs.map((o) => (o.kind === 'out' ? e.outOf(o.id, o.pin) : e.inOf(o.id, o.pin))) });
  }
  const notes = [
    hasSeq
      ? opts.resetState
        ? 'This selection contains state elements (flip-flops/latches/ICs): state is reset before every row, so rows are independent. Edge-triggered parts cannot toggle within a static table.'
        : 'This selection contains state elements: outputs may depend on history — rows are simulated in order, like a test sequence.'
      : '',
    comps.some((x) => x.type === 'clock' || x.type === 'const') ? 'Clocks and constants in the selection are held at their current value (clocks read as 0).' : '',
  ].filter(Boolean);
  return {
    inCols: setters.map((s) => ({ label: s.label, w: s.w })),
    outCols: outSpecs.map((o) => ({ label: o.label, w: o.w })),
    rows,
    setters,
    hasSeq,
    note: notes.length ? notes.join(' ') : undefined,
  };
}
