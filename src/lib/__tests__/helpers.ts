import { Engine } from '../engine';
import { newComp, pinsOf } from '../defs';
import type { Circuit, Comp, ICDef, Pin, Wire } from '../types';

/** Minimal circuit builder for engine tests (mirrors the one in templates.ts). */
export class TB {
  comps: Comp[] = [];
  wires: Wire[] = [];
  defs: Record<string, ICDef> = {};
  add(type: string, x = 0, y = 0, props: Record<string, any> = {}, name = ''): string {
    const id = 't' + this.comps.length + '_' + type;
    const c = newComp(type, x, y, props, this.comps, id);
    c.name = name;
    this.comps.push(c);
    return id;
  }
  addDef(def: ICDef): string {
    this.defs[def.id] = def;
    return this.add('ic', 0, 0, { def: def.id });
  }
  w(a: string, ap: string | number, b: string, bp: string | number) {
    const find = (key: string) => this.comps.find((c) => c.id === key || (c.name && c.name === key));
    const ca = find(a)!; const cb = find(b)!;
    if (!ca || !cb) throw new Error(`wiring error: cannot find "${a}" or "${b}"`);
    const ai = typeof ap === 'number' ? ap : pinsOf(ca, this.defs).outs.findIndex((p) => p.name === ap);
    const bi = typeof bp === 'number' ? bp : pinsOf(cb, this.defs).ins.findIndex((p) => p.name === bp);
    if (ai < 0 || bi < 0) throw new Error(`wiring error: ${ca.type}.${ap} -> ${cb.type}.${bp}`);
    this.wires.push({ id: 'w' + this.wires.length, from: { c: ca.id, p: ai }, to: { c: cb.id, p: bi } });
  }
  circuit(): Circuit {
    return { comps: this.comps, wires: this.wires, defs: this.defs, probes: [] };
  }
}

/** Build an Engine over a circuit; returns helpers addressing components by name or id. */
export function mk(c: Circuit) {
  const e = new Engine();
  e.sync(c);
  const byName = new Map<string, Comp>();
  for (const x of c.comps) if (x.name) byName.set(x.name, x);
  const find = (key: string) => {
    const comp = byName.get(key) ?? c.comps.find((x) => x.id === key);
    if (!comp) throw new Error('no comp named ' + key);
    return comp;
  };
  const out = (key: string, pin = 0) => e.outOf(find(key).id, pin);
  const setIn = (key: string, v: number) => {
    find(key).props.value = v;
    e.sync(c); // same path as the app: prop changes flow through sync (rebuild preserves state)
  };
  return { e, out, setIn, byName };
}

export const pinOf = (c: Comp, defs: Record<string, ICDef>, kind: 'ins' | 'outs', name: string): Pin | undefined =>
  pinsOf(c, defs)[kind].find((p) => p.name === name);
