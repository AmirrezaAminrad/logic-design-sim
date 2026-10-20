import { memo } from 'react';
import type { Comp, ICDef } from '../lib/types';
import { CAT_COLOR, GATE_COLOR, TYPES, hex } from '../lib/defs';
import { bbox } from '../lib/geometry';
import type { Layout } from '../lib/geometry';
import { engine } from '../lib/engine';
import { LED_COLORS, gateShape } from '../lib/theme';
import type { Theme } from '../lib/theme';

interface Props {
  c: Comp;
  lay: Layout;
  th: Theme;
  selected: boolean;
  crit: boolean;
  defs: Record<string, ICDef>;
  ver: number;
}

const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const SEG:Record<string, [number, number, number, number]> = {
  a: [10, 0, 36, 8], b: [46, 10, 8, 36], c: [46, 54, 8, 36], d: [10, 92, 36, 8], e: [2, 54, 8, 36], f: [2, 10, 8, 36], g: [10, 46, 36, 8],
};

function ComponentViewImpl({ c, lay, th, selected, crit, defs, ver }: Props) {
  void ver;
  const t = TYPES[c.type];
  const W = lay.W, H = lay.H, cx = W / 2, cy = H / 2;
  const isGate = !!GATE_COLOR[c.type];
  const col = isGate ? GATE_COLOR[c.type] : CAT_COLOR[t?.cat ?? 'custom'];
  const ur = (x: number, y: number) => `rotate(${-c.rot * 90} ${x} ${y})`;
  const bb = bbox(c, lay);
  const val = (k: number) => engine.outOf(c.id, k);
  const inV = (k: number) => engine.inOf(c.id, k);
  const st = engine.stOf(c.id);
  const info = t?.info ? t.info(st, c.props) : [];
  const desc = (c.type === 'ic' ? `Custom IC "${defs[c.props.def]?.name}"` : t?.label) + (t ? ' — ' + t.desc : '');

  let body: React.ReactNode = null;
  let showLabels = true;
  const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

  if (isGate) {
    showLabels = false;
    const s = gateShape(c.type, W, H);
    body = (
      <>
        <path d={s.d} fill={col} fillOpacity={0.16} stroke={col} strokeWidth={2.2} strokeLinejoin="round" />
        {s.extra && <path d={s.extra} fill="none" stroke={col} strokeWidth={2.2} />}
        {s.bubble && <circle cx={s.bw + 5} cy={s.mid} r={4.5} fill={th.body} stroke={col} strokeWidth={2} />}
        {c.type !== 'not' && c.type !== 'buf' && (
          <text x={s.bw * 0.42} y={s.mid + 3} transform={ur(s.bw * 0.42, s.mid + 3)} textAnchor="middle" fontSize={10} fontWeight={700} fill={col} fontFamily="system-ui, sans-serif">
            {c.type.toUpperCase()}{c.props.w > 1 ? `×${c.props.w}` : ''}
          </text>
        )}
      </>
    );
  } else {
    const frame = <rect x={0} y={0} width={W} height={H} rx={7} fill={th.body} stroke={col} strokeWidth={2} />;
    switch (c.type) {
      case 'switch': {
        const on = c.props.value ? 1 : 0;
        showLabels = false;
        body = (
          <>
            {frame}
            <rect x={cx - 22} y={cy - 10} width={44} height={20} rx={10} fill={on ? '#22c55e' : th.pinOff} />
            <circle cx={on ? cx + 12 : cx - 12} cy={cy} r={8} fill="#fff" />
          </>
        );
        break;
      }
      case 'button': {
        const on = c.props.value ? 1 : 0;
        showLabels = false;
        body = (
          <>
            {frame}
            <circle cx={cx} cy={cy} r={13} fill={on ? '#f87171' : '#7f1d1d'} stroke={on ? '#fecaca' : '#b91c1c'} strokeWidth={2} />
          </>
        );
        break;
      }
      case 'clock': {
        const lvl = val(0);
        showLabels = false;
        const x0 = 14, x1 = W - 14, xm = (x0 + x1) / 2;
        body = (
          <>
            <rect x={0} y={0} width={W} height={H} rx={7} fill={th.body} stroke={col} strokeWidth={2} />
            <path d={`M${x0} 24 V8 H${xm} V24 H${x1} V8`} fill="none" stroke={lvl ? th.wireOn : th.sub} strokeWidth={2} />
            <text x={cx} y={H - 5} transform={ur(cx, H - 5)} textAnchor="middle" fontSize={9} fill={th.sub} {...mono}>
              {engine.mode === 'delay' ? `T=${c.props.period}` : `${c.props.freq} Hz`}
            </text>
          </>
        );
        break;
      }
      case 'led': {
        const on = inV(0);
        const lc = LED_COLORS[c.props.color] ?? LED_COLORS.red;
        showLabels = false;
        body = (
          <>
            <rect x={0} y={0} width={W} height={H} rx={7} fill={th.body} stroke={col} strokeWidth={2} />
            {on ? <circle cx={cx + 2} cy={cy} r={17} fill={lc} opacity={0.35} /> : null}
            <circle cx={cx + 2} cy={cy} r={11} fill={lc} fillOpacity={on ? 1 : th.ledOff} stroke={lc} strokeWidth={2} />
          </>
        );
        break;
      }
      case 'hexdisp':
      case 'numin':
      case 'const': {
        const w = c.props.w;
        const v = c.type === 'hexdisp' ? inV(0) : c.props.value & ((1 << w) - 1);
        showLabels = false;
        body = (
          <>
            <rect x={0} y={0} width={W} height={H} rx={7} fill={th.body} stroke={col} strokeWidth={2} strokeDasharray={c.type === 'numin' ? '5 3' : undefined} />
            <text x={cx} y={cy + 2} transform={ur(cx, cy + 2)} textAnchor="middle" fontSize={w > 8 ? 13 : 16} fontWeight={700} fill={th.text} {...mono}>
              {w === 1 ? v : hex(v, w) + (c.type === 'const' ? '' : 'h')}
            </text>
            {w > 1 && (
              <text x={cx} y={H - 4} transform={ur(cx, H - 4)} textAnchor="middle" fontSize={8} fill={th.sub} {...mono}>
                {v}
              </text>
            )}
          </>
        );
        break;
      }
      case 'seg7': {
        const ox = (W - 62) / 2 + 6, oy = (H - 104) / 2;
        const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
        body = (
          <>
            {frame}
            <g transform={`translate(${ox} ${oy})`}>
              {names.map((n, i) => {
                const [x, y, w, h] = SEG[n];
                const on = inV(i);
                return <rect key={n} x={x} y={y} width={w} height={h} rx={3} fill="#ef4444" fillOpacity={on ? 1 : 0.14} />;
              })}
              <circle cx={60} cy={96} r={4} fill="#ef4444" fillOpacity={inV(7) ? 1 : 0.14} />
            </g>
          </>
        );
        break;
      }
      case 'pin_in':
      case 'pin_out': {
        const isOut = c.type === 'pin_out';
        showLabels = false;
        const label = c.name || (isOut ? 'OUT' : 'IN');
        body = (
          <>
            {frame}
            <path
              d={isOut ? `M${W - 16} ${cy - 5} L${W - 7} ${cy} L${W - 16} ${cy + 5} Z` : `M7 ${cy - 5} L16 ${cy} L7 ${cy + 5} Z`}
              fill={col}
              opacity={0.75}
            />
            <text x={isOut ? cx - 5 : cx + 5} y={cy + 3} textAnchor="middle" fontSize={9} fontWeight={700} fill={col} fontFamily="system-ui, sans-serif">
              {label}
            </text>
          </>
        );
        break;
      }
      default: {
        body = (
          <>
            {frame}
            <text x={cx} y={info.length ? cy - 8 : cy + 4} transform={ur(cx, info.length ? cy - 8 : cy + 4)} textAnchor="middle" fontSize={11} fontWeight={700} fill={col} fontFamily="system-ui, sans-serif">
              {lay.title}
            </text>
            {info.map((l, i) => (
              <text key={i} x={cx} y={cy + 8 + i * 12} transform={ur(cx, cy + 8 + i * 12)} textAnchor="middle" fontSize={9} fill={th.text} {...mono}>
                {l}
              </text>
            ))}
          </>
        );
      }
    }
  }

  const pinDot = (kind: 'in' | 'out', k: number, x: number, y: number, name: string, w: number) => {
    const v = kind === 'in' ? inV(k) : val(k);
    const on = v !== 0;
    const fill = on ? (w > 1 ? th.bus : th.wireOn) : th.pinOff;
    return (
      <g key={kind + k}>
        <circle cx={x} cy={y} r={4} fill={fill} stroke={th.stroke} strokeWidth={1} />
        {showLabels && c.rot === 0 && name && (
          <text x={kind === 'in' ? x + 8 : x - 8} y={y + 3} textAnchor={kind === 'in' ? 'start' : 'end'} fontSize={9} fill={th.sub} fontFamily="system-ui, sans-serif">
            {name}
          </text>
        )}
        <circle data-ui="1" data-pin="1" className="pin-hit" data-c={c.id} data-p={k} data-k={kind} cx={x} cy={y} r={coarse ? 14 : 9} fill="transparent" style={{ cursor: 'crosshair' }}>
          <title>{`${name || (kind === 'in' ? 'in' : 'out')} · ${w} bit${w > 1 ? 's' : ''} · value ${w > 1 ? '0x' + hex(v, w) : v}`}</title>
        </circle>
      </g>
    );
  };

  return (
    <g>
      <g data-comp={c.id} transform={`translate(${c.x} ${c.y}) rotate(${c.rot * 90} ${cx} ${cy})`} style={{ cursor: 'move' }}>
        <title>{desc}</title>
        {selected && <rect data-ui="1" x={-6} y={-6} width={W + 12} height={H + 12} rx={10} fill="none" stroke={th.sel} strokeWidth={2} strokeDasharray="6 4" />}
        {crit && <rect data-ui="1" x={-4} y={-4} width={W + 8} height={H + 8} rx={9} fill="none" stroke={th.crit} strokeWidth={3} />}
        {body}
        {lay.ins.map((p, k) => pinDot('in', k, p.x, p.y, lay.inP[k].name, lay.inP[k].w))}
        {lay.outs.map((p, k) => pinDot('out', k, p.x, p.y, lay.outP[k].name, lay.outP[k].w))}
      </g>
      {c.name && (
        <text x={c.x + cx} y={bb.y0 - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={th.text} fontFamily="system-ui, sans-serif" pointerEvents="none">
          {c.name}
        </text>
      )}
    </g>
  );
}

export default memo(ComponentViewImpl);
