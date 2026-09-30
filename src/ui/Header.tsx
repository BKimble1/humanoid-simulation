/**
 * The header: the FAB / ONE wordmark (inside the site, a link back to its homepage), the
 * three ways in (Explore, Engineer, Simulate), and quiet controls: Watch, overlays, sound,
 * technical information.
 */
import { useApp, type Mode } from '../state/store';

const SITE_HOME = import.meta.env.VITE_FABONE_HOME;

const BackIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
    <path d="M9.5 3.5 5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const PlayIcon = ({ size = 10 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
    <path d="M3 1.6 L10.4 6 L3 10.4 Z" fill="currentColor" />
  </svg>
);

const EyeIcon = ({ off }: { off?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    {off && <path d="M2.5 13.5 13.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
  </svg>
);

const SoundIcon = ({ off }: { off?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    {off ? <path d="M11 6l3 4M14 6l-3 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /> : <path d="M11 5.5c1.2 1.4 1.2 3.6 0 5M12.8 4c2 2.3 2 5.7 0 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
  </svg>
);

const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8 7.2V11M8 5v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export function Wordmark() {
  const go = useApp((s) => s.go);
  if (SITE_HOME)
    return (
      <a className="wordmark pe" href={SITE_HOME} aria-label="Back to FAB / ONE" title="Back to FAB / ONE">
        <BackIcon />
        <span>
          FAB<span className="slash">/</span>ONE
        </span>
      </a>
    );
  return (
    <button className="wordmark pe" onClick={() => go({ mode: 'intro' })} aria-label="FAB / ONE, Humanoid home">
      FAB<span className="slash">/</span>ONE
    </button>
  );
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'explore', label: 'Explore' },
  { id: 'engineer', label: 'Engineer' },
  { id: 'simulate', label: 'Simulate' },
];

export function Header() {
  const mode = useApp((s) => s.mode);
  const go = useApp((s) => s.go);
  const overlays = useApp((s) => s.overlays);
  const sound = useApp((s) => s.sound);
  const set = useApp((s) => s.set);
  return (
    <header className="top">
      <div className="top__left">
        <Wordmark />
        <button className="top__sim pe" onClick={() => go({ mode: 'intro' })} style={{ background: 'none', border: 0, borderLeft: '1px solid var(--line-2)', cursor: 'pointer' }} aria-label="Humanoid: back to the start">
          <b>HUMANOID</b>
          <span className="top__model">FO-H1</span>
        </button>
      </div>
      <nav className="tabs pe" aria-label="Modes">
        {MODES.map((m) => (
          <button key={m.id} className="tab" aria-current={mode === m.id ? 'page' : undefined} onClick={() => go({ mode: m.id, ...(m.id === 'simulate' ? { lab: 'hub' } : {}), ...(m.id === 'explore' ? { system: 'overview' } : {}) })}>
            {m.label}
          </button>
        ))}
      </nav>
      <div className="top__right">
        <button className="watch pe" onClick={() => go({ mode: 'watch' })} aria-label="Watch the guided tour">
          <span className="watch__dot">
            <PlayIcon />
          </span>
          <span className="watch__text">Watch</span>
        </button>
        <button className="ibtn pe" aria-pressed={overlays} onClick={() => set({ overlays: !overlays })} title={overlays ? 'Hide overlays' : 'Show overlays'} aria-label={overlays ? 'Hide overlays' : 'Show overlays'}>
          <EyeIcon off={!overlays} />
        </button>
        <button className="ibtn pe" aria-pressed={sound} onClick={() => set({ sound: !sound })} title={sound ? 'Sound off' : 'Sound on'} aria-label={sound ? 'Turn sound off' : 'Turn sound on'}>
          <SoundIcon off={!sound} />
        </button>
        <button className="ibtn pe" onClick={() => set({ info: true })} title="About this simulation" aria-label="About this simulation: what is calculated, estimated and approximated">
          <InfoIcon />
        </button>
      </div>
    </header>
  );
}
