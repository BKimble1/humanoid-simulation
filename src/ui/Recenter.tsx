/**
 * A quiet way back to the directed framing, shown only while the visitor has orbited or
 * zoomed away from it. The camera returns smoothly from where it is.
 */
import { useApp } from '../state/store';
import type { World } from '../world/world';

export function Recenter({ world }: { world: World }) {
  const off = useApp((s) => s.offFraming);
  const mode = useApp((s) => s.mode);
  if (!off || mode === 'intro' || mode === 'watch') return null;
  return (
    <button type="button" className="recenter pe" onClick={() => world.director.recenter()} aria-label="Recenter the view">
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="2.2" fill="currentColor" />
        <path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      </svg>
      <span>Recenter</span>
    </button>
  );
}
