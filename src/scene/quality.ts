/**
 * Rendering quality: three tiers chosen from the device, lowered (or raised back) from measured
 * frame times. A tier changes only how the picture is drawn (pixel ratio, shadow map size,
 * ambient occlusion, bloom), never what is shown or when.
 *
 * ?quality=high|medium|low forces a tier (tests, captures). Software renderers (SwiftShader,
 * llvmpipe) start at low.
 */
import { create } from 'zustand';

export type Tier = 'high' | 'medium' | 'low';

export interface TierSpec {
  dprMax: number;
  shadowMap: number;
  ao: boolean;
  bloom: boolean;
  msaa: number;
  /** N8AO quality preset. */
  aoQuality: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';
}

/**
 * What each tier costs. Medium keeps every effect a visitor would miss (ambient occlusion,
 * bloom) but at lower quality and resolution: about half of high's fill. Low draws directly with
 * tone mapping only. No tier removes anything that explains the machine.
 */
export const TIERS: Record<Tier, TierSpec> = {
  high: { dprMax: 2, shadowMap: 2048, ao: true, bloom: true, msaa: 4, aoQuality: 'Medium' },
  medium: { dprMax: 1.25, shadowMap: 1024, ao: true, bloom: true, msaa: 2, aoQuality: 'Low' },
  low: { dprMax: 1, shadowMap: 1024, ao: false, bloom: false, msaa: 0, aoQuality: 'Performance' },
};

const ORDER: Tier[] = ['low', 'medium', 'high'];
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
export const FORCED: Tier | null = (() => {
  const q = params.get('quality');
  return q === 'high' || q === 'medium' || q === 'low' ? q : null;
})();

export function initialTier(renderer: string, cores: number, memoryGB: number | undefined, touch: boolean, dpr: number): Tier {
  if (FORCED) return FORCED;
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)) return 'low';
  if (cores <= 2 || (memoryGB !== undefined && memoryGB <= 2)) return 'low';
  if (touch && dpr >= 2) return 'medium';
  if (cores <= 4 && memoryGB !== undefined && memoryGB <= 4) return 'medium';
  return 'high';
}

interface QualityState {
  tier: Tier;
  reason: string;
  renderer: string;
}

export const useQuality = create<QualityState>(() => ({ tier: FORCED ?? 'high', reason: FORCED ? 'forced by ?quality' : 'default', renderer: '' }));

export function stepTier(dir: -1 | 1, reason: string) {
  if (FORCED) return;
  const cur = useQuality.getState().tier;
  const i = Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(cur) + dir));
  if (ORDER[i] !== cur) useQuality.setState({ tier: ORDER[i], reason });
}

/**
 * Frame-time monitor: steps the tier down when frames are slow for a sustained stretch and up
 * again when there is lasting headroom. It reads the real interval between frames (not the
 * simulation step, which is clamped), ignores the first seconds (loading, shader warm-up) and
 * the seconds after a change of tier (the pipeline is rebuilt), and never makes more than three
 * changes in a session (no flip-flopping).
 */
export class FrameMonitor {
  private samples: number[] = [];
  private changes = 0;
  private cooldown = 3;
  update(dt: number) {
    if (FORCED || this.changes >= 3 || !(dt > 0)) return;
    // a hidden tab or a debugger pause is not a slow frame
    if (dt > 1) return;
    this.cooldown -= dt;
    this.samples.push(dt);
    if (this.samples.length < 90) return;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.samples = [];
    if (this.cooldown > 0) return;
    if (median > 1 / 38) {
      stepTier(-1, `median frame ${(median * 1000).toFixed(0)} ms`);
      this.changes++;
      this.cooldown = 4;
    } else if (median < 1 / 58 && useQuality.getState().tier !== 'high' && this.changes === 0) {
      stepTier(1, 'headroom');
      this.changes++;
      this.cooldown = 6;
    }
  }
}

/**
 * Frame intervals as the visitor experiences them (developer statistics: median, p95, stalls).
 * A ring of the last few thousand real intervals.
 */
export class FrameStats {
  private ring = new Float32Array(4096);
  private n = 0;
  private i = 0;

  push(dt: number) {
    if (!(dt > 0) || dt > 5) return;
    this.ring[this.i] = dt;
    this.i = (this.i + 1) % this.ring.length;
    this.n = Math.min(this.ring.length, this.n + 1);
  }

  reset() {
    this.n = 0;
    this.i = 0;
  }

  summary(): { frames: number; medianMs: number; p95Ms: number; maxMs: number; stalls100: number; stalls250: number } {
    const a = Array.from(this.ring.subarray(0, this.n)).sort((x, y) => x - y);
    const q = (p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] * 1000 : 0);
    return { frames: a.length, medianMs: q(0.5), p95Ms: q(0.95), maxMs: a.length ? a[a.length - 1] * 1000 : 0, stalls100: a.filter((x) => x > 0.1).length, stalls250: a.filter((x) => x > 0.25).length };
  }
}
