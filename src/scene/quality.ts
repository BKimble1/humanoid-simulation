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
}

export const TIERS: Record<Tier, TierSpec> = {
  high: { dprMax: 2, shadowMap: 2048, ao: true, bloom: true, msaa: 4 },
  medium: { dprMax: 1.5, shadowMap: 2048, ao: true, bloom: true, msaa: 4 },
  low: { dprMax: 1, shadowMap: 1024, ao: false, bloom: false, msaa: 0 },
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
 * again when there is lasting headroom. Never more than three changes in a session (no
 * flip-flopping).
 */
export class FrameMonitor {
  private samples: number[] = [];
  private changes = 0;
  private cooldown = 3;
  update(dt: number) {
    if (FORCED || this.changes >= 3) return;
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
