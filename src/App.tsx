import { useEffect } from 'react';
import { useStore, simFrame } from './lib/store';
import Toolbar from './components/Toolbar';
import MobileBar from './components/MobileBar';
import Palette from './components/Palette';
import Canvas from './components/Canvas';
import Properties from './components/Properties';
import Waveform from './components/Waveform';
import Dialogs from './components/Dialogs';

export default function App() {
  const theme = useStore((s) => s.theme);
  const showWave = useStore((s) => s.showWave);
  const toast = useStore((s) => s.toastMsg);
  const panel = useStore((s) => s.panel);

  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      simFrame(Math.min(now - last, 200));
      last = now;
    }, 33);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    document.documentElement.className = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', theme === 'dark' ? '#10192b' : '#ffffff');
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const st = useStore.getState();
      if (e.key === 'Escape') {
        if (st.dialog) st.patch({ dialog: null });
        else if (st.panel) st.patch({ panel: null });
        else st.setSel({ comps: [], wires: [] });
        return;
      }
      if (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || st.dialog) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === 'z') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); }
      else if (ctrl && k === 'y') { e.preventDefault(); st.redo(); }
      else if (ctrl && k === 'c') st.copy();
      else if (ctrl && k === 'x') { e.preventDefault(); st.cut(); }
      else if (ctrl && k === 'v') { e.preventDefault(); st.paste(); }
      else if (ctrl && k === 'd') { e.preventDefault(); st.copy(); st.paste(); }
      else if (ctrl && k === 'a') { e.preventDefault(); st.selectAll(); }
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); st.deleteSel(); }
      else if (k === 'r' && !ctrl) st.rotate();
      else if (k === 'b' && !ctrl && st.sel.comps.length) st.breakdown();
      else if (k === 'e' && !ctrl && st.sel.comps.length === 1) st.editInternals();
      else if (k.startsWith('arrow') && st.sel.comps.length) {
        e.preventDefault();
        const step = e.shiftKey ? 100 : 20;
        const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0;
        const dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
        const ids = new Set(st.sel.comps);
        st.commit((c) => ({ ...c, comps: c.comps.map((x) => (ids.has(x.id) ? { ...x, x: x.x + dx, y: x.y + dy } : x)) }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [theme]);

  const closePanel = () => useStore.getState().patch({ panel: null });

  return (
    <div className={`${theme} h-full flex flex-col`} style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <Toolbar />
      <div className="flex-1 flex min-h-0 relative">
        <aside className={`drawer drawer-left ${panel === 'palette' ? 'open' : ''} lg:w-52 xl:w-64 lg:shrink-0`} aria-label="Component palette"><Palette /></aside>
        <main className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0"><Canvas /></div>
          {showWave && <div className="h-[min(230px,38%)] min-h-[150px] shrink-0"><Waveform /></div>}
        </main>
        <aside className={`drawer drawer-right ${panel === 'props' ? 'open' : ''} lg:w-60 xl:w-72 lg:shrink-0`} aria-label="Properties"><Properties /></aside>
        {panel && <div className="fixed inset-0 z-30 lg:hidden" style={{ background: 'rgba(2,6,15,.55)' }} onClick={closePanel} />}
      </div>
      <MobileBar />
      <Dialogs />
      {toast && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-[70] max-w-[calc(100vw-1.5rem)] px-4 py-2 rounded-lg text-sm shadow-xl text-center" style={{ background: 'var(--panel2)', border: '1px solid var(--accent)' }} role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
