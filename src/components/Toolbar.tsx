import { useEffect, useState } from 'react';
import {
  Undo2, Redo2, Play, Pause, StepForward, SkipForward, RotateCcw, MousePointer2, Hand, Timer, Zap, Route, Activity, Table2, Package,
  Network, LayoutTemplate, Cpu, FolderOpen, HelpCircle, Sun, Moon, CircuitBoard, FilePlus2, SquarePen, Ellipsis, X,
} from 'lucide-react';
import { useStore, simReset, simStep } from '../lib/store';
import { isBreakable } from '../lib/breakdown';
import { titleOf } from '../lib/geometry';

/*
 * Layout rules (so nothing "moves around"):
 *  - every control has a width that depends only on the screen size, never on app state
 *    (Run/Pause is one fixed-width button, the speed readout has a fixed width, the selection
 *    actions are always present and merely disabled);
 *  - rows never wrap: they scroll sideways instead if a very narrow window cannot fit them;
 *  - labels appear at fixed breakpoints (xl: key buttons, 2xl: everything).
 * Below 1024px a compact bar plus a "more" menu replaces the two rows.
 */

const xl = (t: string) => <span className="hidden xl:inline">{t}</span>;
const xxl = (t: string) => <span className="hidden 2xl:inline">{t}</span>;
/** icon button that grows a label at 2xl */
const WIDE = '2xl:w-auto! 2xl:px-2.5!';

// Fine-grained selectors: the toolbar must not re-render on every simulation frame.
function useBar() {
  const circuitName = useStore((s) => s.circuitName);
  const circuitEmpty = useStore((s) => s.circuit.comps.length === 0);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const tool = useStore((s) => s.tool);
  const running = useStore((s) => s.running);
  const mode = useStore((s) => s.mode);
  const tps = useStore((s) => s.tps);
  const scale = useStore((s) => s.scale);
  const showCrit = useStore((s) => s.showCrit);
  const showWave = useStore((s) => s.showWave);
  const hasSel = useStore((s) => s.sel.comps.length > 0);
  const canBreak = useStore((s) => s.circuit.comps.some((c) => s.sel.comps.includes(c.id) && isBreakable(c, s.circuit.defs)));
  const canEdit = useStore((s) => s.sel.comps.length === 1 && s.circuit.comps.some((c) => c.id === s.sel.comps[0] && isBreakable(c, s.circuit.defs)));
  const editing = useStore((s) => !!s.editing);
  const theme = useStore((s) => s.theme);
  const selLabel = useStore((s) => {
    const n = s.sel.comps.length;
    if (n === 0) return s.sel.wires.length ? `${s.sel.wires.length} wire${s.sel.wires.length > 1 ? 's' : ''} selected` : 'Nothing selected';
    if (n > 1) return `${n} components selected`;
    const c = s.circuit.comps.find((x) => x.id === s.sel.comps[0]);
    if (!c) return '';
    const t = titleOf(c, s.circuit.defs);
    return c.name ? `${c.name} · ${t}` : t;
  });
  const st = useStore.getState;
  return {
    circuitName, circuitEmpty, canUndo, canRedo, tool, running, mode, tps, scale, showCrit, showWave, hasSel, canBreak, canEdit, editing, theme, selLabel,
    patch: useStore((s) => s.patch),
    setMode: useStore((s) => s.setMode),
    undo: useStore((s) => s.undo),
    redo: useStore((s) => s.redo),
    newCircuit: () => { if (st().circuit.comps.length === 0 || confirm('Start a new circuit? (You can undo this.)')) st().newCircuit(); },
    breakdown: () => st().breakdown(),
    editInternals: () => st().editInternals(),
  };
}
type Bar = ReturnType<typeof useBar>;

function Brand({ b, className = '' }: { b: Bar; className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg,#38bdf8,#818cf8)' }}>
        <CircuitBoard size={16} color="#04121c" />
      </div>
      <div className="leading-tight min-w-0 w-full">
        <div className="text-sm font-bold truncate">Logic Design Sim</div>
        <div className="text-[10px] truncate" style={{ color: b.editing ? '#d946ef' : 'var(--muted)' }} title={b.circuitName}>{b.editing ? 'Editing IC · ' : ''}{b.circuitName}</div>
      </div>
    </div>
  );
}

function RunButton({ b }: { b: Bar }) {
  return (
    <button className={`btn ${b.running ? 'pause' : 'run'} sq xl:w-[92px]!`} title={b.running ? 'Pause the simulation clock' : 'Run the simulation clock'} onClick={() => b.patch({ running: !b.running })}>
      {b.running ? <Pause size={14} /> : <Play size={14} />}
      {xl(b.running ? 'Pause' : 'Run')}
    </button>
  );
}

function SpeedControl({ b }: { b: Bar }) {
  const delay = b.mode === 'delay';
  return (
    <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--muted)' }} title={delay ? 'Ticks per second' : 'Clock speed multiplier'}>
      <span className="hidden 2xl:inline-block w-[46px]">{delay ? 'ticks/s' : 'speed'}</span>
      {delay
        ? <input type="range" min={1} max={120} value={b.tps} onChange={(e) => b.patch({ tps: +e.target.value })} className="w-20" aria-label="ticks per second" />
        : <input type="range" min={0.25} max={8} step={0.25} value={b.scale} onChange={(e) => b.patch({ scale: +e.target.value })} className="w-20" aria-label="clock speed" />}
      <span className="w-9 text-right tabular-nums" style={{ color: 'var(--text)' }}>{delay ? b.tps : b.scale + '×'}</span>
    </label>
  );
}

function ModeSwitch({ b, labels }: { b: Bar; labels?: boolean }) {
  return (
    <div className="flex rounded-md overflow-hidden shrink-0" style={{ border: '1px solid var(--border)' }} title="Instant: circuits settle immediately. Delay: realistic gate propagation delays.">
      <button className={`btn rounded-none! border-0! ${labels ? 'px-3!' : `sq ${WIDE}`} ${b.mode === 'instant' ? 'active' : ''}`} title="Instant mode" onClick={() => b.setMode('instant')}>
        <Zap size={13} />{labels ? ' Instant' : xxl('Instant')}
      </button>
      <button className={`btn rounded-none! border-0! ${labels ? 'px-3!' : `sq ${WIDE}`} ${b.mode === 'delay' ? 'active' : ''}`} title="Propagation-delay mode" onClick={() => b.setMode('delay')}>
        <Timer size={13} />{labels ? ' Delay' : xxl('Delay')}
      </button>
    </div>
  );
}

function SelectionTools({ b, onDone }: { b: Bar; onDone?: () => void }) {
  const d = (f: () => void) => () => { f(); onDone?.(); };
  return (
    <>
      <button className="btn" title="Truth table of the selected sub-circuit" disabled={!b.hasSel} onClick={d(() => b.patch({ dialog: 'tt' }))}><Table2 size={14} /> Truth table</button>
      <button className="btn" title={b.editing ? 'Not available while editing an IC' : 'Package the selection into a reusable IC'} disabled={!b.hasSel || b.editing} onClick={d(() => b.patch({ dialog: 'pkg' }))}><Package size={14} /> Package IC</button>
      <button className="btn" title="Delete the selected IC / complex part and put its internals on the canvas (B)" disabled={!b.canBreak} onClick={d(b.breakdown)}><Network size={14} /> Break down</button>
      <button className="btn" title="Open the internals of the selected IC for editing — a built-in part first becomes a custom IC (E)" disabled={!b.canEdit} onClick={d(b.editInternals)}><SquarePen size={14} /> Edit IC internals</button>
    </>
  );
}

function Desktop({ b }: { b: Bar }) {
  return (
    <div className="hidden lg:block">
      <div className="tb-row">
        <Brand b={b} className="w-[160px] 2xl:w-[200px]" />
        <div className="sep" />
        <button className="btn sq" title="New empty circuit" onClick={b.newCircuit}><FilePlus2 size={14} /></button>
        <button className="btn sq" title="Undo (Ctrl+Z)" disabled={!b.canUndo} onClick={b.undo}><Undo2 size={14} /></button>
        <button className="btn sq" title="Redo (Ctrl+Y)" disabled={!b.canRedo} onClick={b.redo}><Redo2 size={14} /></button>
        <div className="sep" />
        <button className={`btn sq ${b.tool === 'select' ? 'active' : ''}`} title="Select tool: drag the background to box-select" onClick={() => b.patch({ tool: 'select' })}><MousePointer2 size={14} /></button>
        <button className={`btn sq ${b.tool === 'pan' ? 'active' : ''}`} title="Pan tool (or hold Space / middle mouse)" onClick={() => b.patch({ tool: 'pan' })}><Hand size={14} /></button>
        <div className="sep" />
        <RunButton b={b} />
        <button className={`btn sq ${WIDE}`} title={b.mode === 'delay' ? 'Advance 1 tick (1 ns)' : 'Step the clock by half a period (one edge)'} onClick={() => simStep(false)}><StepForward size={14} />{xxl('Step')}</button>
        <button className={`btn sq ${WIDE}`} title={b.mode === 'delay' ? 'Advance one clock period' : 'Step one full clock cycle'} onClick={() => simStep(true)}><SkipForward size={14} />{xxl('Cycle')}</button>
        <button className={`btn sq ${WIDE}`} title="Reset all state (registers, latches, memory) and time" onClick={simReset}><RotateCcw size={14} />{xxl('Reset')}</button>
        <div className="sep" />
        <ModeSwitch b={b} />
        <SpeedControl b={b} />
        <div className="flex-1" />
        <button className="btn sq xl:w-auto! xl:px-2.5!" title="Example circuits" onClick={() => b.patch({ dialog: 'templates' })}><LayoutTemplate size={14} />{xl('Examples')}</button>
        <button className="btn sq xl:w-auto! xl:px-2.5!" title="Assembler for the toy CPU" onClick={() => b.patch({ dialog: 'asm' })}><Cpu size={14} />{xl('Assembler')}</button>
        <button className="btn sq xl:w-auto! xl:px-2.5!" title="Save, load and export" onClick={() => b.patch({ dialog: 'files' })}><FolderOpen size={14} />{xl('Save / Export')}</button>
        <button className="btn sq" title="Help" onClick={() => b.patch({ dialog: 'help' })}><HelpCircle size={15} /></button>
        <button className="btn sq" title="Toggle dark / light mode" onClick={() => b.patch({ theme: b.theme === 'dark' ? 'light' : 'dark' })}>{b.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
      </div>
      <div className="tb-row" style={{ borderTop: '1px solid var(--border)' }}>
        <button className={`btn ${b.showCrit ? 'active' : ''}`} title="Highlight the critical (longest delay) path" onClick={() => b.patch({ showCrit: !b.showCrit })}><Route size={14} /> Critical path</button>
        <button className={`btn ${b.showWave ? 'active' : ''}`} title="Timing diagram" onClick={() => b.patch({ showWave: !b.showWave })}><Activity size={14} /> Waveform</button>
        <div className="sep" />
        <SelectionTools b={b} />
        <div className="flex-1" />
        <div className="w-[220px] text-right text-[11px] truncate" style={{ color: 'var(--muted)' }} title={b.selLabel}>{b.selLabel}</div>
      </div>
    </div>
  );
}

function Compact({ b }: { b: Bar }) {
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  const go = (f: () => void) => () => { f(); setOpen(false); };
  return (
    <div className="lg:hidden relative z-40 safe-t">
      <div className="tb-row">
        <Brand b={b} className="flex-1 min-w-0 shrink!" />
        <button className="btn sq" title="Undo" disabled={!b.canUndo} onClick={b.undo}><Undo2 size={15} /></button>
        <button className="btn sq" title="Redo" disabled={!b.canRedo} onClick={b.redo}><Redo2 size={15} /></button>
        <button className={`btn ${b.running ? 'pause' : 'run'} sq`} title={b.running ? 'Pause' : 'Run'} onClick={() => b.patch({ running: !b.running })}>{b.running ? <Pause size={15} /> : <Play size={15} />}</button>
        <button className="btn sq" title="Step one clock edge" onClick={() => simStep(false)}><StepForward size={15} /></button>
        <button className={`btn sq ${open ? 'active' : ''}`} title="More" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={16} /> : <Ellipsis size={16} />}</button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={closeMenu} />
          <div className="absolute right-2 top-full mt-1 z-40 w-[min(24rem,calc(100vw-1rem))] max-h-[calc(100dvh-4.5rem)] overflow-y-auto rounded-xl shadow-2xl p-3 space-y-3" style={{ background: 'var(--panel2)', border: '1px solid var(--border)' }}>
            <div>
              <div className="label">Circuit</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button className="btn" onClick={go(b.newCircuit)}><FilePlus2 size={14} /> New</button>
                <button className="btn" onClick={go(() => b.patch({ dialog: 'templates' }))}><LayoutTemplate size={14} /> Examples</button>
                <button className="btn" onClick={go(() => b.patch({ dialog: 'asm' }))}><Cpu size={14} /> Assembler</button>
                <button className="btn" onClick={go(() => b.patch({ dialog: 'files' }))}><FolderOpen size={14} /> Save / Export</button>
              </div>
            </div>
            <div>
              <div className="label">Simulation</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button className="btn" onClick={() => simStep(true)}><SkipForward size={14} /> Cycle</button>
                <button className="btn" onClick={simReset}><RotateCcw size={14} /> Reset</button>
              </div>
              <div className="flex items-center justify-between gap-3 mt-2">
                <ModeSwitch b={b} labels />
                <SpeedControl b={b} />
              </div>
            </div>
            <div>
              <div className="label">View &amp; analysis</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button className={`btn ${b.showCrit ? 'active' : ''}`} onClick={() => b.patch({ showCrit: !b.showCrit })}><Route size={14} /> Critical path</button>
                <button className={`btn ${b.showWave ? 'active' : ''}`} onClick={go(() => b.patch({ showWave: !b.showWave }))}><Activity size={14} /> Waveform</button>
              </div>
            </div>
            <div>
              <div className="label">Selection · {b.selLabel}</div>
              <div className="grid grid-cols-2 gap-1.5"><SelectionTools b={b} onDone={closeMenu} /></div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button className="btn" onClick={go(() => b.patch({ dialog: 'help' }))}><HelpCircle size={14} /> Help</button>
              <button className="btn" onClick={() => b.patch({ theme: b.theme === 'dark' ? 'light' : 'dark' })}>{b.theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />} {b.theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function Toolbar() {
  const b = useBar();
  return (
    <header className="shrink-0" style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
      <Desktop b={b} />
      <Compact b={b} />
    </header>
  );
}
