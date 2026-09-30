import { Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GAITS } from '../spec/motion';
import { signedDistance } from './balance';
import { GaitGenerator, type SideKey } from './gait';
import { PreviewAxis, previewGains } from './preview';

describe('ZMP preview control', () => {
  it('moves the COM to a new ZMP reference and tracks it without steady-state error', () => {
    const g = previewGains(0.01, 0.93);
    const ax = new PreviewAxis(g);
    ax.reset(0);
    const ref = (k: number) => (k >= 100 ? 0.1 : 0);
    let k = 0;
    for (; k < 400; k++) ax.step((j) => ref(k + j));
    expect(ax.x[0]).toBeCloseTo(0.1, 3);
    expect(ax.zmp).toBeCloseTo(0.1, 3);
  });

  it('starts moving the COM before the reference changes (it previews)', () => {
    const g = previewGains(0.01, 0.93);
    const ax = new PreviewAxis(g);
    for (let k = 0; k < 99; k++) ax.step((j) => (k + j >= 100 ? 0.1 : 0));
    // the COM leans the opposite way first (the ZMP must move ahead of it) and is moving
    expect(Math.abs(ax.x[1])).toBeGreaterThan(0.01);
  });
});

function walk(gait = GAITS.normal, seconds = 6) {
  const gen = new GaitGenerator();
  gen.walk(gait);
  const frames: { t: number; L: Vector3; R: Vector3; Lc: string; Rc: string; zmp: Vector3; com: Vector3; poly: Vector2[] }[] = [];
  for (let i = 0; i < seconds * 100; i++) {
    gen.tick();
    const f = gen.frame;
    frames.push({ t: f.t, L: f.feet.L.ankle.clone(), R: f.feet.R.ankle.clone(), Lc: f.feet.L.contact, Rc: f.feet.R.contact, zmp: f.zmp.clone(), com: f.com.clone(), poly: f.polygon });
  }
  return { gen, frames };
}

describe('walking pattern', () => {
  it('walks at the gait speed on average', () => {
    const { frames } = walk(GAITS.normal, 8);
    const a = frames[300];
    const b = frames[700];
    const v = (b.com.z - a.com.z) / (b.t - a.t);
    expect(v).toBeGreaterThan(GAITS.normal.speed * 0.9);
    expect(v).toBeLessThan(GAITS.normal.speed * 1.1);
  });

  it('never slides a flat foot on the ground', () => {
    const { frames } = walk(GAITS.fast, 6);
    for (const s of ['L', 'R'] as SideKey[]) {
      for (let i = 1; i < frames.length; i++) {
        const c0 = s === 'L' ? frames[i - 1].Lc : frames[i - 1].Rc;
        const c1 = s === 'L' ? frames[i].Lc : frames[i].Rc;
        if (c0 === 'flat' && c1 === 'flat') {
          const d = (s === 'L' ? frames[i].L : frames[i].R).distanceTo(s === 'L' ? frames[i - 1].L : frames[i - 1].R);
          expect(d).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('keeps the ZMP inside the contact polygon (within a few millimetres)', () => {
    const { frames } = walk(GAITS.normal, 6);
    let worst = 0;
    for (const f of frames.slice(20)) {
      if (f.poly.length < 3) continue;
      worst = Math.min(worst, signedDistance(f.poly, new Vector2(f.zmp.x, f.zmp.z)));
    }
    expect(worst).toBeGreaterThan(-0.01);
  });

  it('keeps the swing foot above the ground', () => {
    const { frames } = walk(GAITS.fast, 5);
    for (const f of frames) {
      expect(f.L.y).toBeGreaterThan(0.06);
      expect(f.R.y).toBeGreaterThan(0.06);
    }
  });

  it('stops with the feet side by side and the COM between them', () => {
    const gen = new GaitGenerator();
    gen.walk(GAITS.normal);
    for (let i = 0; i < 300; i++) gen.tick();
    gen.stop();
    for (let i = 0; i < 500; i++) gen.tick();
    const f = gen.frame;
    expect(f.walking).toBe(false);
    expect(Math.abs(f.feet.L.ankle.z - f.feet.R.ankle.z)).toBeLessThan(1e-6);
    const mid = (f.feet.L.ankle.z + f.feet.R.ankle.z) / 2;
    expect(Math.abs(f.com.z - mid - 0.03)).toBeLessThan(0.01);
    expect(Math.abs(f.comVel.z)).toBeLessThan(0.01);
  });
});
