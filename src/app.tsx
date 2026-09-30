/**
 * The application shell: the canvas (the world draws into it), the loading veil, and the
 * interface layer for the current mode. The world is created once and lives as long as the
 * page; the interface talks to it only through the app store.
 */
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BODY_DOF } from './spec/body';
import { syncAddress, useApp } from './state/store';
import './styles/app.css';
import { Header } from './ui/Header';
import { Intro } from './ui/Intro';
import { Panels } from './ui/Panels';
import { Recenter } from './ui/Recenter';
import type { World } from './world/world';

function Stage({ onWorld }: { onWorld: (w: World) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const set = useApp((s) => s.set);
  useEffect(() => {
    const canvas = ref.current!;
    let world: World | null = null;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      // fonts first (labels and markings are drawn with them), then the 3D chunk
      await document.fonts?.ready;
      const { World } = await import('./world/world');
      if (disposed) return;
      world = new World(canvas);
      const resize = () => world!.resize(canvas.clientWidth, canvas.clientHeight);
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(canvas);
      const ok = await world.init((p) => set({ progress: p }));
      if (!ok || disposed) return;
      world.start();
      onWorld(world);
      set({ ready: true });
    })().catch((e) => {
      console.error(e);
      set({ progress: -1 });
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      world?.dispose();
    };
  }, [set, onWorld]);
  return <canvas ref={ref} className="stage stage--grab" aria-label="FO-H1 in the test lab: drag to look around" tabIndex={-1} />;
}

function Veil() {
  const progress = useApp((s) => s.progress);
  const ready = useApp((s) => s.ready);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setGone(true), 1000);
    return () => clearTimeout(t);
  }, [ready]);
  if (gone) return null;
  return (
    <div className={`veil ${ready ? 'veil--done' : ''}`} role="status" aria-live="polite">
      <div className="veil__box">
        <span className="wordmark" style={{ cursor: 'default' }}>
          FAB<span className="slash">/</span>ONE
        </span>
        <div className="veil__bar">
          <div className="veil__fill" style={{ width: `${Math.max(4, progress * 100)}%` }} />
        </div>
        <span className="veil__text">{progress < 0 ? 'This device could not start the 3D view (WebGL 2 is needed).' : progress < 0.5 ? 'Building FO-H1…' : 'Preparing the lab…'}</span>
      </div>
    </div>
  );
}

function App() {
  const mode = useApp((s) => s.mode);
  const [world, setWorld] = useState<World | null>(null);
  const ready = useApp((s) => s.ready);
  return (
    <div className="app">
      <Stage onWorld={setWorld} />
      <div className="ui">
        {ready && <Header />}
        {ready && mode === 'intro' && <Intro mass={world?.model.robotMass ?? 66} dof={BODY_DOF} />}
        {ready && world && <Panels world={world} />}
        {ready && world && <Recenter world={world} />}
      </div>
      <Veil />
    </div>
  );
}

export function mount(el: HTMLElement) {
  syncAddress();
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
