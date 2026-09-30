/**
 * The guided tour's caption bar: chapter, caption, progress, and quiet controls. The tour
 * itself runs in the world (world/tourRunner.ts); this only shows where it is.
 */
import { useEffect } from 'react';
import { useApp } from '../../state/store';
import { CAPTION_AT, TOUR, TOUR_LENGTH } from '../../world/tour';
import type { World } from '../../world/world';

const Icon = ({ d }: { d: string }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
    <path d={d} fill="currentColor" />
  </svg>
);

/** A number stays on the same line as its unit ("260 Nm"). */
const keepUnits = (text: string) => text.replace(/(\d) (?=(?:Nm|kg|kWh|W|V|Hz|kHz|m\/s|mm|cm|m|N|A|ms|s|h|°C)\b)/g, '$1\u00a0');

export function WatchPlayer({ world }: { world: World }) {
  const tour = useApp((s) => s.tour);
  const go = useApp((s) => s.go);
  const t = world.tour;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') go({ mode: 'intro' });
      else if (e.key === ' ') {
        e.preventDefault();
        t.toggle();
      } else if (e.key === 'ArrowRight') t.next();
      else if (e.key === 'ArrowLeft') t.prev();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [go, t]);
  if (!tour) return null;
  const c = TOUR[tour.index];
  if (!c) return null;
  const before = TOUR.slice(0, tour.index).reduce((s, x) => s + x.duration, 0);
  // establish, then explain: the caption follows its subject onto the screen (and is there at
  // once for a visitor who paused to read)
  const captioned = tour.paused || tour.t >= (c.captionAt ?? CAPTION_AT);
  return (
    <div className="watchbar pe" role="region" aria-label="Guided tour">
      <div className="watchbar__text" key={c.id}>
        <p className="eyebrow">
          Tour · {String(tour.index + 1).padStart(2, '0')} / {TOUR.length} · {c.title}
        </p>
        <p className={`watchbar__caption ${captioned ? 'watchbar__caption--in' : ''}`} aria-live="polite">
          {keepUnits(c.caption)}
        </p>
      </div>
      <div className="watchbar__controls">
        <button className="ibtn" onClick={() => t.prev()} aria-label="Previous chapter" title="Previous (←)">
          <Icon d="M4 3h1.6v10H4zM13 3.5v9L6.5 8z" />
        </button>
        <button className="ibtn" onClick={() => t.toggle()} aria-label={tour.paused ? 'Play' : 'Pause'} title="Pause / play (space)">
          {tour.paused ? <Icon d="M4.5 2.8 13 8l-8.5 5.2z" /> : <Icon d="M4 3h2.8v10H4zM9.2 3H12v10H9.2z" />}
        </button>
        <button className="ibtn" onClick={() => t.next()} aria-label="Next chapter" title="Next (→)">
          <Icon d="M10.4 3H12v10h-1.6zM3 3.5v9L9.5 8z" />
        </button>
        <button className="ibtn" onClick={() => go({ mode: 'explore', system: 'overview' })} aria-label="Leave the tour" title="Leave the tour (Esc)">
          <Icon d="M3.6 2.5 8 6.9l4.4-4.4 1.1 1.1L9.1 8l4.4 4.4-1.1 1.1L8 9.1l-4.4 4.4-1.1-1.1L6.9 8 2.5 3.6z" />
        </button>
      </div>
      <div className="watchbar__track" aria-hidden>
        {TOUR.map((x, i) => (
          <span key={x.id} className="watchbar__seg" style={{ flexGrow: x.duration }}>
            <i style={{ width: i < tour.index ? '100%' : i === tour.index ? `${Math.min(100, (tour.t / x.duration) * 100)}%` : '0%' }} />
          </span>
        ))}
      </div>
      <span className="watchbar__time num" aria-hidden>
        {fmt(before + tour.t)} / {fmt(TOUR_LENGTH)}
      </span>
    </div>
  );
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
