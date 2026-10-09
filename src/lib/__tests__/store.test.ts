import { beforeEach, describe, expect, it, vi } from 'vitest';

// store.ts touches localStorage at module scope; provide a minimal stub before it imports.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => void mem.clear(),
  };
});

import { useStore } from '../store';
import { engine } from '../engine';
import { TEMPLATES } from '../templates';

describe('selection', () => {
  beforeEach(() => {
    useStore.getState().loadCircuit(TEMPLATES.find((t) => t.id === 'add4')!.build(), 'select-all test');
  });
  it('select all takes every component and every wire (Ctrl+A)', () => {
    useStore.getState().selectAll();
    const s = useStore.getState();
    expect(s.sel.comps).toHaveLength(s.circuit.comps.length);
    expect(s.sel.comps.length).toBeGreaterThan(1);
    expect(s.sel.wires).toHaveLength(s.circuit.wires.length);
    expect(s.sel.wires.length).toBeGreaterThan(1);
  });
  it('a select-all selection copies with its wiring intact', () => {
    useStore.getState().selectAll();
    useStore.getState().copy();
    const clip = useStore.getState().clip!;
    expect(clip.comps).toHaveLength(useStore.getState().circuit.comps.length);
    expect(clip.wires).toHaveLength(useStore.getState().circuit.wires.length);
  });
});


const mkAdder = (): any => ({
  comps: [
    { id: 'a1', type: 'numin', x: 0, y: 0, rot: 0, name: 'A', props: { w: 4, value: 3 } },
    { id: 'a2', type: 'numin', x: 0, y: 100, rot: 0, name: 'B', props: { w: 4, value: 2 } },
    { id: 'ad', type: 'adder', x: 300, y: 0, rot: 0, name: '', props: { w: 4 } },
    { id: 'hx', type: 'hexdisp', x: 1400, y: 0, rot: 0, name: 'S', props: { w: 4 } },
  ],
  wires: [
    { id: 'w1', from: { c: 'a1', p: 0 }, to: { c: 'ad', p: 0 } },
    { id: 'w2', from: { c: 'a2', p: 0 }, to: { c: 'ad', p: 1 } },
    { id: 'w3', from: { c: 'ad', p: 0 }, to: { c: 'hx', p: 0 } },
  ],
  defs: {},
  probes: [],
});
const st = () => useStore.getState();
const select = (...ids: string[]) => useStore.setState({ sel: { comps: ids, wires: [] } });

describe('break down (store)', () => {
  beforeEach(() => { st().loadCircuit(mkAdder(), 'breakdown test'); });

  it('puts the internals on the canvas in one undoable step and selects them', () => {
    select('ad');
    expect(st().breakdown()).toBe(true);
    const c = st().circuit;
    expect(c.comps.some((x) => x.id === 'ad')).toBe(false);
    expect(c.comps.some((x) => x.type === 'fulladder')).toBe(true);
    expect(c.comps.some((x) => x.type === 'ic')).toBe(false);
    expect(Object.keys(c.defs)).toHaveLength(0);
    expect(st().sel.comps.length).toBeGreaterThan(1);
    expect(st().sel.comps.every((id) => c.comps.some((x) => x.id === id))).toBe(true);
    st().undo();
    expect(st().circuit.comps.find((x) => x.id === 'ad')!.type).toBe('adder');
    expect(st().circuit.wires).toHaveLength(3);
  });

  it('refuses primitive parts without touching the circuit', () => {
    select('a1');
    const before = st().circuit;
    expect(st().breakdown()).toBe(false);
    expect(st().circuit).toBe(before);
  });
});

describe('edit IC internals (store)', () => {
  beforeEach(() => { st().loadCircuit(mkAdder(), 'edit test'); });

  it('turns a built-in part into a custom IC and opens it in the editor', () => {
    select('ad');
    expect(st().editInternals()).toBe(true);
    const s1 = st();
    expect(s1.editing).toBeTruthy();
    expect(s1.circuitName).toMatch(/custom/);
    expect(s1.circuit.comps.some((x) => x.type === 'fulladder')).toBe(true);
    expect(s1.editing!.saved.comps.find((x) => x.id === 'ad')!.type).toBe('ic');
    st().exitEdit();
    const s2 = st();
    expect(s2.editing).toBeNull();
    const ic = s2.circuit.comps.find((x) => x.id === 'ad')!;
    expect(ic.type).toBe('ic');
    expect(s2.circuit.defs[ic.props.def].name).toMatch(/custom/);
    // converting was one undoable step, still available after leaving the editor
    st().undo();
    expect(st().circuit.comps.find((x) => x.id === 'ad')!.type).toBe('adder');
    expect(Object.keys(st().circuit.defs)).toHaveLength(0);
  });

  it('edits made inside the editor are one undo step for the circuit above', () => {
    select('ad');
    st().editInternals();
    const before = st().circuit.comps.length;
    st().commit((c) => ({ ...c, comps: c.comps.filter((x) => x.type !== 'fulladder') }));
    expect(st().circuit.comps.length).toBeLessThan(before);
    st().exitEdit();
    const defId = st().circuit.comps.find((x) => x.id === 'ad')!.props.def;
    expect(st().circuit.defs[defId].comps.some((x) => x.type === 'fulladder')).toBe(false);
    st().undo(); // back to the circuit as it was before the editor was opened (still a custom IC, original internals)
    expect(st().circuit.defs[defId].comps.some((x) => x.type === 'fulladder')).toBe(true);
    expect(st().circuit.comps.find((x) => x.id === 'ad')!.type).toBe('ic');
  });

  it('the simulation follows the definition when an editing session is undone', () => {
    select('ad');
    st().editInternals();
    st().commit((c) => ({ ...c, comps: c.comps.filter((x) => x.type !== 'fulladder') }));
    st().exitEdit();
    const adder = () => { const id = st().circuit.comps.find((x) => x.id === 'ad')!.id; return { id, sum: engine.outOf(id, 0) }; };
    // the full adders were deleted, so the converted adder no longer adds
    expect(adder().sum).not.toBe(5);
    st().undo(); // restores the original definition (same def ids, same wires — only the def contents differ)
    expect(adder().sum).toBe(5); // 3 + 2 — the engine must have been rebuilt from the restored definition
    st().redo();
    expect(adder().sum).not.toBe(5);
  });

  it('opening a custom IC does not offer to convert anything; refuses primitive parts', () => {
    select('a1');
    expect(st().editInternals()).toBe(false);
    expect(st().editing).toBeNull();
  });

  it('nested sessions: the outer circuit survives editing an IC inside an IC', () => {
    select('ad');
    st().editInternals(); // level 1: the adder's gates (4 full adders inside)
    const fa = st().circuit.comps.find((x) => x.type === 'fulladder')!;
    expect(st().editInternals(fa.id)).toBe(true); // level 2: a full adder's gates
    expect(st().editing!.parent).toBeTruthy();
    // change something in level 2 so we can see it propagate
    const inner = st().circuit.comps.length;
    st().commit((c) => ({ ...c, comps: c.comps.filter((x) => x.type !== 'or') }));
    expect(st().circuit.comps.length).toBeLessThan(inner);
    st().exitEdit(); // back in level 1, NOT in the main circuit
    expect(st().editing).toBeTruthy();
    expect(st().circuit.comps.filter((x) => x.type === 'ic').length).toBe(1); // the converted full adder
    expect(st().circuit.comps.filter((x) => x.type === 'fulladder').length).toBe(3);
    st().exitEdit(); // back in the main circuit
    expect(st().editing).toBeNull();
    expect(st().circuitName).toBe('edit test');
    expect(st().circuit.comps.map((x) => x.id)).toContain('hx');
    const defs = st().circuit.defs;
    const l1 = defs[st().circuit.comps.find((x) => x.id === 'ad')!.props.def];
    const l2Id = l1.comps.find((x) => x.type === 'ic')!.props.def;
    expect(defs[l2Id].comps.some((x) => x.type === 'or')).toBe(false);
  });

  it('autosave keeps an in-progress nested session recoverable', async () => {
    select('ad');
    st().editInternals();
    const fa = st().circuit.comps.find((x) => x.type === 'fulladder')!;
    st().editInternals(fa.id);
    await new Promise((r) => setTimeout(r, 700)); // autosave is debounced
    const saved = JSON.parse(localStorage.getItem('lds.autosave')!);
    expect(saved.edit.defId).toBe(st().editing!.defId);
    expect(saved.main.comps.map((x: any) => x.id)).toContain('hx');
    // the folded main circuit carries the level-1 def with its converted child
    const l1 = saved.main.defs[saved.main.comps.find((x: any) => x.id === 'ad').props.def];
    expect(l1.comps.some((x: any) => x.type === 'ic')).toBe(true);
  });

  it('loading another circuit while the editor is open keeps the edits and leaves the editor', () => {
    select('ad');
    st().editInternals();
    st().loadCircuit(mkAdder(), 'other');
    expect(st().editing).toBeNull();
    expect(st().circuitName).toBe('other');
    st().undo(); // returns to the circuit that was open before — not to a def's internals shown as the main circuit
    expect(st().circuit.comps.map((x) => x.id)).toContain('hx');
    expect(st().circuit.comps.find((x) => x.id === 'ad')!.type).toBe('ic');
  });

  it('an IC cannot be placed inside itself (directly or through another IC)', () => {
    select('ad');
    st().editInternals();
    const defId = st().editing!.defId;
    const n = st().circuit.comps.length;
    expect(st().addComp('ic', 0, 0, { def: defId })).toBe('');
    expect(st().circuit.comps).toHaveLength(n);
    expect(st().toastMsg).toMatch(/itself/);
  });

  it('inlining an IC from inside the editor works on the def being edited', () => {
    select('ad');
    st().editInternals();
    const fa = st().circuit.comps.filter((x) => x.type === 'fulladder').map((x) => x.id);
    select(...fa);
    expect(st().breakdown()).toBe(true);
    expect(st().circuit.comps.some((x) => x.type === 'fulladder')).toBe(false);
    st().exitEdit();
    const defId = st().circuit.comps.find((x) => x.id === 'ad')!.props.def;
    expect(st().circuit.defs[defId].comps.some((x) => x.type === 'fulladder')).toBe(false);
    expect(st().circuit.defs[defId].comps.some((x) => x.type === 'xor')).toBe(true);
  });
});
