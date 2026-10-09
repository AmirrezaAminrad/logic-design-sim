import { useState } from 'react';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { CAT_COLOR, GATE_COLOR, PALETTE, TYPES } from '../lib/defs';
import type { PItem } from '../lib/defs';
import { gateShape } from '../lib/theme';

const canHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;
const docked = () => window.matchMedia('(min-width: 1024px)').matches;

interface Tip { label: string; desc: string; ins: string[]; outs: string[]; x: number; y: number; color: string }

function Icon({ item, color }: { item: PItem; color: string }) {
  if (GATE_COLOR[item.type]) {
    const W = 80, H = item.type === 'not' || item.type === 'buf' ? 40 : 80;
    const s = gateShape(item.type, W, H);
    return (
      <svg width={44} height={26} viewBox={`-12 ${H === 40 ? 0 : 8} ${W + 24} ${H === 40 ? 40 : 64}`}>
        <path d={s.d} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={5} strokeLinejoin="round" />
        {s.extra && <path d={s.extra} fill="none" stroke={color} strokeWidth={5} />}
        {s.bubble && <circle cx={s.bw + 5} cy={s.mid} r={5} fill="none" stroke={color} strokeWidth={4} />}
      </svg>
    );
  }
  const t = (item.label ?? TYPES[item.type]?.label ?? item.type).replace(/[^A-Za-z0-9:]/g, ' ').trim().split(/\s+/);
  const code = t.length > 1 ? t.map((w) => w[0]).join('').slice(0, 3) : t[0].slice(0, 3);
  return (
    <div className="w-[44px] h-[26px] rounded flex items-center justify-center text-[10px] font-bold" style={{ background: color + '26', color, border: `1.5px solid ${color}` }}>
      {code.toUpperCase()}
    </div>
  );
}

export default function Palette() {
  const defs = useStore((s) => s.circuit.defs);
  const [open, setOpen] = useState<Record<string, boolean>>({ gates: true, io: true });
  const [q, setQ] = useState('');
  const [tip, setTip] = useState<Tip | null>(null);

  const add = (type: string, props?: Record<string, any>) => {
    const st = useStore.getState();
    const cx = (st.viewSize.w / 2 - st.view.x) / st.view.k, cy = (st.viewSize.h / 2 - st.view.y) / st.view.k;
    const id = st.addComp(type, cx - 40 + Math.random() * 40, cy - 20 + Math.random() * 40, props);
    // on narrow screens the palette is a drawer: get out of the way so the new part is visible
    if (id && !docked()) st.patch({ panel: null });
  };

  const showTip = (e: React.MouseEvent, item: PItem, color: string) => {
    const t = TYPES[item.type];
    if (!t || !canHover()) return;
    const p = { ...t.defaults, ...(item.props ?? {}) };
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({
      label: item.label ?? t.label, desc: t.desc, color,
      ins: t.ins(p).map((x) => x.name + (x.w > 1 ? `[${x.w}]` : '')),
      outs: t.outs(p).map((x) => x.name + (x.w > 1 ? `[${x.w}]` : '')),
      x: Math.min(r.right + 10, window.innerWidth - 280),
      y: Math.min(r.top, window.innerHeight - 220),
    });
  };

  const row = (item: PItem, key: string, color: string) => (
    <div
      key={key}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-lds', JSON.stringify({ type: item.type, props: item.props }));
        e.dataTransfer.effectAllowed = 'copy';
        setTip(null);
      }}
      onClick={() => add(item.type, item.props)}
      onMouseEnter={(e) => showTip(e, item, color)}
      onMouseLeave={() => setTip(null)}
      className="palette-item flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab active:cursor-grabbing"
    >
      <Icon item={item} color={color} />
      <span className="text-[12px] truncate">{item.label ?? TYPES[item.type]?.label}</span>
    </div>
  );

  const ql = q.toLowerCase();
  const match = (i: PItem) => !ql || (i.label ?? TYPES[i.type]?.label ?? '').toLowerCase().includes(ql) || TYPES[i.type]?.desc.toLowerCase().includes(ql);
  const icList = Object.values(defs).filter((d) => !d.auto && (!ql || d.name.toLowerCase().includes(ql)));

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--panel)' }}>
      <div className="p-2 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
        <div className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: 'var(--input)' }}>
          <Search size={14} style={{ color: 'var(--muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search components…" aria-label="Search components" className="zoom-safe bg-transparent outline-none text-sm w-full min-w-0" />
        </div>
        <button className="icon-btn lg:hidden" title="Close" aria-label="Close parts" onClick={() => useStore.getState().patch({ panel: null })}><X size={15} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {PALETTE.map((cat) => {
          const items = cat.items.filter(match);
          if (!items.length) return null;
          const isOpen = open[cat.cat] || !!ql;
          return (
            <div key={cat.cat}>
              <button className="w-full flex items-center gap-1.5 px-1 py-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }} onClick={() => setOpen({ ...open, [cat.cat]: !open[cat.cat] })}>
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span className="w-2 h-2 rounded-full" style={{ background: CAT_COLOR[cat.cat] }} />
                {cat.title}
              </button>
              {isOpen && <div className="grid grid-cols-1 gap-0.5">{items.map((it, i) => row(it, cat.cat + i, GATE_COLOR[it.type] ?? CAT_COLOR[cat.cat]))}</div>}
            </div>
          );
        })}
        <div>
          <button className="w-full flex items-center gap-1.5 px-1 py-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }} onClick={() => setOpen({ ...open, custom: !open.custom })}>
            {open.custom !== false ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span className="w-2 h-2 rounded-full" style={{ background: CAT_COLOR.custom }} />
            Custom ICs ({icList.length})
          </button>
          {open.custom !== false && (
            <div className="grid grid-cols-1 gap-0.5">
              {icList.length === 0 && <div className="text-[11px] px-2 pb-2 leading-snug" style={{ color: 'var(--muted)' }}>Select a group of components and click <b>Package IC</b> — or turn a counter, adder… into one with <b>Edit IC internals</b>.</div>}
              {icList.map((d) => (
                <div
                  key={d.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('application/x-lds', JSON.stringify({ type: 'ic', props: { def: d.id } })); setTip(null); }}
                  onClick={() => add('ic', { def: d.id })}
                  onMouseEnter={(e) => {
                    if (!canHover()) return;
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setTip({ label: d.name, desc: `Custom IC with ${d.comps.length} internal parts. Double-click an instance on the canvas to edit its internals.`, ins: d.inputs.map((x) => x.label + (x.w > 1 ? `[${x.w}]` : '')), outs: d.outputs.map((x) => x.label + (x.w > 1 ? `[${x.w}]` : '')), x: Math.min(r.right + 10, window.innerWidth - 280), y: r.top, color: CAT_COLOR.custom });
                  }}
                  onMouseLeave={() => setTip(null)}
                  className="palette-item flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab"
                >
                  <div className="w-[44px] h-[26px] rounded flex items-center justify-center text-[10px] font-bold" style={{ background: CAT_COLOR.custom + '26', color: CAT_COLOR.custom, border: `1.5px solid ${CAT_COLOR.custom}` }}>IC</div>
                  <span className="text-[12px] truncate">{d.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {tip && (
        <div className="fixed z-50 w-64 p-3 rounded-lg shadow-2xl text-xs pointer-events-none" style={{ left: tip.x, top: tip.y, background: 'var(--panel2)', border: `1px solid ${tip.color}`, color: 'var(--text)' }}>
          <div className="font-bold text-sm mb-1" style={{ color: tip.color }}>{tip.label}</div>
          <div className="leading-snug opacity-90">{tip.desc}</div>
          {(tip.ins.length > 0 || tip.outs.length > 0) && (
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div><div className="opacity-60 uppercase text-[9px] tracking-wider">Inputs</div>{tip.ins.slice(0, 10).join(', ') || '—'}</div>
              <div><div className="opacity-60 uppercase text-[9px] tracking-wider">Outputs</div>{tip.outs.slice(0, 10).join(', ') || '—'}</div>
            </div>
          )}
          <div className="mt-2 opacity-50 text-[10px]">Drag onto the canvas or click to add</div>
        </div>
      )}
    </div>
  );
}
