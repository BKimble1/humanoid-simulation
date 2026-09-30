/**
 * Time. Normally wall-clock; with ?virt=1 (test and recording harness only) every rendered
 * frame advances time by exactly 1/30 s and frames are rendered on request
 * (window.__fabAdvance(n)), so transitions can be captured frame by frame even on a slow
 * software renderer, and the capture runs at true speed.
 *
 * The clock stops while the page is hidden, so a camera move or a simulation resumes where it
 * was. Everything animated reads `time.now` (seconds) and `time.dt`, never three.js' clock.
 */
export const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
export const VIRTUAL_TIME = params.get('virt') === '1';
/** Test hooks (window.__fab*): in development, with ?virt=1, or with ?hooks=1. */
export const TEST_HOOKS = typeof window !== 'undefined' && (import.meta.env.DEV || VIRTUAL_TIME || params.get('hooks') === '1');
/** Recording: keep the drawing buffer for screenshots. */
export const CAPTURE = params.get('capture') === '1';

export const time = {
  virtual: VIRTUAL_TIME,
  /** Seconds since start (stopped while hidden). */
  now: 0,
  /** Duration of the current frame, s (clamped to 1/15 s so a stall never jumps a move). */
  dt: 1 / 60,
  /** The real interval since the previous frame, s (not clamped: what the visitor waited). */
  raw: 1 / 60,
  frame: 0,
  step: 1 / 30,
};

let last = typeof performance !== 'undefined' ? performance.now() : 0;
let hidden = typeof document !== 'undefined' ? document.hidden : false;
if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    last = performance.now();
  });

/** Advance the clock for one real-time frame. */
export function tickRealtime(): number {
  const t = performance.now();
  const raw = (t - last) / 1000;
  last = t;
  const dt = hidden ? 0 : Math.min(1 / 15, Math.max(0, raw));
  time.raw = hidden ? 0 : raw;
  time.dt = dt;
  time.now += dt;
  time.frame++;
  return dt;
}

/** Advance the clock by one virtual frame. */
export function tickVirtual(): number {
  time.raw = time.step;
  time.dt = time.step;
  time.now += time.step;
  time.frame++;
  return time.step;
}
