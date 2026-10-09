import { useMemo, useRef, useState } from 'react';
import { X, Download, Upload, Save, Trash2, FileImage, FileCode2, Cpu, Package, Copy, Play, Sigma } from 'lucide-react';
import { useStore, simReset } from '../lib/store';
import { TEMPLATES } from '../lib/templates';
import { truthTable } from '../lib/engine';
import { minimize, formatSOP, kmap as buildKmap } from '../lib/boolean';
import { TYPES, hex } from '../lib/defs';
import { THEMES } from '../lib/theme';
import { OPCODES, EXAMPLE_PROGRAM, EVALUATOR_PROGRAM, assemble } from '../lib/assembler';
import { deleteSave, download, exportPNG, exportSVG, getSaves, parseCircuitJSON, saveNamed, serialize } from '../lib/exporters';

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  // a bottom sheet on phones, a centered dialog from 640px up
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(2,6,15,.65)' }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={title} className={`flex flex-col w-full max-h-[92dvh] sm:max-h-[88vh] rounded-t-2xl sm:rounded-xl shadow-2xl ${wide ? 'sm:max-w-4xl' : 'sm:max-w-xl'}`} style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' }}>
        <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="font-semibold truncate">{title}</div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="p-4 overflow-y-auto overscroll-contain" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>{children}</div>
      </div>
    </div>
  );
}

function FilesDialog({ onClose }: { onClose: () => void }) {
  const st = useStore.getState();
  const circuit = useStore((s) => s.circuit);
  const themeName = useStore((s) => s.theme);
  const [name, setName] = useState(st.circuitName);
  const [saves, setSaves] = useState(getSaves());
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const fname = (name || 'circuit').replace(/[^\w\- ]+/g, '_');

  return (
    <Modal title="Save · Load · Export" onClose={onClose}>
      <div className="label">Save to this browser (localStorage)</div>
      <div className="flex gap-2">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Circuit name" />
        <button className="btn primary" onClick={() => { saveNamed(name || 'Untitled', circuit); st.patch({ circuitName: name || 'Untitled' }); setSaves(getSaves()); setMsg('Saved.'); }}><Save size={14} /> Save</button>
      </div>
      <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
        {Object.keys(saves).length === 0 && <div className="text-xs" style={{ color: 'var(--muted)' }}>No saved circuits yet. (Your work is also auto-saved continuously.)</div>}
        {Object.entries(saves).sort((a, b) => b[1].at - a[1].at).map(([n, v]) => (
          <div key={n} className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: 'var(--input)' }}>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{n}</div>
              <div className="text-[10px]" style={{ color: 'var(--muted)' }}>{new Date(v.at).toLocaleString()} · {v.circuit.comps.length} parts</div>
            </div>
            <button className="btn" onClick={() => { st.loadCircuit(v.circuit, n); onClose(); }}>Load</button>
            <button className="icon-btn" onClick={() => { deleteSave(n); setSaves(getSaves()); }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      <div className="label mt-5">Files</div>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={() => download(`${fname}.json`, serialize(circuit, name), 'application/json')}><Download size={14} /> Export JSON</button>
        <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import JSON</button>
        <button className="btn" onClick={async () => setMsg((await exportPNG(circuit, THEMES[themeName], fname)) ? 'PNG exported.' : 'Nothing to export.')}><FileImage size={14} /> Export PNG</button>
        <button className="btn" onClick={() => setMsg(exportSVG(circuit, THEMES[themeName], fname) ? 'SVG exported.' : 'Nothing to export.')}><FileCode2 size={14} /> Export SVG</button>
      </div>
      <input
        ref={fileRef} type="file" accept=".json,application/json" className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const r = parseCircuitJSON(await f.text());
            st.loadCircuit(r.circuit, r.name ?? f.name.replace(/\.json$/, ''));
            onClose();
          } catch (err) { setMsg('Import failed: ' + (err as Error).message); }
        }}
      />
      {msg && <div className="mt-3 text-xs" style={{ color: 'var(--accent)' }}>{msg}</div>}
    </Modal>
  );
}

function TemplatesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Example circuits" onClose={onClose} wide>
      <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>Loading an example replaces the current canvas (you can undo with Ctrl+Z). Examples build on each other: half adder → full adder → 4-bit adder → ALU → register file → CPU.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {TEMPLATES.map((t) => (
          <button key={t.id} className="text-left p-3 rounded-lg transition hover:brightness-125" style={{ background: 'var(--input)', border: '1px solid var(--border)' }}
            onClick={() => { useStore.getState().loadCircuit(t.build(), t.name); onClose(); }}>
            <div className="flex items-center justify-between mb-1">
              <b className="text-sm">{t.name}</b>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent)', color: '#04121c' }}>{t.tag}</span>
            </div>
            <div className="text-xs leading-snug" style={{ color: 'var(--muted)' }}>{t.desc}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function AsmDialog({ onClose }: { onClose: () => void }) {
  const circuit = useStore((s) => s.circuit);
  const [src, setSrc] = useState(() => localStorage.getItem('lds.asm') ?? EXAMPLE_PROGRAM);
  const roms = circuit.comps.filter((c) => c.type === 'rom');
  const [target, setTarget] = useState(roms.find((r) => r.props.w === 16)?.id ?? roms[0]?.id ?? '');
  const [msg, setMsg] = useState('');
  const res = useMemo(() => assemble(src), [src]);
  const rom = roms.find((r) => r.id === target);

  return (
    <Modal title="Assembler · toy 16-bit CPU" onClose={onClose} wide>
      <div className="grid md:grid-cols-5 gap-4">
        <div className="md:col-span-3">
          <div className="label">Assembly source</div>
          <textarea className="field font-mono text-[12px] h-72 resize-none" spellCheck={false} value={src} onChange={(e) => { setSrc(e.target.value); localStorage.setItem('lds.asm', e.target.value); }} />
          {res.errors.length > 0 && (
            <div className="mt-2 text-xs text-red-400 space-y-0.5">{res.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}</div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <select className="field !w-auto" value={target} onChange={(e) => setTarget(e.target.value)}>
              {roms.length === 0 && <option value="">No ROM on canvas — load the CPU example</option>}
              {roms.map((r) => <option key={r.id} value={r.id}>{r.name || 'ROM'} ({1 << r.props.a}×{r.props.w})</option>)}
            </select>
            <button
              className="btn primary" disabled={!rom || res.errors.length > 0}
              onClick={() => {
                const st = useStore.getState();
                if (!rom) return;
                const size = 1 << rom.props.a;
                if (res.words.length > size) { setMsg(`Program has ${res.words.length} words but the ROM only holds ${size}.`); return; }
                st.setProp(rom.id, { data: res.words });
                simReset();
                setMsg(`Loaded ${res.words.length} instruction(s) into the ROM and reset the simulation. Press Run!`);
              }}
            ><Cpu size={14} /> Load into ROM</button>
            <button className="btn" onClick={() => { setSrc(EXAMPLE_PROGRAM); localStorage.setItem('lds.asm', EXAMPLE_PROGRAM); }}>Example</button>
            <button className="btn" onClick={() => { setSrc(EVALUATOR_PROGRAM); localStorage.setItem('lds.asm', EVALUATOR_PROGRAM); }}>Netlist evaluator</button>
          </div>
          {msg && <div className="mt-2 text-xs" style={{ color: 'var(--accent)' }}>{msg}</div>}
        </div>
        <div className="md:col-span-2 text-xs">
          <div className="label">Machine code</div>
          <div className="font-mono rounded-md p-2 max-h-40 overflow-y-auto" style={{ background: 'var(--input)' }}>
            {res.listing.length === 0 && <span style={{ color: 'var(--muted)' }}>—</span>}
            {res.listing.map((l) => (
              <div key={l.addr}><span style={{ color: 'var(--muted)' }}>{l.addr.toString().padStart(2, '0')}:</span> <b>{hex(l.word, 16)}</b> <span style={{ color: 'var(--muted)' }}>{l.text}</span></div>
            ))}
          </div>
          <div className="label mt-3">Instruction set (R0–R3, 8-bit)</div>
          <div className="font-mono rounded-md p-2" style={{ background: 'var(--input)' }}>
            {Object.entries(OPCODES).map(([k, v]) => (
              <div key={k}><b>{v.op.toString(16).toUpperCase()}</b> {k.padEnd(5)}<span style={{ color: 'var(--muted)' }}>{v.doc}</span></div>
            ))}
          </div>
          <div className="mt-2 leading-snug" style={{ color: 'var(--muted)' }}>Word = opcode[15:12] · rd[11:10] · rs[9:8] · imm[7:0]. LD/ST take a register in square brackets as the memory operand. Labels end with “:”. Comments start with “;”.</div>
        </div>
      </div>
    </Modal>
  );
}

function TruthDialog({ onClose }: { onClose: () => void }) {
  const circuit = useStore((s) => s.circuit);
  const sel = useStore((s) => s.sel);
  const [resetState, setResetState] = useState(true);
  const [applied, setApplied] = useState(-1);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [msg, setMsg] = useState('');
  const tt = useMemo(() => truthTable(circuit, sel.comps, { resetState }), [resetState]); // eslint-disable-line react-hooks/exhaustive-deps
  const fmt = (v: number, w: number) => (w === 1 ? String(v) : `${hex(v, w)}h`);

  // Boolean analysis input variables: multi-bit input columns expand to per-bit variables
  const vars = useMemo(() => {
    if (tt.error) return [];
    const used = new Set<string>();
    const out: string[] = [];
    tt.inCols.forEach((c, i) => {
      const base = c.label || String.fromCharCode(65 + i);
      for (let k = c.w - 1; k >= 0; k--) {
        let name = c.w === 1 ? base : `${base}${k}`;
        if (used.has(name)) name = `${name}@${i}`;
        used.add(name);
        out.push(name);
      }
    });
    return out;
  }, [tt]);

  const funcs = useMemo(() => {
    if (tt.error || !tt.outCols.length) return [];
    const list: { label: string; col: number; bit: number }[] = [];
    tt.outCols.forEach((oc, oi) => {
      if (oc.w === 1) list.push({ label: oc.label, col: oi, bit: -1 });
      else if (oc.w <= 4) for (let k = oc.w - 1; k >= 0; k--) list.push({ label: `${oc.label}[${k}]`, col: oi, bit: k });
    });
    return list;
  }, [tt]);

  const analysis = useMemo(() => {
    if (!showAnalysis || tt.error) return null;
    const km = vars.length && vars.length <= 5 ? buildKmap(vars) : null;
    return funcs.map((f) => {
      const ones = tt.rows.map((r, ri) => (((r.outs[f.col] >> (f.bit < 0 ? 0 : f.bit)) & 1) ? ri : -1)).filter((x) => x >= 0);
      const imp = vars.length <= 10 ? minimize(ones) : [];
      return {
        ...f,
        ones,
        expr: vars.length <= 10 ? formatSOP(imp, vars) : null,
        kmap: km && vars.length <= 5 ? km : null,
      };
    });
  }, [showAnalysis, tt, vars, funcs]);

  const applyRow = (k: number) => {
    const st = useStore.getState();
    let count = 0, skipped = 0;
    tt.setters.forEach((s, i) => {
      const comp = s.real ? circuit.comps.find((x) => x.id === s.id) : null;
      if (!comp || comp.type === 'button') { skipped++; return; } // push buttons can't be held from a table
      st.setProp(s.id, { value: tt.rows[k].ins[i] });
      count++;
    });
    setApplied(k);
    setMsg(count ? `Drove the circuit with row ${k + 1}${skipped ? ` (${skipped} input${skipped > 1 ? 's' : ''} can't be driven — close the dialog to interact)` : ''}.` : 'No directly drivable inputs (selection inputs are internal pins).');
  };

  const csv = () => {
    const lines = [[...tt.inCols, ...tt.outCols].map((c) => c.label).join(','), ...tt.rows.map((r) => [...r.ins, ...r.outs].join(','))];
    return lines.join('\n');
  };

  return (
    <Modal title="Truth table of selection" onClose={onClose} wide>
      {tt.error ? <div className="text-sm text-amber-400">{tt.error}</div> : (
        <>
          <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
            {tt.rows.length} rows · exhaustively simulated. Inputs on the left, outputs on the right. Click <Play size={10} className="inline" /> in a row to drive the real circuit with those inputs.
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
            {tt.hasSeq && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={resetState} onChange={(e) => { setResetState(e.target.checked); setApplied(-1); }} />
                Reset state between rows
              </label>
            )}
            <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(csv().replace(/,/g, '\t')); setMsg('Table copied to the clipboard.'); } catch { setMsg('Clipboard unavailable — use Download CSV.'); } }}><Copy size={14} /> Copy</button>
            <button className="btn" onClick={() => download('truth-table.csv', csv(), 'text/csv')}><Download size={14} /> Download CSV</button>
            {funcs.length > 0 && vars.length <= 10 && (
              <button className="btn" onClick={() => setShowAnalysis(!showAnalysis)}><Sigma size={14} /> {showAnalysis ? 'Hide' : 'Show'} K-maps & expressions</button>
            )}
          </div>
          {tt.note && <div className="text-xs mb-2 text-amber-400">{tt.note}</div>}
          {msg && <div className="text-xs mb-2" style={{ color: 'var(--accent)' }}>{msg}</div>}
          <div className="overflow-auto max-h-[45vh] rounded-md" style={{ border: '1px solid var(--border)' }}>
            <table className="text-xs font-mono w-full border-collapse">
              <thead className="sticky top-0 z-10" style={{ background: 'var(--panel2)' }}>
                <tr>
                  <th className="px-2 py-1.5" style={{ color: 'var(--muted)' }}>#</th>
                  {tt.inCols.map((c, i) => <th key={'i' + i} className="px-3 py-1.5 text-left" style={{ color: '#38bdf8' }}>{c.label}</th>)}
                  <th className="w-1" style={{ background: 'var(--border)' }} />
                  {tt.outCols.map((c, i) => <th key={'o' + i} className="px-3 py-1.5 text-left" style={{ color: '#34d399' }}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {tt.rows.map((r, k) => (
                  <tr key={k} className="cursor-pointer hover:brightness-125" title="Apply these inputs to the circuit"
                    style={{ borderTop: '1px solid var(--border)', background: applied === k ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : undefined }}
                    onClick={() => applyRow(k)}>
                    <td className="px-2 py-1 text-center" style={{ color: applied === k ? 'var(--accent)' : 'var(--muted)' }}>{k + 1}</td>
                    {r.ins.map((v, i) => <td key={'i' + i} className="px-3 py-1">{fmt(v, tt.inCols[i].w)}</td>)}
                    <td style={{ background: 'var(--border)' }} />
                    {r.outs.map((v, i) => <td key={'o' + i} className="px-3 py-1 font-bold" style={{ color: v ? '#34d399' : 'var(--muted)' }}>{fmt(v, tt.outCols[i].w)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {analysis && (
            <div className="mt-3 grid md:grid-cols-2 gap-3">
              {analysis.map((f) => (
                <div key={f.label} className="p-3 rounded-lg" style={{ background: 'var(--input)', border: '1px solid var(--border)' }}>
                  <div className="text-xs font-semibold mb-2" style={{ color: '#34d399' }}>{f.label}</div>
                  {f.kmap && (
                    <KmapGrid kmap={f.kmap} ones={new Set(f.ones)} vars={vars} />
                  )}
                  <div className="font-mono text-xs mt-2 break-words" style={{ color: 'var(--text)' }}>
                    <span style={{ color: 'var(--muted)' }}>= </span>{f.expr ?? 'too many input bits to minimize (max 10)'}
                  </div>
                  {!f.kmap && <div className="text-[10px] mt-1" style={{ color: 'var(--muted)' }}>K-map shown for up to 5 inputs · expressions up to 10.</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function KmapGrid({ kmap, ones, vars }: { kmap: ReturnType<typeof buildKmap>; ones: Set<number>; vars: string[] }) {
  const corner = vars.slice(0, kmap.rowVars.length).join('') + '\\' + vars.slice(kmap.rowVars.length).join('');
  return (
    <div className="inline-block">
      <table className="text-[11px] font-mono border-collapse">
        <thead>
          <tr>
            <th className="px-1.5 py-0.5 text-right align-bottom" style={{ color: 'var(--muted)' }}>{corner}</th>
            {kmap.colHeads.map((h, i) => <th key={i} className="px-2 py-0.5" style={{ color: '#38bdf8' }}>{h.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {kmap.cells.map((row, r) => (
            <tr key={r}>
              <th className="px-1.5 py-0.5 text-right whitespace-nowrap" style={{ color: '#38bdf8' }}>{kmap.rowHeads[r].label}</th>
              {row.map((m, c) => {
                const on = ones.has(m);
                return (
                  <td key={c} className="px-2 py-0.5 text-center border relative" style={{ borderColor: 'var(--border)', background: on ? 'color-mix(in srgb, #34d399 22%, transparent)' : undefined, color: on ? '#34d399' : 'var(--muted)' }}>
                    {on ? 1 : 0}
                    <span className="absolute top-0 right-0.5 text-[7px] opacity-50">{m}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PackageDialog({ onClose }: { onClose: () => void }) {
  const sel = useStore((s) => s.sel);
  const circuit = useStore((s) => s.circuit);
  const [name, setName] = useState('My IC');
  const items = circuit.comps.filter((c) => sel.comps.includes(c.id));
  const count = (f: (t: string) => boolean) => items.filter((c) => f(c.type)).length;
  return (
    <Modal title="Package selection as a custom IC" onClose={onClose}>
      <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--muted)' }}>
        The {items.length} selected component(s) become one reusable block. <b>Toggle switches, buttons and number inputs</b> ({count((t) => ['switch', 'button', 'numin'].includes(t))} selected) become input pins;
        {' '}<b>LEDs and hex displays</b> ({count((t) => t === 'led' || t === 'hexdisp')} selected) become output pins; any other unconnected inputs and any outputs feeding outside the selection become pins too.
        Pins are ordered top-to-bottom and named after the switch/LED labels — rename them first for a tidy block.
      </p>
      <div className="label">IC name</div>
      <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { if (useStore.getState().pack(name.trim() || 'IC')) onClose(); } }} />
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!items.length} onClick={() => { if (useStore.getState().pack(name.trim() || 'IC')) onClose(); }}><Package size={14} /> Create IC</button>
      </div>
    </Modal>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About Logic Design Sim" onClose={onClose}>
      <div className="text-sm space-y-3 leading-relaxed">
        <p>An interactive digital-logic designer and simulator that runs entirely in your browser — from a single AND gate up to a toy CPU executing assembly.</p>
        <ul className="text-xs space-y-1" style={{ color: 'var(--muted)' }}>
          <li><b style={{ color: 'var(--text)' }}>Instant mode</b>: circuits settle instantly after every change or clock edge. Great for learning function.</li>
          <li><b style={{ color: 'var(--text)' }}>Propagation-delay mode</b>: every component has a realistic delay (NOT 1 ns, AND/OR 2 ns, XOR 3 ns, flip-flops 2 ns, …). Watch glitches, races and settling in the timing diagram.</li>
          <li><b style={{ color: 'var(--text)' }}>Critical path</b>: static timing analysis highlights the longest register-to-register / input-to-output path and estimates max clock frequency.</li>
          <li><b style={{ color: 'var(--text)' }}>Buses</b>: pins have bit-widths; thick blue wires carry n-bit values. Label them from the wire's properties.</li>
          <li><b style={{ color: 'var(--text)' }}>Keyboard</b>: R rotate, Del delete, B break down, E edit IC internals, Ctrl+Z/Y undo/redo, Ctrl+C/X/V/D, Ctrl+A, arrows nudge (Shift+arrows = 5×), Space+drag pan, Shift+click multi-select, Esc deselect.</li>
          <li><b style={{ color: 'var(--text)' }}>Touch</b>: tap to select or flip a switch, drag a part to move it, drag from a pin to wire, pinch to zoom, two fingers to pan (or one finger in Pan mode), double-tap an IC to open it. Parts and Inspector open from the bottom bar; the ⋯ menu has everything else.</li>
          <li><b style={{ color: 'var(--text)' }}>Custom ICs</b>: select components → Package IC. Double-click an IC instance (or use Edit IC internals) to edit its definition — every instance updates. ICs can be opened inside ICs; Done steps back out one level.</li>
          <li><b style={{ color: 'var(--text)' }}>Break down</b>: deletes the selected IC (or complex part such as a counter, adder or flip-flop) and puts its internals on the canvas, wired into the circuit. One level per click. <b style={{ color: 'var(--text)' }}>Edit IC internals</b> on a built-in part first turns it into a custom IC with the same pins.</li>
        </ul>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>{Object.keys(TYPES).length} built-in component types. Your work is auto-saved in this browser.</p>
      </div>
    </Modal>
  );
}

export default function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const close = () => useStore.getState().patch({ dialog: null });
  switch (dialog) {
    case 'files': return <FilesDialog onClose={close} />;
    case 'templates': return <TemplatesDialog onClose={close} />;
    case 'asm': return <AsmDialog onClose={close} />;
    case 'tt': return <TruthDialog onClose={close} />;
    case 'pkg': return <PackageDialog onClose={close} />;
    case 'help': return <HelpDialog onClose={close} />;
    default: return null;
  }
}
