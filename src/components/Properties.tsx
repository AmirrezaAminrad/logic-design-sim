import { useEffect, useState } from 'react';
import { Copy, Package, RotateCw, Table2, Trash2, Activity, Info, Network, SquarePen, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { CAT_COLOR, GATE_COLOR, TYPES, hex, mask, pinsOf } from '../lib/defs';
import type { PropSpec } from '../lib/defs';
import { engine } from '../lib/engine';
import { isBreakable } from '../lib/breakdown';

function NumField({ spec, value, onChange }: { spec: PropSpec; value: number; onChange: (v: number) => void }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  return (
    <input
      type="number" className="field" value={txt} min={spec.min} max={spec.max} step={spec.step ?? 1}
      onChange={(e) => {
        setTxt(e.target.value);
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(Math.max(spec.min ?? -Infinity, Math.min(spec.max ?? Infinity, v)));
      }}
      onBlur={() => setTxt(String(value))}
    />
  );
}

function RomEditor({ id, a, w, data }: { id: string; a: number; w: number; data: number[] }) {
  const digits = Math.ceil(w / 4);
  const fmt = () => Array.from({ length: 1 << a }, (_, i) => (data[i] ?? 0).toString(16).toUpperCase().padStart(digits, '0')).join(' ');
  const [txt, setTxt] = useState(fmt());
  useEffect(() => setTxt(fmt()), [data, a, w]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <div className="label">Contents (hex words, address 0 first)</div>
      <textarea
        className="field font-mono text-[11px] h-28 resize-y" value={txt} spellCheck={false}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => {
          const vals = txt.split(/[\s,]+/).filter(Boolean).map((t) => parseInt(t, 16) & mask(w)).map((v) => (isNaN(v) ? 0 : v));
          useStore.getState().setProp(id, { data: vals.slice(0, 1 << a) });
        }}
      />
    </div>
  );
}

export default function Properties() {
  const circuit = useStore((s) => s.circuit);
  const sel = useStore((s) => s.sel);
  const showCrit = useStore((s) => s.showCrit);
  const editing = useStore((s) => s.editing);
  useStore((s) => s.ver);
  const st = useStore.getState();

  const comps = circuit.comps.filter((c) => sel.comps.includes(c.id));
  const wire = circuit.wires.find((w) => sel.wires[0] === w.id);

  const header = (title: string, color: string) => (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-3 h-3 rounded-sm" style={{ background: color }} />
      <div className="font-semibold text-sm">{title}</div>
    </div>
  );

  const actions = (multi: boolean, isIC = false) => {
    const breakN = comps.filter((c) => isBreakable(c, circuit.defs)).length;
    const canEdit = comps.length === 1 && breakN === 1;
    return (
      <div className="grid grid-cols-2 gap-1.5 mt-3">
        <button className="btn" onClick={() => st.rotate()}><RotateCw size={13} /> Rotate</button>
        <button className="btn" onClick={() => { st.copy(); st.paste(); }}><Copy size={13} /> Duplicate</button>
        <button className="btn" onClick={() => st.patch({ dialog: 'tt' })}><Table2 size={13} /> Truth table</button>
        {breakN > 0 && (
          <button className="btn" title="Delete this part and put its internals on the canvas (B)" onClick={() => st.breakdown()}>
            <Network size={13} /> Break down{breakN > 1 ? ` ${breakN}` : ''}
          </button>
        )}
        {canEdit && (
          <button className={`btn ${isIC ? 'col-span-2' : ''}`} title="Open the internals for editing (E)" onClick={() => st.editInternals()}>
            <SquarePen size={13} /> Edit IC internals
          </button>
        )}
        {!isIC && <button className="btn" disabled={!!editing} onClick={() => st.patch({ dialog: 'pkg' })}><Package size={13} /> Package IC</button>}
        <button className="btn col-span-2 danger" onClick={() => st.deleteSel()}><Trash2 size={13} /> Delete{multi ? ` ${comps.length} items` : ''}</button>
      </div>
    );
  };

  let content: React.ReactNode;
  if (comps.length === 1) {
    const c = comps[0];
    const t = TYPES[c.type];
    const { ins, outs } = pinsOf(c, circuit.defs);
    const color = GATE_COLOR[c.type] ?? CAT_COLOR[t?.cat ?? 'custom'];
    const title = c.type === 'ic' ? `IC · ${circuit.defs[c.props.def]?.name}` : t?.label;
    content = (
      <>
        {header(title ?? c.type, color)}
        {t && <p className="text-[11px] leading-snug mb-3" style={{ color: 'var(--muted)' }}>{t.desc}</p>}
        {t && isBreakable(c) && <p className="text-[11px] leading-snug mb-3 -mt-1" style={{ color: 'var(--muted)' }}><b>Break down</b> swaps it for its gate-level parts; <b>Edit IC internals</b> turns it into a custom IC you can edit.</p>}
        <div className="label">Name / label</div>
        <input className="field" value={c.name} placeholder="e.g. A, CLK, Sum…" onFocus={() => st.beginTx()} onChange={(e) => st.setName(c.id, e.target.value)} />
        {t?.props?.map((spec) => (
          <div key={spec.key} className="mt-2.5">
            <div className="label">{spec.label}</div>
            {spec.type === 'number' && <NumField spec={spec} value={c.props[spec.key]} onChange={(v) => st.setProp(c.id, { [spec.key]: v })} />}
            {spec.type === 'select' && (
              <select className="field" value={c.props[spec.key]} onChange={(e) => st.setProp(c.id, { [spec.key]: e.target.value })}>
                {spec.options!.map((o) => <option key={String(o.v)} value={o.v}>{o.l}</option>)}
              </select>
            )}
          </div>
        ))}
        {c.type === 'rom' && <div className="mt-2.5"><RomEditor id={c.id} a={c.props.a} w={c.props.w} data={c.props.data ?? []} /></div>}
        {c.type === 'ic' && (
          <div className="mt-3 text-[11px] leading-snug p-2 rounded-md" style={{ background: 'var(--input)', color: 'var(--muted)' }}>
            Instance of a custom IC ({circuit.defs[c.props.def]?.comps.filter((x) => x.type !== 'pin_in' && x.type !== 'pin_out').length ?? '?'} internal parts). Double-click it on the canvas (or use <b>Edit IC internals</b>) to modify the shared definition, or <b>Break down</b> to replace this one instance by its internals.
          </div>
        )}
        {(ins.length > 0 || outs.length > 0) && (
          <div className="mt-3">
            <div className="label flex items-center gap-1"><Activity size={11} /> Add to waveform</div>
            <div className="flex flex-wrap gap-1">
              {outs.map((p, k) => (
                <button key={'o' + k} className="chip" title={`Probe output ${p.name}`}
                  onClick={() => st.addProbe(c.id, k, 'out', `${c.name || t?.label || 'IC'}${outs.length > 1 ? '.' + p.name : ''}`)}>
                  {p.name}{p.w > 1 ? `[${p.w}]` : ''} <span className="opacity-60">out</span>
                </button>
              ))}
              {outs.length === 0 && ins.slice(0, 8).map((p, k) => (
                <button key={'i' + k} className="chip" onClick={() => st.addProbe(c.id, k, 'in', `${c.name || t?.label}${ins.length > 1 ? '.' + p.name : ''}`)}>
                  {p.name} <span className="opacity-60">in</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {actions(false, c.type === 'ic')}
      </>
    );
  } else if (comps.length > 1) {
    content = (
      <>
        {header(`${comps.length} components selected`, '#facc15')}
        <p className="text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>
          Generate a <b>truth table</b> for this sub-circuit, or <b>package</b> it into a reusable IC with inputs/outputs derived from the switches, LEDs and any unconnected pins.
        </p>
        {actions(true)}
      </>
    );
  } else if (wire) {
    const fc = circuit.comps.find((c) => c.id === wire.from.c);
    const w = fc ? pinsOf(fc, circuit.defs).outs[wire.from.p]?.w ?? 1 : 1;
    content = (
      <>
        {header(w > 1 ? `Bus wire (${w} bits)` : 'Wire', '#38bdf8')}
        <div className="label">Bus / net label</div>
        <input className="field" value={wire.label ?? ''} placeholder="e.g. DATA[7:0]" onFocus={() => st.beginTx()} onChange={(e) => st.setWireLabel(wire.id, e.target.value)} />
        <div className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
          Current value: <b style={{ color: 'var(--text)' }}>{w > 1 ? `0x${hex(engine.outOf(wire.from.c, wire.from.p), w)}` : engine.outOf(wire.from.c, wire.from.p)}</b>
        </div>
        <button className="btn danger w-full mt-3" onClick={() => st.deleteSel()}><Trash2 size={13} /> Delete wire</button>
      </>
    );
  } else {
    content = (
      <>
        <div className="flex items-center gap-2 mb-2"><Info size={14} /><div className="font-semibold text-sm">Getting started</div></div>
        <ul className="text-[12px] leading-relaxed space-y-1.5" style={{ color: 'var(--muted)' }}>
          <li>• <b>Drag</b> parts from the palette onto the canvas (or click them).</li>
          <li>• <b>Wire</b>: drag from an output pin (right side) to an input pin (left side).</li>
          <li>• <b>Click</b> a switch to flip it; hold a push button to press it.</li>
          <li>• Drag the background to box-select; hold <kbd>Space</kbd> or the middle mouse button to pan; scroll to zoom.</li>
          <li>• <kbd>R</kbd> rotate · <kbd>Del</kbd> delete · <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> undo/redo · <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>V</kbd> copy/paste.</li>
          <li>• Select a sub-circuit → <b>Truth table</b> or <b>Package IC</b>.</li>
          <li>• Select a counter, adder, flip-flop… → <b>Break down</b> to see its gates, or <b>Edit IC internals</b> to change them.</li>
          <li className="lg:hidden">• On a touch screen: drag to move parts, pinch to zoom, drag the background (Pan mode) to scroll, double-tap an IC to open it.</li>
          <li>• Open <b>Examples</b> for adders, an ALU, a register file and a CPU that runs assembly.</li>
        </ul>
        <div className="mt-4 p-2.5 rounded-md text-[12px]" style={{ background: 'var(--input)' }}>
          <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Components</span><b>{circuit.comps.length}</b></div>
          <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Wires</span><b>{circuit.wires.length}</b></div>
          <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Custom ICs</span><b>{Object.keys(circuit.defs).length}</b></div>
          <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Critical path</span><b>{showCrit ? (engine.critical()?.delay ?? 0) + ' ns' : 'off'}</b></div>
        </div>
      </>
    );
  }
  return (
    <div className="h-full overflow-y-auto p-3" style={{ background: 'var(--panel)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Properties</div>
        <button className="icon-btn lg:hidden" title="Close" aria-label="Close properties" onClick={() => st.patch({ panel: null })}><X size={15} /></button>
      </div>
      {content}
    </div>
  );
}
