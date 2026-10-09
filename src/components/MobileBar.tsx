import { Blocks, Hand, SlidersHorizontal, SquareDashedMousePointer } from 'lucide-react';
import { useStore } from '../lib/store';

/** Bottom navigation for screens too narrow to dock the side panels (below 1024px). */
export default function MobileBar() {
  const panel = useStore((s) => s.panel);
  const tool = useStore((s) => s.tool);
  const selCount = useStore((s) => s.sel.comps.length + s.sel.wires.length);
  const patch = useStore((s) => s.patch);
  const toggle = (p: 'palette' | 'props') => patch({ panel: panel === p ? null : p });

  return (
    <nav className="lg:hidden shrink-0 flex items-stretch gap-1.5 px-2 pt-1.5" style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)', paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }} aria-label="Panels and tools">
      <button className={`btn flex-1 ${panel === 'palette' ? 'active' : ''}`} onClick={() => toggle('palette')}><Blocks size={16} /> Parts</button>
      <div className="flex rounded-md overflow-hidden shrink-0" style={{ border: '1px solid var(--border)' }} role="group" aria-label="Touch tool">
        <button className={`btn rounded-none! border-0! ${tool === 'pan' ? 'active' : ''}`} title="One finger moves the canvas" onClick={() => patch({ tool: 'pan' })}><Hand size={16} /> Pan</button>
        <button className={`btn rounded-none! border-0! ${tool === 'select' ? 'active' : ''}`} title="One finger draws a selection box" onClick={() => patch({ tool: 'select' })}><SquareDashedMousePointer size={16} /> Select</button>
      </div>
      <button className={`btn flex-1 relative ${panel === 'props' ? 'active' : ''}`} onClick={() => toggle('props')}>
        <SlidersHorizontal size={16} /> Inspector
        {selCount > 0 && panel !== 'props' && <span className="absolute top-1 right-1.5 w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />}
      </button>
    </nav>
  );
}
