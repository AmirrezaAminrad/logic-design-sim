import type { Circuit, Comp, ICDef, ICPinDef, Wire } from './types';
import { uid } from './types';
import { TYPES, pinsOf } from './defs';
import { snap } from './geometry';

interface PinSpec { pinId: string; label: string; w: number; y: number; ext?: Wire; extWires?: Wire[] }

/**
 * Packages the selected components into a reusable custom IC.
 * - Toggle switches / push buttons / number inputs become IC input pins
 * - LEDs / hex displays become IC output pins
 * - Any other unconnected input pin (or pin fed from outside the selection) becomes an IC input
 * - Any output pin feeding outside the selection (or left dangling) becomes an IC output
 */
export function packageSelection(c: Circuit, ids: string[], name: string): { circuit?: Circuit; def?: ICDef; error?: string } {
  const sel = new Set(ids);
  const comps = c.comps.filter((x) => sel.has(x.id) && x.type !== 'pin_in' && x.type !== 'pin_out');
  if (!comps.length) return { error: 'Select the components you want to package first.' };
  const set = new Set(comps.map((x) => x.id));
  const innerWires: Wire[] = c.wires.filter((w) => set.has(w.from.c) && set.has(w.to.c)).map((w) => ({ ...w }));
  const innerComps: Comp[] = [];
  const inputs: PinSpec[] = [];
  const outputs: PinSpec[] = [];

  for (const comp of comps) {
    const { ins, outs } = pinsOf(comp, c.defs);
    const t = TYPES[comp.type];
    if (['switch', 'button', 'numin'].includes(comp.type)) {
      inputs.push({ pinId: comp.id, label: comp.name || 'IN', w: outs[0].w, y: comp.y });
      innerComps.push({ ...comp, type: 'pin_in', props: { w: outs[0].w } });
      continue;
    }
    if (comp.type === 'led' || comp.type === 'hexdisp') {
      outputs.push({ pinId: comp.id, label: comp.name || 'OUT', w: ins[0].w, y: comp.y, extWires: [] });
      innerComps.push({ ...comp, type: 'pin_out', props: { w: ins[0].w } });
      continue;
    }
    innerComps.push({ ...comp, props: { ...comp.props } });
    if (t?.sink) continue;
    ins.forEach((p, k) => {
      if (innerWires.some((w) => w.to.c === comp.id && w.to.p === k)) return;
      const ext = c.wires.find((w) => w.to.c === comp.id && w.to.p === k && !set.has(w.from.c));
      if (!ext && p.def !== undefined) return;
      const pid = uid('pi');
      innerComps.push({ id: pid, type: 'pin_in', x: comp.x - 60, y: comp.y + k * 20, rot: 0, name: '', props: { w: p.w } });
      innerWires.push({ id: uid('w'), from: { c: pid, p: 0 }, to: { c: comp.id, p: k } });
      inputs.push({ pinId: pid, label: p.name, w: p.w, y: comp.y + k * 0.1, ext });
    });
    if (comp.type === 'clock' || comp.type === 'const') {
      if (!c.wires.some((w) => w.from.c === comp.id && !set.has(w.to.c))) continue;
    }
    outs.forEach((p, k) => {
      const fromHere = c.wires.filter((w) => w.from.c === comp.id && w.from.p === k);
      const ext = fromHere.filter((w) => !set.has(w.to.c));
      if (ext.length === 0 && fromHere.length > 0) return;
      if (comp.type === 'clock' || comp.type === 'const') { if (ext.length === 0) return; }
      const pid = uid('po');
      innerComps.push({ id: pid, type: 'pin_out', x: comp.x + 200, y: comp.y + k * 20, rot: 0, name: '', props: { w: p.w } });
      innerWires.push({ id: uid('w'), from: { c: comp.id, p: k }, to: { c: pid, p: 0 } });
      outputs.push({ pinId: pid, label: p.name, w: p.w, y: comp.y + k * 0.1, extWires: ext });
    });
  }
  if (!inputs.length && !outputs.length) return { error: 'The selection has no inputs or outputs to expose.' };

  const dedupe = (list: PinSpec[]): ICPinDef[] => {
    const seen: Record<string, number> = {};
    return list.sort((a, b) => a.y - b.y).map((s) => {
      const n = (seen[s.label] = (seen[s.label] ?? 0) + 1);
      return { id: s.pinId, label: n > 1 ? s.label + n : s.label, w: s.w };
    });
  };
  const sortedIn = [...inputs].sort((a, b) => a.y - b.y);
  const sortedOut = [...outputs].sort((a, b) => a.y - b.y);
  const def: ICDef = { id: uid('ic'), name: name || 'IC', comps: innerComps, wires: innerWires, inputs: dedupe(inputs), outputs: dedupe(outputs) };

  const ic: Comp = {
    id: uid('c'), type: 'ic', name: '', rot: 0, props: { def: def.id },
    x: snap(Math.min(...comps.map((x) => x.x))), y: snap(Math.min(...comps.map((x) => x.y))),
  };
  const newWires: Wire[] = c.wires.filter((w) => !set.has(w.from.c) && !set.has(w.to.c));
  sortedIn.forEach((s, k) => { if (s.ext) newWires.push({ id: uid('w'), from: s.ext.from, to: { c: ic.id, p: k } }); });
  sortedOut.forEach((s, k) => (s.extWires ?? []).forEach((w) => newWires.push({ id: uid('w'), from: { c: ic.id, p: k }, to: w.to })));
  const circuit: Circuit = {
    comps: [...c.comps.filter((x) => !set.has(x.id)), ic],
    wires: newWires,
    defs: { ...c.defs, [def.id]: def },
    probes: c.probes.filter((p) => !set.has(p.comp)),
  };
  return { circuit, def };
}
