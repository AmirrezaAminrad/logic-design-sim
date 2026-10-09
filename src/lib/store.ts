import { create } from 'zustand';
import type { Circuit, Comp, ICDef, Probe, Wire } from './types';
import { emptyCircuit, uid } from './types';
import { TYPES, newComp, pinsOf } from './defs';
import { bbox, layoutOf, snap } from './geometry';
import { engine } from './engine';
import { packageSelection } from './ic';
import { breakDown, customize, isBreakable } from './breakdown';
import { TEMPLATES } from './templates';

export type Dialog = null | 'files' | 'templates' | 'asm' | 'tt' | 'pkg' | 'help';
export interface Sel { comps: string[]; wires: string[] }
export interface View { x: number; y: number; k: number }
/**
 * An open IC editing session. `saved` is the circuit being edited one level up (the main
 * circuit, or the parent IC's internals when sessions are nested); undo history is stashed
 * while the inner circuit is edited and restored on exit.
 */
export interface Editing {
  defId: string;
  saved: Circuit;
  savedName: string;
  savedPast: Circuit[];
  savedFuture: Circuit[];
  parent: Editing | null;
}
export type Panel = null | 'palette' | 'props';
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 3;

interface State {
  circuit: Circuit;
  past: Circuit[];
  future: Circuit[];
  sel: Sel;
  view: View;
  viewSize: { w: number; h: number };
  clip: { comps: Comp[]; wires: Wire[]; n: number } | null;
  ver: number;
  struct: number;
  theme: 'dark' | 'light';
  running: boolean;
  mode: 'instant' | 'delay';
  scale: number;
  tps: number;
  showWave: boolean;
  showCrit: boolean;
  tool: 'select' | 'pan';
  dialog: Dialog;
  toastMsg: string | null;
  circuitName: string;
  editing: Editing | null;
  /** which side panel is open on narrow screens (docked panels ignore this) */
  panel: Panel;

  bump: () => void;
  beginTx: () => void;
  update: (fn: (c: Circuit) => Circuit) => void;
  commit: (fn: (c: Circuit) => Circuit) => void;
  setSel: (s: Sel) => void;
  setView: (v: View) => void;
  /** returns the new component's id, or '' when it was refused */
  addComp: (type: string, x: number, y: number, props?: Record<string, any>) => string;
  setProp: (id: string, patch: Record<string, any>, history?: boolean) => void;
  setName: (id: string, name: string) => void;
  rotate: () => void;
  deleteSel: () => void;
  addWire: (from: { c: string; p: number }, to: { c: string; p: number }) => void;
  setWireLabel: (id: string, label: string) => void;
  undo: () => void;
  redo: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  selectAll: () => void;
  loadCircuit: (c: Circuit, name?: string) => void;
  newCircuit: () => void;
  fit: () => void;
  zoomBy: (f: number) => void;
  pack: (name: string) => boolean;
  breakdown: () => boolean;
  editInternals: (id?: string) => boolean;
  addProbe: (comp: string, pin: number, kind: 'out' | 'in', label: string) => void;
  removeProbe: (id: string) => void;
  setProbes: (p: Probe[]) => void;
  setMode: (m: 'instant' | 'delay') => void;
  enterEdit: (defId: string) => void;
  exitEdit: () => void;
  patch: (p: Partial<State>) => void;
  toast: (m: string) => void;
}

export function normalize(c: any): Circuit {
  const out: Circuit = {
    comps: (c.comps ?? []).filter((x: Comp) => TYPES[x.type] || x.type === 'ic').map((x: Comp) => ({
      ...x, rot: x.rot ?? 0, name: x.name ?? '',
      props: { ...JSON.parse(JSON.stringify(TYPES[x.type]?.defaults ?? {})), ...(x.props ?? {}) },
    })),
    wires: c.wires ?? [],
    defs: c.defs ?? {},
    probes: c.probes ?? [],
  };
  return prune(out);
}

export function prune(c: Circuit): Circuit {
  const pins = new Map<string, { i: number; o: number }>();
  for (const x of c.comps) {
    const p = pinsOf(x, c.defs);
    pins.set(x.id, { i: p.ins.length, o: p.outs.length });
  }
  const wires = c.wires.filter((w) => {
    const a = pins.get(w.from.c), b = pins.get(w.to.c);
    return a && b && w.from.p < a.o && w.to.p < b.i;
  });
  const probes = c.probes.filter((p) => pins.has(p.comp));
  if (wires.length === c.wires.length && probes.length === c.probes.length) return c;
  return { ...c, wires, probes };
}

function loadInitial(): { circuit: Circuit; editing: Editing | null; name: string } {
  try {
    const raw = localStorage.getItem('lds.autosave');
    if (raw) {
      const j = JSON.parse(raw);
      if (j && j.edit && j.main) {
        // restore an in-progress IC editing session
        const main = normalize(j.main);
        const def = main.defs[j.edit.defId];
        if (def) {
          const circuit = normalize({ comps: j.edit.circuit.comps, wires: j.edit.circuit.wires, defs: main.defs, probes: [] });
          const editing: Editing = { defId: j.edit.defId, saved: main, savedName: j.mainName ?? 'Untitled', savedPast: [], savedFuture: [], parent: null };
          return { circuit, editing, name: def.name };
        }
      }
      if (j && Array.isArray(j.comps)) return { circuit: normalize(j), editing: null, name: typeof j.name === 'string' && j.name ? j.name : 'Untitled' };
    }
  } catch { /* ignore */ }
  return { circuit: normalize(TEMPLATES[0].build()), editing: null, name: TEMPLATES[0].name };
}

/** True when `rootId` is `targetId` or (transitively) contains an instance of it. */
function containsDef(defs: Record<string, ICDef>, rootId: string, targetId: string, seen = new Set<string>()): boolean {
  if (rootId === targetId) return true;
  if (seen.has(rootId)) return false;
  seen.add(rootId);
  return !!defs[rootId]?.comps.some((x) => x.type === 'ic' && containsDef(defs, x.props.def, targetId, seen));
}

/**
 * The circuit one editing level up, with the latest defs. For nested sessions every ancestor
 * level is folded into its def so the result is the main circuit.
 */
function foldParents(circuit: Circuit, editing: Editing): Circuit {
  let cur: Circuit = { ...editing.saved, defs: circuit.defs };
  for (let e = editing.parent; e; e = e.parent) {
    const def = cur.defs[e.defId];
    const defs = def ? { ...cur.defs, [e.defId]: { ...def, comps: cur.comps, wires: cur.wires } } : cur.defs;
    cur = { ...e.saved, defs };
  }
  return cur;
}

const rootOf = (e: Editing): Editing => (e.parent ? rootOf(e.parent) : e);

export const useStore = create<State>()((set, get) => {
  const init = loadInitial();
  const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  return {
  circuit: init.circuit,
  past: [],
  future: [],
  sel: { comps: [], wires: [] },
  view: { x: 20, y: 20, k: 1 },
  viewSize: { w: 1000, h: 700 },
  clip: null,
  ver: 0,
  struct: 0,
  theme: (localStorage.getItem('lds.theme') as 'dark' | 'light') || 'dark',
  running: true,
  mode: 'instant',
  scale: 1,
  tps: 20,
  showWave: false,
  showCrit: false,
  // on touch screens a dragged background pans the view; box-select is the explicit alternative
  tool: coarse ? 'pan' : 'select',
  dialog: null,
  toastMsg: null,
  circuitName: init.name,
  editing: init.editing,
  panel: null,

  bump: () => set((s) => ({ ver: s.ver + 1 })),
  beginTx: () => set((s) => ({ past: [...s.past.slice(-99), s.circuit], future: [] })),
  update: (fn) => set((s) => ({ circuit: fn(s.circuit) })),
  commit: (fn) => { get().beginTx(); get().update(fn); },
  setSel: (sel) => set({ sel }),
  setView: (view) => set({ view }),
  patch: (p) => set(p as any),
  toast: (m) => {
    set({ toastMsg: m });
    setTimeout(() => { if (get().toastMsg === m) set({ toastMsg: null }); }, 2600);
  },

  addComp: (type, x, y, props) => {
    const { circuit, editing } = get();
    if (type === 'ic') {
      // an IC may not (transitively) contain itself: refuse instances of any def whose editor is open
      for (let e = editing; e; e = e.parent) {
        if (containsDef(circuit.defs, props?.def, e.defId)) {
          get().toast("That IC can't be placed inside itself — it would contain itself.");
          return '';
        }
      }
    }
    const id = uid('c');
    get().commit((c) => ({ ...c, comps: [...c.comps, newComp(type, snap(x), snap(y), props, c.comps, id)] }));
    set({ sel: { comps: [id], wires: [] } });
    return id;
  },
  setProp: (id, patch, history = true) => {
    const f = (c: Circuit) => prune({ ...c, comps: c.comps.map((x) => (x.id === id ? { ...x, props: { ...x.props, ...patch } } : x)) });
    if (history) get().commit(f); else get().update(f);
  },
  setName: (id, name) => get().update((c) => ({ ...c, comps: c.comps.map((x) => (x.id === id ? { ...x, name } : x)) })),
  rotate: () => {
    const ids = new Set(get().sel.comps);
    if (!ids.size) return;
    get().commit((c) => ({ ...c, comps: c.comps.map((x) => (ids.has(x.id) ? { ...x, rot: (x.rot + 1) % 4 } : x)) }));
  },
  deleteSel: () => {
    const { sel } = get();
    if (!sel.comps.length && !sel.wires.length) return;
    const ids = new Set(sel.comps), ws = new Set(sel.wires);
    get().commit((c) => ({
      ...c,
      comps: c.comps.filter((x) => !ids.has(x.id)),
      wires: c.wires.filter((w) => !ws.has(w.id) && !ids.has(w.from.c) && !ids.has(w.to.c)),
      probes: c.probes.filter((p) => !ids.has(p.comp)),
    }));
    set({ sel: { comps: [], wires: [] } });
  },
  addWire: (from, to) => {
    const c = get().circuit;
    if (from.c === to.c && from.p === to.p) return;
    if (c.wires.some((w) => w.from.c === from.c && w.from.p === from.p && w.to.c === to.c && w.to.p === to.p)) return;
    get().commit((c) => ({
      ...c,
      wires: [...c.wires.filter((w) => !(w.to.c === to.c && w.to.p === to.p)), { id: uid('w'), from, to }],
    }));
  },
  setWireLabel: (id, label) => get().update((c) => ({ ...c, wires: c.wires.map((w) => (w.id === id ? { ...w, label } : w)) })),

  undo: () => {
    const { past, circuit, future } = get();
    if (!past.length) return;
    set({ circuit: past[past.length - 1], past: past.slice(0, -1), future: [circuit, ...future], sel: { comps: [], wires: [] } });
  },
  redo: () => {
    const { past, circuit, future } = get();
    if (!future.length) return;
    set({ circuit: future[0], future: future.slice(1), past: [...past, circuit], sel: { comps: [], wires: [] } });
  },
  copy: () => {
    const { sel, circuit } = get();
    if (!sel.comps.length) return;
    const ids = new Set(sel.comps);
    set({
      clip: {
        comps: circuit.comps.filter((x) => ids.has(x.id)),
        wires: circuit.wires.filter((w) => ids.has(w.from.c) && ids.has(w.to.c)),
        n: 0,
      },
    });
    get().toast(`Copied ${sel.comps.length} component(s)`);
  },
  cut: () => { get().copy(); get().deleteSel(); },
  paste: () => {
    const { clip } = get();
    if (!clip || !clip.comps.length) return;
    const off = 40 * (clip.n + 1);
    const map: Record<string, string> = {};
    const comps = clip.comps.map((x) => { const id = uid('c'); map[x.id] = id; return { ...x, id, x: x.x + off, y: x.y + off, props: JSON.parse(JSON.stringify(x.props)) }; });
    const wires = clip.wires.map((w) => ({ ...w, id: uid('w'), from: { ...w.from, c: map[w.from.c] }, to: { ...w.to, c: map[w.to.c] } }));
    get().commit((c) => ({ ...c, comps: [...c.comps, ...comps], wires: [...c.wires, ...wires] }));
    set({ sel: { comps: comps.map((x) => x.id), wires: [] }, clip: { ...clip, n: clip.n + 1 } });
  },
  selectAll: () => set((s) => ({ sel: { comps: s.circuit.comps.map((x) => x.id), wires: s.circuit.wires.map((w) => w.id) } })),

  loadCircuit: (c, name) => {
    // close any open IC editor first so its edits are kept and undo returns to the real circuit
    while (get().editing) get().exitEdit();
    get().beginTx();
    set({ circuit: normalize(c), sel: { comps: [], wires: [] }, circuitName: name ?? get().circuitName, editing: null });
    engine.reset();
    get().fit();
  },
  newCircuit: () => get().loadCircuit(emptyCircuit(), 'Untitled'),
  fit: () => {
    const { circuit, viewSize } = get();
    if (!circuit.comps.length) { set({ view: { x: 40, y: 40, k: 1 } }); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of circuit.comps) {
      const b = bbox(c, layoutOf(c, circuit.defs));
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    }
    const pad = 60;
    const k = Math.max(MIN_ZOOM, Math.min(1.5, Math.min(viewSize.w / (x1 - x0 + 2 * pad), viewSize.h / (y1 - y0 + 2 * pad))));
    set({ view: { k, x: (viewSize.w - (x1 - x0) * k) / 2 - x0 * k, y: (viewSize.h - (y1 - y0) * k) / 2 - y0 * k } });
  },
  zoomBy: (f) => {
    const { view, viewSize } = get();
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.k * f));
    const cx = viewSize.w / 2, cy = viewSize.h / 2;
    set({ view: { k, x: cx - (cx - view.x) * (k / view.k), y: cy - (cy - view.y) * (k / view.k) } });
  },
  pack: (name) => {
    const { circuit, sel } = get();
    const r = packageSelection(circuit, sel.comps, name);
    if (!r.circuit) { get().toast(r.error ?? 'Could not package'); return false; }
    get().commit(() => r.circuit!);
    const ic = r.circuit.comps[r.circuit.comps.length - 1];
    set({ sel: { comps: [ic.id], wires: [] } });
    get().toast(`Created IC "${name}" — it is now in the palette under Custom ICs`);
    return true;
  },
  breakdown: () => {
    const { circuit, sel } = get();
    const r = breakDown(circuit, sel.comps);
    if (r.error || !r.circuit) { get().toast(r.error ?? 'Could not break down'); return false; }
    get().commit(() => r.circuit!);
    // the originals are gone: select what replaced them so the block can be moved as one
    set({ sel: { comps: r.placed, wires: [] } });
    const n = r.broken.length;
    get().toast(n === 1 ? `Broke ${r.broken[0]} into ${r.total} component${r.total === 1 ? '' : 's'} — its internals are now on the canvas` : `Broke ${n} components into ${r.total} components`);
    return true;
  },
  editInternals: (id) => {
    const { circuit, sel } = get();
    const cid = id ?? (sel.comps.length === 1 ? sel.comps[0] : '');
    const comp = circuit.comps.find((x) => x.id === cid);
    if (!comp || !isBreakable(comp, circuit.defs)) { get().toast('Select a single IC or complex part to edit its internals.'); return false; }
    if (comp.type === 'ic') { get().enterEdit(comp.props.def); return true; }
    // a built-in part becomes a custom IC (undoable), then its new definition opens in the editor
    const r = customize(circuit, comp.id);
    if (!r.circuit || !r.defId) { get().toast(r.error ?? 'Could not convert'); return false; }
    get().commit(() => r.circuit!);
    get().enterEdit(r.defId);
    get().toast(`"${r.name}" is now a custom IC — edit its gates here, then press Done`);
    return true;
  },
  addProbe: (comp, pin, kind, label) => {
    const c = get().circuit;
    if (c.probes.some((p) => p.comp === comp && p.pin === pin && p.kind === kind)) return;
    get().update((c) => ({ ...c, probes: [...c.probes, { id: uid('p'), comp, pin, kind, label }] }));
    set({ showWave: true });
  },
  removeProbe: (id) => get().update((c) => ({ ...c, probes: c.probes.filter((p) => p.id !== id) })),
  setProbes: (probes) => get().update((c) => ({ ...c, probes })),
  setMode: (m) => {
    engine.setMode(m);
    set({ mode: m });
    get().bump();
  },

  enterEdit: (defId) => {
    const { circuit, circuitName, editing, past, future } = get();
    const def = circuit.defs[defId];
    if (!def) return;
    for (let e = editing; e; e = e.parent) {
      if (e.defId === defId) { get().toast('That IC is already open in the editor.'); return; }
    }
    // entering/leaving the editor is a mode switch, not an undoable edit: the outer history is stashed and restored
    set({
      past: [],
      future: [],
      editing: { defId, saved: circuit, savedName: circuitName, savedPast: past, savedFuture: future, parent: editing },
      circuit: { comps: def.comps, wires: def.wires, defs: circuit.defs, probes: [] },
      sel: { comps: [], wires: [] },
      circuitName: def.name,
    });
    get().fit();
  },
  exitEdit: () => {
    const { editing, circuit } = get();
    if (!editing) return;
    // base on circuit.defs (not the stale saved map) so defs created while editing survive
    const def = circuit.defs[editing.defId] ?? editing.saved.defs[editing.defId];
    const defs = def ? { ...circuit.defs, [editing.defId]: { ...def, comps: circuit.comps, wires: circuit.wires } } : circuit.defs;
    // everything done inside the editor is one undo step for the level above (tapping a switch is not an edit)
    const changed = !def || get().past.length > 0 || circuit.defs !== editing.saved.defs;
    set({
      past: changed ? [...editing.savedPast.slice(-99), editing.saved] : editing.savedPast,
      future: changed ? [] : editing.savedFuture,
      editing: editing.parent,
      circuit: { ...editing.saved, defs },
      circuitName: editing.savedName,
      sel: { comps: [], wires: [] },
    });
    get().fit();
  },
  };
});

// keep the simulation engine in sync with the circuit
engine.sync(useStore.getState().circuit);
let saveTimer: any;
let lastTruncated = false;
useStore.subscribe((s, p) => {
  if (s.circuit !== p.circuit) {
    if (engine.sync(s.circuit)) {
      useStore.setState((st) => ({ ver: st.ver + 1, struct: st.struct + 1 }));
      if (engine.truncated && !lastTruncated) {
        lastTruncated = true;
        useStore.getState().toast('Warning: custom ICs nested more than 8 levels deep are not simulated.');
      } else if (!engine.truncated) lastTruncated = false;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const st = useStore.getState();
        const payload = st.editing
          ? { main: foldParents(st.circuit, st.editing), mainName: rootOf(st.editing).savedName, edit: { defId: st.editing.defId, circuit: { comps: st.circuit.comps, wires: st.circuit.wires } } }
          : { ...s.circuit, name: st.circuitName };
        localStorage.setItem('lds.autosave', JSON.stringify(payload));
      } catch { /* quota */ }
    }, 500);
  }
  if (s.theme !== p.theme) localStorage.setItem('lds.theme', s.theme);
});

let acc = 0;
export function simFrame(dtMs: number) {
  const s = useStore.getState();
  if (!s.running) { acc = 0; return; }
  const stamp0 = engine.stamp;
  if (s.mode === 'instant') {
    engine.advance((dtMs / 1000) * s.scale);
  } else {
    acc += (dtMs / 1000) * s.tps;
    const n = Math.min(Math.floor(acc), 60);
    acc -= Math.floor(acc);
    for (let i = 0; i < n; i++) engine.tick();
  }
  if (engine.stamp !== stamp0) s.bump(); // only re-render when simulation state actually changed
}

export function simStep(full: boolean) {
  if (full) engine.fullStep(); else engine.halfStep();
  useStore.getState().bump();
}
export function simReset() {
  engine.reset();
  useStore.getState().bump();
}
