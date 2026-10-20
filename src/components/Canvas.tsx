import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus, AlertTriangle, Timer, RotateCw, Copy, Trash2, Network, SquarePen, SlidersHorizontal, ChevronRight } from 'lucide-react';
import { useStore, MIN_ZOOM, MAX_ZOOM } from '../lib/store';
import type { Editing } from '../lib/store';
import { engine } from '../lib/engine';
import { TYPES, hex } from '../lib/defs';
import { G, bbox, layoutOf, midPoint, pathD, pinWorld, route, snap } from '../lib/geometry';
import type { Layout, PinPos } from '../lib/geometry';
import { THEMES } from '../lib/theme';
import { isBreakable } from '../lib/breakdown';
import ComponentView from './ComponentView';

type Drag =
  | { k: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean; tap: boolean }
  | { k: 'move'; sx: number; sy: number; cx: number; cy: number; orig: Record<string, { x: number; y: number }>; moved: boolean; id: string; noMove: boolean; wasShift: boolean; alt: boolean; touch: boolean }
  | { k: 'marq'; add: boolean; base: string[]; baseWires: string[]; cx: number; cy: number; moved: boolean }
  | null;

interface Wiring { c: string; p: number; k: 'in' | 'out'; x: number; y: number; hover: { c: string; p: number; k: 'in' | 'out' } | null }
interface Gesture { d0: number; k0: number; mx0: number; my0: number; vx: number; vy: number; wx: number; wy: number }

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export default function Canvas() {
  const circuit = useStore((s) => s.circuit);
  const sel = useStore((s) => s.sel);
  const view = useStore((s) => s.view);
  const ver = useStore((s) => s.ver);
  const struct = useStore((s) => s.struct);
  const themeName = useStore((s) => s.theme);
  const showCrit = useStore((s) => s.showCrit);
  const tool = useStore((s) => s.tool);
  const mode = useStore((s) => s.mode);
  const editing = useStore((s) => s.editing);
  const th = THEMES[themeName];
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag>(null);
  const space = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ id: string; t: number } | null>(null);
  const [wiring, setWiring] = useState<Wiring | null>(null);
  const [marq, setMarq] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const layouts = useMemo(() => {
    const m = new Map<string, Layout>();
    for (const c of circuit.comps) m.set(c.id, layoutOf(c, circuit.defs));
    return m;
  }, [circuit.comps, circuit.defs]);
  const compMap = useMemo(() => new Map(circuit.comps.map((c) => [c.id, c])), [circuit.comps]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const crit = useMemo(() => (showCrit ? engine.critical() : null), [showCrit, struct]);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = useStore.getState().view;
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k };
  };

  // size tracking + wheel zoom + space key
  useEffect(() => {
    const svg = svgRef.current!;
    let first = true;
    const ro = new ResizeObserver(() => {
      const r = svg.getBoundingClientRect();
      useStore.setState({ viewSize: { w: r.width, h: r.height } });
      // frame the circuit once the real canvas size is known (small screens would otherwise clip it)
      if (first && r.width > 0 && r.height > 0) { first = false; useStore.getState().fit(); }
    });
    ro.observe(svg);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = useStore.getState();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const v = st.view;
      if (e.shiftKey && !e.ctrlKey) {
        st.setView({ ...v, x: v.x - (e.deltaY || e.deltaX) });
        return;
      }
      const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      st.setView({ k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) });
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    const kd = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(el.tagName)) { space.current = true; e.preventDefault(); }
    };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false; };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      ro.disconnect();
      svg.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  const pinAt = (e: { clientX: number; clientY: number }) => {
    let el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-pin]') as SVGElement | null;
    if (!el && wiring) {
      // fingers are fat and hide the pin: snap to the nearest compatible pin within ~28px
      let best = 28;
      document.querySelectorAll<SVGElement>('[data-pin]').forEach((p) => {
        if (p.dataset.k === wiring.k || p.dataset.c === wiring.c) return;
        const r = p.getBoundingClientRect();
        const dd = Math.hypot(r.left + r.width / 2 - e.clientX, r.top + r.height / 2 - e.clientY);
        if (dd < best) { best = dd; el = p; }
      });
    }
    if (!el) return null;
    return { c: el.dataset.c!, p: +el.dataset.p!, k: el.dataset.k as 'in' | 'out' };
  };

  /** abandon whatever one-finger interaction is in progress (a second finger turns it into a pinch) */
  const cancelInteraction = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.k === 'move') {
      const c = useStore.getState().circuit.comps.find((x) => x.id === d.id);
      if (c?.type === 'button') useStore.getState().setProp(d.id, { value: 0 }, false);
    }
    setWiring(null);
    setMarq(null);
  };

  const onDown = (e: React.PointerEvent) => {
    const st = useStore.getState();
    const tgt = e.target as Element;
    try { svgRef.current!.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    if (e.pointerType === 'mouse') pointers.current.clear(); // a mouse is never part of a pinch; drop stale entries
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // two fingers: pinch to zoom, drag to pan
      cancelInteraction();
      const [a, b] = [...pointers.current.values()];
      const r = svgRef.current!.getBoundingClientRect();
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      gesture.current = { d0: Math.max(1, dist(a, b)), k0: st.view.k, mx0: mx, my0: my, vx: st.view.x, vy: st.view.y, wx: (mx - r.left - st.view.x) / st.view.k, wy: (my - r.top - st.view.y) / st.view.k };
      return;
    }
    if (pointers.current.size > 2 || gesture.current) return;
    const touch = e.pointerType === 'touch';
    if (e.button === 1 || e.button === 2 || space.current || (st.tool === 'pan' && !touch)) {
      drag.current = { k: 'pan', sx: e.clientX, sy: e.clientY, vx: st.view.x, vy: st.view.y, moved: false, tap: false };
      return;
    }
    if (e.button !== 0) return;
    const w = toWorld(e);
    const pinEl = tgt.closest('[data-pin]') as SVGElement | null;
    if (pinEl) {
      setWiring({ c: pinEl.dataset.c!, p: +pinEl.dataset.p!, k: pinEl.dataset.k as 'in' | 'out', x: w.x, y: w.y, hover: null });
      return;
    }
    const compEl = tgt.closest('[data-comp]');
    if (compEl) {
      const id = compEl.getAttribute('data-comp')!;
      const comp = compMap.get(id);
      if (comp?.type === 'button') st.setProp(id, { value: 1 }, false);
      const wasSel = st.sel.comps.includes(id);
      let ids: string[];
      if (e.shiftKey) ids = wasSel ? st.sel.comps.filter((x) => x !== id) : [...st.sel.comps, id];
      else ids = wasSel ? st.sel.comps : [id];
      st.setSel({ comps: ids, wires: [] });
      const noMove = e.shiftKey && wasSel; // shift-click removed it from the selection: don't drag
      const orig: Record<string, { x: number; y: number }> = {};
      for (const c of st.circuit.comps) if (ids.includes(c.id)) orig[c.id] = { x: c.x, y: c.y };
      drag.current = { k: 'move', sx: w.x, sy: w.y, cx: e.clientX, cy: e.clientY, orig, moved: false, id, noMove, wasShift: e.shiftKey, alt: e.altKey || e.ctrlKey || e.metaKey, touch };
      return;
    }
    const wireEl = tgt.closest('[data-wire]');
    if (wireEl) {
      const id = wireEl.getAttribute('data-wire')!;
      st.setSel({ comps: [], wires: e.shiftKey ? [...st.sel.wires, id] : [id] });
      return;
    }
    if (touch && st.tool === 'pan') {
      // touch + pan mode: the background scrolls the view; a plain tap clears the selection
      drag.current = { k: 'pan', sx: e.clientX, sy: e.clientY, vx: st.view.x, vy: st.view.y, moved: false, tap: true };
      return;
    }
    if (!e.shiftKey) st.setSel({ comps: [], wires: [] });
    drag.current = { k: 'marq', add: e.shiftKey, base: st.sel.comps, baseWires: st.sel.wires, cx: e.clientX, cy: e.clientY, moved: false };
    setMarq({ x0: w.x, y0: w.y, x1: w.x, y1: w.y });
  };

  const onMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g) {
      if (pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const r = svgRef.current!.getBoundingClientRect();
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, g.k0 * (dist(a, b) / g.d0)));
        // keep the world point that was between the fingers under the fingers
        useStore.getState().setView({ k, x: mx - r.left - g.wx * k, y: my - r.top - g.wy * k });
      }
      return;
    }
    const d = drag.current;
    const st = useStore.getState();
    if (wiring) {
      const w = toWorld(e);
      const h = pinAt(e);
      setWiring({ ...wiring, x: w.x, y: w.y, hover: h && h.k !== wiring.k && h.c !== wiring.c ? h : null });
      return;
    }
    if (!d) return;
    if (d.k === 'pan') {
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
      st.setView({ ...st.view, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy });
    } else if (d.k === 'move') {
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < (d.touch ? 8 : 4)) return;
        d.moved = true;
        if (d.noMove) return;
        st.beginTx();
      }
      if (d.noMove) return;
      const w = toWorld(e);
      const dx = snap(w.x - d.sx), dy = snap(w.y - d.sy);
      st.update((c) => ({ ...c, comps: c.comps.map((x) => (d.orig[x.id] ? { ...x, x: d.orig[x.id].x + dx, y: d.orig[x.id].y + dy } : x)) }));
    } else if (d.k === 'marq') {
      const w = toWorld(e);
      if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) > 3) d.moved = true;
      setMarq((m) => (m ? { ...m, x1: w.x, y1: w.y } : m));
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (gesture.current) {
      // the pinch ends when a finger lifts; the remaining finger must not start dragging things
      if (pointers.current.size < 2) gesture.current = null;
      drag.current = null;
      return;
    }
    const d = drag.current;
    const st = useStore.getState();
    drag.current = null;
    if (wiring) {
      const h = pinAt(e);
      if (h && h.k !== wiring.k && h.c !== wiring.c) {
        const a = { c: wiring.c, p: wiring.p }, b = { c: h.c, p: h.p };
        if (wiring.k === 'out') st.addWire(a, b); else st.addWire(b, a);
      }
      setWiring(null);
      return;
    }
    if (!d) return;
    if (d.k === 'pan') {
      if (d.tap && !d.moved && e.type === 'pointerup') st.setSel({ comps: [], wires: [] });
    } else if (d.k === 'move') {
      const comp = st.circuit.comps.find((c) => c.id === d.id);
      if (comp?.type === 'button') st.setProp(d.id, { value: 0 }, false);
      else if (!d.moved && !d.wasShift && comp && e.type === 'pointerup') {
        if (comp.type === 'switch') st.setProp(d.id, { value: comp.props.value ? 0 : 1 }, false);
        else if (comp.type === 'numin') {
          const n = 1 << comp.props.w;
          st.setProp(d.id, { value: (comp.props.value + (d.alt ? -1 : 1) + n) % n }, false);
        } else if (comp.type === 'clock') { engine.toggleClock(d.id); st.bump(); }
        else if (comp.type === 'ic' && d.touch) {
          // touch screens have no reliable double-click: two quick taps open the IC
          const now = performance.now();
          if (lastTap.current?.id === d.id && now - lastTap.current.t < 450) { lastTap.current = null; st.enterEdit(comp.props.def); }
          else lastTap.current = { id: d.id, t: now };
        }
      }
    } else if (d.k === 'marq') {
      if (marq && d.moved) {
        const x0 = Math.min(marq.x0, marq.x1), x1 = Math.max(marq.x0, marq.x1), y0 = Math.min(marq.y0, marq.y1), y1 = Math.max(marq.y0, marq.y1);
        const hit = st.circuit.comps.filter((c) => {
          const b = bbox(c, layouts.get(c.id) ?? layoutOf(c, st.circuit.defs));
          return b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1;
        }).map((c) => c.id);
        const comps = d.add ? Array.from(new Set([...d.base, ...hit])) : hit;
        const hitSet = new Set(comps);
        const wires = st.circuit.wires.filter((w) => hitSet.has(w.from.c) && hitSet.has(w.to.c)).map((w) => w.id);
        st.setSel({ comps, wires: Array.from(new Set([...d.baseWires, ...wires])) });
      }
      setMarq(null);
    }
  };

  /** the system took the touch away (edge swipe, palm rejection…): abandon, never complete, what was in progress */
  const onCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    cancelInteraction();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-lds');
    if (!raw) return;
    const { type, props } = JSON.parse(raw);
    const w = toWorld(e);
    useStore.getState().addComp(type, w.x - 40, w.y - 20, props);
  };

  // ---------- wires ----------
  const fan = new Map<string, number>();
  for (const w of circuit.wires) { const k = w.from.c + '.' + w.from.p; fan.set(k, (fan.get(k) ?? 0) + 1); }
  const pinPos = (cid: string, kind: 'in' | 'out', p: number): PinPos | null => {
    const c = compMap.get(cid);
    const l = layouts.get(cid);
    return c && l ? pinWorld(c, l, kind, p) : null;
  };

  const wireEls = circuit.wires.map((w) => {
    const a = pinPos(w.from.c, 'out', w.from.p), b = pinPos(w.to.c, 'in', w.to.p);
    if (!a || !b) return null;
    const lane = Array.from(w.from.c + w.from.p).reduce((s, ch) => s + ch.charCodeAt(0), 0) % 3;
    const pts = route(a, b, lane);
    const d = pathD(pts);
    const width = layouts.get(w.from.c)?.outP[w.from.p]?.w ?? 1;
    const v = engine.outOf(w.from.c, w.from.p);
    const on = v !== 0;
    const color = width > 1 ? (on ? th.bus : th.busOff) : on ? th.wireOn : th.wireOff;
    const selected = sel.wires.includes(w.id);
    const isCrit = !!crit && crit.pairs.has(`${w.from.c}>${w.to.c}`);
    const mp = midPoint(pts, 56);
    const label = (w.label ? w.label + (width > 1 ? ' = ' : '') : '') + (width > 1 ? '0x' + hex(v, width) : '');
    return (
      <g key={w.id}>
        <path data-ui="1" data-wire={w.id} className="wire-hit" d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} />
        {isCrit && <path data-ui="1" d={d} fill="none" stroke={th.crit} strokeWidth={8} strokeOpacity={0.6} strokeLinejoin="round" pointerEvents="none" />}
        {selected && <path data-ui="1" d={d} fill="none" stroke={th.sel} strokeWidth={7} strokeOpacity={0.55} strokeLinejoin="round" pointerEvents="none" />}
        <path d={d} fill="none" stroke={color} strokeWidth={width > 1 ? 4 : 2.5} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
        {(fan.get(w.from.c + '.' + w.from.p) ?? 0) > 1 && pts[1] && <circle cx={pts[1][0]} cy={pts[1][1]} r={3.2} fill={color} pointerEvents="none" />}
        {label && (
          <g pointerEvents="none">
            <rect x={mp.x - label.length * 3.1 - 4} y={mp.y - 8} width={label.length * 6.2 + 8} height={14} rx={4} fill={th.body} stroke={color} strokeWidth={1} />
            <text x={mp.x} y={mp.y + 3} textAnchor="middle" fontSize={9.5} fill={th.text} fontFamily="ui-monospace, Menlo, monospace">{label}</text>
          </g>
        )}
      </g>
    );
  });

  let preview: React.ReactNode = null;
  if (wiring) {
    const start = pinPos(wiring.c, wiring.k, wiring.p);
    if (start) {
      let pts: [number, number][];
      const hv = wiring.hover ? pinPos(wiring.hover.c, wiring.hover.k, wiring.hover.p) : null;
      const cur = hv ?? { x: wiring.x, y: wiring.y, dx: -start.dx, dy: -start.dy };
      pts = wiring.k === 'out' ? route(start, cur) : route(cur, start);
      preview = <path data-ui="1" d={pathD(pts)} fill="none" stroke={th.sel} strokeWidth={2.5} strokeDasharray="7 5" pointerEvents="none" />;
    }
  }

  const minor = G * view.k;
  const major = G * 5 * view.k;
  const minorOpacity = Math.max(0, Math.min(1, (minor - 7) / 7));
  const status = mode === 'delay' ? `t = ${engine.time} ns` : `${engine.stamp} sim events`;

  // ---------- selection actions for touch screens (no keyboard) ----------
  const selComps = circuit.comps.filter((c) => sel.comps.includes(c.id));
  const hasSel = selComps.length > 0 || sel.wires.length > 0;
  const canBreak = selComps.some((c) => isBreakable(c, circuit.defs));
  const canEdit = selComps.length === 1 && canBreak;
  const act = useStore.getState;

  // breadcrumb of the IC editing sessions: Main › Outer IC › Inner IC
  const crumbs: string[] = [];
  if (editing) {
    const chain: Editing[] = [];
    for (let e: Editing | null = editing; e; e = e.parent) chain.unshift(e);
    for (const e of chain) crumbs.push(circuit.defs[e.defId]?.name ?? 'IC');
  }

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: th.bg }}>
      <svg
        ref={svgRef}
        className="w-full h-full block select-none"
        style={{ touchAction: 'none', cursor: tool === 'pan' ? 'grab' : 'default' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          const el = (e.target as Element).closest('[data-comp]');
          if (!el) return;
          const c = compMap.get(el.getAttribute('data-comp')!);
          if (c?.type === 'ic' && c.props.def) useStore.getState().enterEdit(c.props.def);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <defs>
          <pattern id="gridMajor" width={major} height={major} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <path d={`M${major} 0 H0 V${major}`} fill="none" stroke={th.grid} strokeWidth={1} />
          </pattern>
          <pattern id="gridMinor" width={minor} height={minor} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <path d={`M${minor} 0 H0 V${minor}`} fill="none" stroke={th.grid} strokeWidth={1} />
          </pattern>
        </defs>
        <rect data-ui="1" width="100%" height="100%" fill={th.bg} />
        <rect data-ui="1" width="100%" height="100%" fill="url(#gridMajor)" />
        {minorOpacity > 0 && <rect data-ui="1" width="100%" height="100%" fill="url(#gridMinor)" opacity={minorOpacity} />}
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <g id="world">
            {wireEls}
            {circuit.comps.map((c) => {
              const l = layouts.get(c.id);
              if (!l || (!TYPES[c.type] && c.type !== 'ic')) return null;
              return <ComponentView key={c.id} c={c} lay={l} th={th} selected={sel.comps.includes(c.id)} crit={!!crit && crit.topSet.has(c.id)} defs={circuit.defs} ver={ver} />;
            })}
          </g>
          {preview}
          {marq && (
            <rect data-ui="1" x={Math.min(marq.x0, marq.x1)} y={Math.min(marq.y0, marq.y1)} width={Math.abs(marq.x1 - marq.x0)} height={Math.abs(marq.y1 - marq.y0)} fill={th.sel} fillOpacity={0.08} stroke={th.sel} strokeDasharray="4 3" />
          )}
        </g>
      </svg>

      {!circuit.comps.length && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6">
          <div className="text-center" style={{ color: 'var(--muted)' }}>
            <div className="text-lg font-semibold">Empty canvas</div>
            <div className="text-sm mt-1">Add parts from the palette, or load an example from <b>Examples</b>.</div>
          </div>
        </div>
      )}

      {/* top overlays: IC-editing banner and critical-path box share one column so they can never overlap */}
      <div className="absolute inset-x-2 top-2 flex flex-col items-center gap-2 pointer-events-none z-10">
        {editing && (
          <div className="pointer-events-auto max-w-full flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg shadow-lg" style={{ background: 'var(--panel2)', border: '1px solid #d946ef', color: 'var(--text)' }}>
            <span className="shrink-0" style={{ color: '#d946ef' }}>Editing IC</span>
            <span className="flex items-center gap-0.5 min-w-0 font-bold truncate">
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-0.5 min-w-0">
                  {i > 0 && <ChevronRight size={11} className="shrink-0 opacity-60" />}
                  <span className="truncate">{c}</span>
                </span>
              ))}
            </span>
            <span className="hidden md:inline shrink-0" style={{ color: 'var(--muted)' }}>changes apply to every instance</span>
            <button className="btn shrink-0" onClick={() => useStore.getState().exitEdit()}>Done</button>
          </div>
        )}
        {showCrit && (
          <div className="pointer-events-auto self-stretch sm:self-end sm:max-w-xs text-xs p-3 rounded-lg shadow-lg" style={{ background: 'var(--panel)', border: '1px solid ' + th.crit, color: 'var(--text)' }}>
            <div className="font-semibold mb-1" style={{ color: th.crit }}>Critical path</div>
            {crit ? (
              <>
                <div>
                  Longest delay: <b>{crit.delay} ns</b> → max clock ≈ <b>{crit.delay ? (1000 / crit.delay).toFixed(1) : '∞'} MHz</b>
                </div>
                <div className="mt-1 opacity-80 leading-snug line-clamp-4">
                  {crit.tops.map((id) => {
                    const c = compMap.get(id);
                    return c ? c.name || (c.type === 'ic' ? circuit.defs[c.props.def]?.name : TYPES[c.type]?.label) : id;
                  }).join(' → ')}
                </div>
                {crit.loops && <div className="mt-1 text-amber-400">Feedback loops were ignored.</div>}
              </>
            ) : <div>No paths.</div>}
          </div>
        )}
      </div>

      <div className="absolute left-2 bottom-2 sm:left-3 sm:bottom-3 flex items-center gap-2 text-[11px] px-2 py-1 rounded-md pointer-events-none max-w-[calc(100%-4.5rem)]" style={{ background: 'var(--panel)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
        <span>{Math.round(view.k * 100)}%</span>
        <span>·</span>
        <span className="flex items-center gap-1 whitespace-nowrap"><Timer size={11} />{status}</span>
        {engine.unstable && <span className="flex items-center gap-1 text-amber-400"><AlertTriangle size={12} /><span className="hidden sm:inline"> circuit does not settle (oscillating feedback)</span></span>}
      </div>

      <div className="absolute right-2 bottom-2 sm:right-3 sm:bottom-3 flex flex-col gap-1">
        <button className="icon-btn" title="Zoom in" aria-label="Zoom in" onClick={() => useStore.getState().zoomBy(1.25)}><Plus size={15} /></button>
        <button className="icon-btn" title="Zoom out" aria-label="Zoom out" onClick={() => useStore.getState().zoomBy(0.8)}><Minus size={15} /></button>
        <button className="icon-btn" title="Fit to screen" aria-label="Fit to screen" onClick={() => useStore.getState().fit()}><Maximize size={15} /></button>
      </div>

      {/* touch screens have no Delete / R / B keys: the common actions live here */}
      {hasSel && (
        <div className="lg:hidden absolute left-2 right-14 bottom-11 flex justify-center pointer-events-none z-10">
          <div className="pointer-events-auto flex items-center gap-1 p-1 rounded-xl shadow-xl max-w-full overflow-x-auto no-scrollbar" style={{ background: 'var(--panel2)', border: '1px solid var(--border)' }}>
            {selComps.length > 0 && <button className="btn sq" title="Rotate" aria-label="Rotate" onClick={() => act().rotate()}><RotateCw size={16} /></button>}
            {selComps.length > 0 && <button className="btn sq" title="Duplicate" aria-label="Duplicate" onClick={() => { act().copy(); act().paste(); }}><Copy size={16} /></button>}
            {canBreak && <button className="btn sq" title="Break down: put the internals on the canvas" aria-label="Break down" onClick={() => act().breakdown()}><Network size={16} /></button>}
            {canEdit && <button className="btn sq" title="Edit IC internals" aria-label="Edit IC internals" onClick={() => act().editInternals()}><SquarePen size={16} /></button>}
            <button className="btn sq" title="Inspector" aria-label="Open inspector" onClick={() => act().patch({ panel: 'props' })}><SlidersHorizontal size={16} /></button>
            <button className="btn sq danger" title="Delete" aria-label="Delete" onClick={() => act().deleteSel()}><Trash2 size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
