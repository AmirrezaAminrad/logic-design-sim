import { useEffect, useRef, useState } from 'react';
import { X, Trash2, Wand2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { engine } from '../lib/engine';
import { hex, pinsOf, TYPES } from '../lib/defs';
import { THEMES } from '../lib/theme';
import { uid } from '../lib/types';
import type { Probe } from '../lib/types';

const COLORS = ['#34d399', '#38bdf8', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171'];
const ROW = 42, HEAD = 22;

export default function Waveform() {
  const circuit = useStore((s) => s.circuit);
  const ver = useStore((s) => s.ver);
  const mode = useStore((s) => s.mode);
  const th = THEMES[useStore((s) => s.theme)];
  const [px, setPx] = useState(16);
  const sc = useRef<HTMLDivElement>(null);
  const probes = circuit.probes;
  const samples = engine.rec.slice(-2000);

  useEffect(() => {
    if (sc.current) sc.current.scrollLeft = sc.current.scrollWidth;
  }, [ver]);

  const widthOf = (p: Probe) => {
    const c = circuit.comps.find((x) => x.id === p.comp);
    if (!c) return 1;
    const pp = pinsOf(c, circuit.defs);
    return (p.kind === 'out' ? pp.outs[p.pin] : pp.ins[p.pin])?.w ?? 1;
  };

  const autoAdd = () => {
    const st = useStore.getState();
    const list: Probe[] = [];
    for (const c of circuit.comps) {
      const t = TYPES[c.type];
      if (!t) continue;
      const label = c.name || t.label;
      if (['switch', 'button', 'numin', 'clock'].includes(c.type)) list.push({ id: uid('p'), comp: c.id, pin: 0, kind: 'out', label });
      else if (t.sink && c.type !== 'seg7') list.push({ id: uid('p'), comp: c.id, pin: 0, kind: 'in', label });
    }
    const existing = new Set(probes.map((p) => `${p.comp}.${p.pin}.${p.kind}`));
    st.setProbes([...probes, ...list.filter((p) => !existing.has(`${p.comp}.${p.pin}.${p.kind}`))]);
  };

  const width = Math.max(300, samples.length * px + 30);
  const height = HEAD + Math.max(1, probes.length) * ROW;
  const xs = (i: number) => 8 + i * px;
  const tickEvery = Math.max(1, Math.ceil(60 / px));

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)' }}>
      <div className="flex items-center gap-3 px-3 py-1.5 text-xs overflow-x-auto no-scrollbar whitespace-nowrap shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <b className="text-sm shrink-0">Timing diagram</b>
        <span className="hidden md:inline shrink-0" style={{ color: 'var(--muted)' }}>{mode === 'delay' ? 'x-axis: ticks (ns)' : 'x-axis: simulation events (each clock edge / input change)'}</span>
        <div className="flex-1" />
        <button className="chip" onClick={autoAdd}><Wand2 size={11} /> Add all I/O</button>
        <label className="flex items-center gap-1.5 shrink-0">Zoom
          <input type="range" min={6} max={48} value={px} onChange={(e) => setPx(+e.target.value)} />
        </label>
        <button className="chip" onClick={() => { engine.rec = []; useStore.getState().bump(); }}><Trash2 size={11} /> Clear</button>
        <button className="icon-btn" onClick={() => useStore.getState().patch({ showWave: false })}><X size={14} /></button>
      </div>
      {probes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-center px-4" style={{ color: 'var(--muted)' }}>
          Select a component and use “Add to waveform” in the Properties panel — or press “Add all I/O”.
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div className="w-24 sm:w-40 shrink-0 overflow-hidden" style={{ borderRight: '1px solid var(--border)', paddingTop: HEAD }}>
            {probes.map((p, i) => (
              <div key={p.id} className="flex items-center justify-between px-2 text-xs" style={{ height: ROW, color: COLORS[i % COLORS.length] }}>
                <span className="truncate font-medium">{p.label}{widthOf(p) > 1 ? `[${widthOf(p)}]` : ''}</span>
                <button className="opacity-50 hover:opacity-100" onClick={() => useStore.getState().removeProbe(p.id)}><X size={12} /></button>
              </div>
            ))}
          </div>
          <div ref={sc} className="flex-1 overflow-auto">
            <svg width={width} height={height} style={{ display: 'block' }}>
              {samples.map((s, i) => (i % tickEvery === 0 ? (
                <g key={s.t}>
                  <line x1={xs(i)} x2={xs(i)} y1={HEAD - 4} y2={height} stroke={th.grid} strokeWidth={1} />
                  <text x={xs(i) + 2} y={12} fontSize={9} fill={th.sub} fontFamily="ui-monospace, monospace">{s.t}</text>
                </g>
              ) : null))}
              {probes.map((p, pi) => {
                const col = COLORS[pi % COLORS.length];
                const w = widthOf(p);
                const y0 = HEAD + pi * ROW;
                const vals = samples.map((s) => s.v[p.id] ?? 0);
                if (!vals.length) return null;
                const end = xs(vals.length);
                if (w === 1) {
                  const yl = (v: number) => (v ? y0 + 8 : y0 + ROW - 10);
                  let d = `M${xs(0)} ${yl(vals[0])}`;
                  for (let i = 1; i < vals.length; i++) if (vals[i] !== vals[i - 1]) d += ` H${xs(i)} V${yl(vals[i])}`;
                  d += ` H${end}`;
                  return <path key={p.id} d={d} fill="none" stroke={col} strokeWidth={2} />;
                }
                const els: React.ReactNode[] = [];
                let a = 0;
                for (let i = 1; i <= vals.length; i++) {
                  if (i === vals.length || vals[i] !== vals[a]) {
                    const xa = xs(a), xb = i === vals.length ? end : xs(i);
                    const top = y0 + 8, bot = y0 + ROW - 10, mid = (top + bot) / 2;
                    els.push(
                      <g key={a}>
                        <path d={`M${xa} ${mid} L${xa + 4} ${top} H${xb - 4} L${xb} ${mid} L${xb - 4} ${bot} H${xa + 4} Z`} fill={col} fillOpacity={0.12} stroke={col} strokeWidth={1.5} />
                        {xb - xa > 30 && <text x={(xa + xb) / 2} y={mid + 3} textAnchor="middle" fontSize={10} fill={th.text} fontFamily="ui-monospace, monospace">{hex(vals[a], w)}</text>}
                      </g>
                    );
                    a = i;
                  }
                }
                return <g key={p.id}>{els}</g>;
              })}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
