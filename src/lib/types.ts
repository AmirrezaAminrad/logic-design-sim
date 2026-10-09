export interface Pin {
  name: string;
  w: number;
  def?: number; // value when unconnected
}

export interface Comp {
  id: string;
  type: string;
  x: number;
  y: number;
  rot: number; // 0..3 (x90deg clockwise)
  name: string;
  props: Record<string, any>;
}

export interface Wire {
  id: string;
  from: { c: string; p: number };
  to: { c: string; p: number };
  label?: string;
}

export interface ICPinDef {
  id: string; // id of the pin_in / pin_out component inside the def
  label: string;
  w: number;
}

export interface ICDef {
  id: string;
  name: string;
  comps: Comp[];
  wires: Wire[];
  inputs: ICPinDef[];
  outputs: ICPinDef[];
  /** auto-generated (e.g. by "break down to gates"): hidden from the palette's Custom ICs list */
  auto?: boolean;
}

export interface Probe {
  id: string;
  comp: string;
  pin: number;
  kind: 'out' | 'in';
  label: string;
}

export interface Circuit {
  comps: Comp[];
  wires: Wire[];
  defs: Record<string, ICDef>;
  probes: Probe[];
}

export const emptyCircuit = (): Circuit => ({ comps: [], wires: [], defs: {}, probes: [] });

let counter = 0;
export const uid = (p = 'c') => p + Date.now().toString(36).slice(-4) + (counter++).toString(36) + Math.random().toString(36).slice(2, 5);
