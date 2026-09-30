import { Vector2 } from 'three';
import { describe, expect, it } from 'vitest';
import { PushRecovery, clampToPolygon, convexHull, defaultRecoveryParams, footPolygon, signedDistance } from './balance';

describe('support polygon geometry', () => {
  it('builds the hull of two feet and measures signed distance', () => {
    const hull = convexHull([...footPolygon(0.09, 0), ...footPolygon(-0.09, 0)]);
    expect(hull.length).toBe(4);
    expect(signedDistance(hull, new Vector2(0, 0.05))).toBeGreaterThan(0.05);
    expect(signedDistance(hull, new Vector2(0, 0.3))).toBeLessThan(0);
    const c = clampToPolygon(hull, new Vector2(0, 0.5), 0.01);
    expect(signedDistance(hull, c)).toBeGreaterThanOrEqual(0.0099);
  });
});

function run(forceN: number, dir: Vector2) {
  const r = new PushRecovery(defaultRecoveryParams(63));
  r.step(0.5);
  r.push({ force: dir.clone().normalize().multiplyScalar(forceN), duration: 0.15, height: 1.2 });
  let maxSteps = 0;
  for (let t = 0; t < 8; t += 0.01) {
    r.step(0.01);
    maxSteps = Math.max(maxSteps, r.s.steps);
  }
  return { r, used: r.s.used, steps: maxSteps };
}

describe('push recovery', () => {
  it('absorbs a small push with the ankles alone', () => {
    const { used, r } = run(80, new Vector2(0, 1));
    expect(used.has('ankle')).toBe(true);
    expect(used.has('hip')).toBe(false);
    expect(used.has('step')).toBe(false);
    expect(r.s.v.length()).toBeLessThan(0.02);
  });

  it('adds the hip strategy for a medium push', () => {
    const { used } = run(240, new Vector2(0, 1));
    expect(used.has('hip')).toBe(true);
  });

  it('steps for a large push and comes back to rest', () => {
    const { used, steps, r } = run(420, new Vector2(0, 1));
    expect(used.has('step')).toBe(true);
    expect(steps).toBeGreaterThanOrEqual(1);
    expect(r.s.v.length()).toBeLessThan(0.05);
    expect(r.s.margin).toBeGreaterThan(0);
  });

  it('steps sideways with the foot on the side of a lateral push', () => {
    const r = new PushRecovery(defaultRecoveryParams(63));
    r.push({ force: new Vector2(400, 0), duration: 0.15, height: 1.2 });
    let movedL = false;
    for (let t = 0; t < 2; t += 0.01) {
      r.step(0.01);
      if (!r.s.feet.L.down) movedL = true;
    }
    expect(movedL).toBe(true);
  });

  it('never lets the centre of pressure leave the support polygon', () => {
    const r = new PushRecovery(defaultRecoveryParams(63));
    r.push({ force: new Vector2(0, -300), duration: 0.15, height: 1.2 });
    for (let t = 0; t < 4; t += 0.005) {
      r.step(0.005);
      if (r.s.support.length >= 3) expect(signedDistance(r.s.support, r.s.cop)).toBeGreaterThan(-1e-6);
    }
  });
});
