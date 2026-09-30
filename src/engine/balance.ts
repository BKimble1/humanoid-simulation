/**
 * Balance: support polygon, stability margin, the linear inverted pendulum (LIPM), the capture
 * point, and a push-recovery controller that escalates from the ankle strategy to the hip
 * strategy to stepping.
 *
 *   LIPM            c̈ = ω²·(c − p) + F_ext/m,      ω = √(g / z_c)
 *   ZMP / CoP       p = c − c̈/ω²                   (must stay inside the support polygon)
 *   capture point   ξ = c + ċ/ω                    (where to put the CoP to come to rest)
 *   DCM dynamics    ξ̇ = ω·(ξ − p)                  (ξ runs away from p: balance = keep p ahead of it)
 *   hip strategy    a torso "flywheel" moment τ moves the centroidal moment pivot (CMP) by τ/(m·g)
 *                   beyond the foot, for as long as the torso can rotate
 *   stepping        when ξ leaves what the ankle and hip can cover, a foot is placed at ξ
 *
 * Horizontal plane only, constant COM height, point feet contact modelled as polygons: a
 * reduced-order model in the tradition of Kajita (2001), Pratt et al. (2006) and Stephens
 * (2007). It is not a whole-body dynamics simulation; see ENGINEERING.md.
 */
import { Vector2 } from 'three';
import { DIM } from '../spec/body';
import { GRAVITY, LOCOMOTION } from '../spec/motion';

export type P2 = Vector2;

/** Convex hull (Andrew's monotone chain), counter-clockwise, of 2-D points (x, z). */
export function convexHull(points: P2[]): P2[] {
  const pts = points.map((p) => p.clone()).sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Signed distance from p to the polygon boundary: positive inside, negative outside. */
export function signedDistance(poly: P2[], p: P2): number {
  if (poly.length === 0) return -Infinity;
  if (poly.length === 1) return -p.distanceTo(poly[0]);
  let minD = Infinity;
  let inside = poly.length >= 3;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
    const dx = p.x - (a.x + t * ex);
    const dy = p.y - (a.y + t * ey);
    minD = Math.min(minD, Math.hypot(dx, dy));
    // CCW polygon: inside if left of every edge
    if (ex * (p.y - a.y) - ey * (p.x - a.x) < 0) inside = false;
  }
  return inside ? minD : -minD;
}

/** The closest point to p inside the polygon shrunk by `margin` (p itself if already inside). */
export function clampToPolygon(poly: P2[], p: P2, margin = 0): P2 {
  const d = signedDistance(poly, p);
  if (d >= margin) return p.clone();
  // project onto the boundary, then pull inwards towards the centroid by the margin
  let best = p.clone();
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
    const q = new Vector2(a.x + t * ex, a.y + t * ey);
    const dd = q.distanceTo(p);
    if (dd < bestD) (bestD = dd), (best = q);
  }
  const c = centroid(poly);
  const dir = c.clone().sub(best);
  const len = dir.length();
  if (len > 1e-9) best.addScaledVector(dir, Math.min(margin, len * 0.9) / len);
  return best;
}

export function centroid(poly: P2[]): P2 {
  const c = new Vector2();
  for (const p of poly) c.add(p);
  return c.divideScalar(Math.max(1, poly.length));
}

/** Sole rectangle of a foot at (x, z) with heading yaw (rad), as four ground points. */
export function footPolygon(x: number, z: number, yaw = 0): P2[] {
  const w = DIM.footWidth / 2;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pts: [number, number][] = [
    [-w, DIM.heel],
    [w, DIM.heel],
    [w, DIM.toe],
    [-w, DIM.toe],
  ];
  // the robot faces +Z; yaw about +Y turns +Z towards +X
  return pts.map(([lx, lz]) => new Vector2(x + lx * c + lz * s, z - lx * s + lz * c));
}

export const lipmOmega = (zc = LOCOMOTION.comHeight) => Math.sqrt(GRAVITY / zc);

export function capturePoint(c: P2, v: P2, omega: number, out = new Vector2()): P2 {
  return out.copy(v).divideScalar(omega).add(c);
}

// ───────────────────────────── push recovery ─────────────────────────────

export type Strategy = 'stand' | 'ankle' | 'hip' | 'step' | 'settle' | 'fail';

export interface Foot {
  pos: P2;
  yaw: number;
  /** In contact with the ground. */
  down: boolean;
  /** Swing: start, target and progress 0–1. */
  from: P2;
  to: P2;
  t: number;
  duration: number;
  /** Swing height profile peak, m. */
  lift: number;
}

export interface PushEvent {
  /** Force on the torso in the horizontal plane (x lateral, y = forward/back along Z), N. */
  force: P2;
  duration: number;
  /** Height of application above the ground, m (for the arrow). */
  height: number;
}

export interface RecoveryState {
  t: number;
  c: P2;
  v: P2;
  xi: P2;
  /** Centre of pressure (ZMP) and centroidal moment pivot. */
  cop: P2;
  cmp: P2;
  strategy: Strategy;
  /** Every strategy used so far in this push. */
  used: Set<Strategy>;
  feet: { L: Foot; R: Foot };
  support: P2[];
  /** Stability margin: signed distance of the capture point to the support polygon, m. */
  margin: number;
  /** Torso flywheel angle (hip strategy), rad, and its rate. */
  torso: number;
  torsoRate: number;
  /** Moment the hip strategy applies now, Nm. */
  hipMoment: number;
  /** External force acting now, N. */
  push: P2;
  steps: number;
  /** A step the recovery would need but the robot cannot take. */
  failed: string | null;
}

export interface RecoveryParams {
  mass: number;
  zc: number;
  maxStep: number;
  stepTime: number;
  hipTorque: number;
  hipTime: number;
  /** Torso pitch inertia about the hip, kg·m². */
  torsoInertia: number;
  /** Torso rotation allowed for the hip strategy, rad. */
  torsoLimit: number;
  margin: number;
  /** DCM feedback gain, 1/s. */
  k: number;
}

export function defaultRecoveryParams(mass: number): RecoveryParams {
  return {
    mass,
    zc: LOCOMOTION.comHeight,
    maxStep: LOCOMOTION.maxStep,
    stepTime: LOCOMOTION.minStepTime + 0.08,
    hipTorque: LOCOMOTION.hipStrategyTorque,
    hipTime: LOCOMOTION.hipStrategyTime,
    torsoInertia: 3.2,
    torsoLimit: 0.45,
    margin: LOCOMOTION.copMargin,
    k: 2.2,
  };
}

function newFoot(x: number, z: number): Foot {
  const p = new Vector2(x, z);
  return { pos: p.clone(), yaw: 0, down: true, from: p.clone(), to: p.clone(), t: 1, duration: 0.4, lift: 0.06 };
}

/**
 * A push-recovery simulation, stepped at a fixed rate. The feet start side by side at the
 * nominal stance; the COM starts over their centre, at rest.
 */
export class PushRecovery {
  p: RecoveryParams;
  s: RecoveryState;
  private pushLeft = 0;
  private pushForce = new Vector2();
  private hipLeft = 0;
  /** Direction of the current hip-strategy moment in the ground plane (x, z). */
  hipDir = new Vector2();
  private home: { L: P2; R: P2 };
  private settleTime = 0;

  constructor(p: RecoveryParams, stance = DIM.hipHalfWidth) {
    this.p = p;
    this.home = { L: new Vector2(stance, 0), R: new Vector2(-stance, 0) };
    const c = new Vector2(0, (DIM.heel + DIM.toe) / 2 - 0.03);
    this.s = {
      t: 0,
      c,
      v: new Vector2(),
      xi: c.clone(),
      cop: c.clone(),
      cmp: c.clone(),
      strategy: 'stand',
      used: new Set(),
      feet: { L: newFoot(stance, 0), R: newFoot(-stance, 0) },
      support: [],
      margin: 0,
      torso: 0,
      torsoRate: 0,
      hipMoment: 0,
      push: new Vector2(),
      steps: 0,
      failed: null,
    };
    this.updateSupport();
  }

  get omega() {
    return Math.sqrt(GRAVITY / this.p.zc);
  }

  /** Where the COM rests when standing (over the middle of the feet, slightly behind centre). */
  restCom(): P2 {
    const L = this.s.feet.L.pos;
    const R = this.s.feet.R.pos;
    return new Vector2((L.x + R.x) / 2, (L.y + R.y) / 2 + (DIM.heel + DIM.toe) / 2 - 0.03);
  }

  push(e: PushEvent) {
    this.pushLeft = e.duration;
    this.pushForce.copy(e.force);
    this.s.used = new Set();
    this.s.steps = 0;
    this.s.failed = null;
  }

  private updateSupport() {
    const pts: P2[] = [];
    for (const f of [this.s.feet.L, this.s.feet.R]) if (f.down) pts.push(...footPolygon(f.pos.x, f.pos.y, f.yaw));
    this.s.support = convexHull(pts);
  }

  /** Advance by dt (internally sub-stepped at 1 kHz). */
  step(dt: number) {
    const n = Math.max(1, Math.round(dt / 0.001));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.tick(h);
  }

  private tick(h: number) {
    const s = this.s;
    const p = this.p;
    const w = this.omega;
    s.t += h;
    // external force
    if (this.pushLeft > 0) {
      s.push.copy(this.pushForce);
      this.pushLeft -= h;
    } else s.push.set(0, 0);

    // swing feet
    for (const f of [s.feet.L, s.feet.R]) {
      if (f.down) continue;
      f.t = Math.min(1, f.t + h / f.duration);
      const u = f.t * f.t * f.t * (10 - 15 * f.t + 6 * f.t * f.t);
      f.pos.lerpVectors(f.from, f.to, u);
      if (f.t >= 1) {
        f.down = true;
        f.pos.copy(f.to);
        this.updateSupport();
      }
    }

    capturePoint(s.c, s.v, w, s.xi);
    const target = this.restCom();
    // DCM feedback: p = ξ + (k/ω)(ξ − ξ_ref)
    const desired = s.xi.clone().addScaledVector(s.xi.clone().sub(target), p.k / w);
    const support = s.support;
    const cop = support.length >= 3 ? clampToPolygon(support, desired, p.margin) : desired.clone();
    s.cop.copy(cop);
    const saturated = cop.distanceTo(desired) > 1e-4;

    // hip strategy: a burst of torso moment when the CoP saturates and ξ is outside
    const xiMargin = support.length >= 3 ? signedDistance(support, s.xi) : -1;
    if (saturated && xiMargin < 0 && this.hipLeft <= 0 && !s.used.has('hip') && s.strategy !== 'step') {
      this.hipLeft = p.hipTime;
      this.hipDir.copy(desired).sub(cop).normalize();
      s.used.add('hip');
    }
    s.hipMoment = 0;
    s.cmp.copy(cop);
    if (this.hipLeft > 0) {
      this.hipLeft -= h;
      const shift = p.hipTorque / (p.mass * GRAVITY);
      // The torso moment accelerates the COM back towards the support: CMP moves beyond the
      // CoP in the direction of the error, which (ξ̇ = ω(ξ − cmp)) slows ξ's escape.
      s.cmp.copy(cop).addScaledVector(this.hipDir, shift);
      s.hipMoment = p.hipTorque;
      s.torsoRate += (p.hipTorque / p.torsoInertia) * h;
    } else {
      // bring the torso back upright with a gentle PD, within the CoP margin (no CMP shift)
      s.torsoRate += (-18 * s.torso - 7 * s.torsoRate) * h;
    }
    s.torso += s.torsoRate * h;
    if (Math.abs(s.torso) > p.torsoLimit) {
      s.torso = Math.sign(s.torso) * p.torsoLimit;
      s.torsoRate = 0;
      this.hipLeft = 0;
    }

    // stepping: when ξ (projected at the end of the hip action) is outside the support
    if (s.strategy !== 'step' && xiMargin < -0.005 && (this.hipLeft <= 0 || s.used.has('hip')) && saturated) {
      const lateral = Math.abs(s.xi.x - target.x) > Math.abs(s.xi.y - target.y) * 0.8;
      const Lside = s.xi.x > target.x;
      const which: 'L' | 'R' = lateral ? (Lside ? 'L' : 'R') : Math.abs(s.feet.L.pos.y - s.xi.y) > Math.abs(s.feet.R.pos.y - s.xi.y) ? 'L' : 'R';
      const foot = s.feet[which];
      const other = s.feet[which === 'L' ? 'R' : 'L'];
      if (foot.down && other.down) {
        // Once the foot lifts, the CoP can only be under the other (stance) foot. Predict ξ at
        // touchdown with the CoP held at its best position there (the hip moment is brief, so
        // it is left out: a conservative, longer step), then place the foot just beyond it.
        const T = p.stepTime;
        const stance = convexHull(footPolygon(other.pos.x, other.pos.y, other.yaw));
        const copStance = clampToPolygon(stance, desired, p.margin);
        const pred = s.xi.clone().sub(copStance).multiplyScalar(Math.exp(w * T)).add(copStance);
        const centreOffset = (DIM.heel + DIM.toe) / 2;
        const sideSign = which === 'L' ? 1 : -1;
        const fwd = Math.sign(pred.y - target.y) || 1;
        const to = new Vector2(pred.x + sideSign * 0.025, pred.y + fwd * 0.04 - centreOffset);
        // keep a minimum stance width (the feet must not collide)
        if ((to.x - other.pos.x) * sideSign < 0.14) to.x = other.pos.x + sideSign * 0.14;
        const len = to.distanceTo(foot.pos);
        if (len > p.maxStep) {
          s.failed = `A ${len.toFixed(2)} m step would be needed; FO-H1 can step ${p.maxStep.toFixed(2)} m.`;
          to.copy(foot.pos).addScaledVector(to.clone().sub(foot.pos).normalize(), p.maxStep);
        }
        foot.from.copy(foot.pos);
        foot.to.copy(to);
        foot.t = 0;
        foot.duration = T;
        foot.lift = 0.05;
        foot.down = false;
        s.strategy = 'step';
        s.used.add('step');
        s.steps++;
        this.updateSupport();
        this.reclampCop(desired);
      }
    }

    // Beyond recovery: a real robot would now fall (FO-H1's controller would switch to a
    // protective fall). The simulation stops the motion here and says so.
    if (s.strategy === 'fail') return;
    if (s.steps >= 1 && s.margin < -0.25 && s.failed) {
      s.strategy = 'fail';
      return;
    }

    // integrate the LIPM with the CMP
    const acc = s.c.clone().sub(s.cmp).multiplyScalar(w * w).addScaledVector(s.push, 1 / p.mass);
    s.v.addScaledVector(acc, h);
    s.c.addScaledVector(s.v, h);

    // strategy bookkeeping
    s.margin = support.length >= 3 ? signedDistance(support, capturePoint(s.c, s.v, w)) : -1;
    const moving = s.v.length() > 0.03 || s.push.lengthSq() > 0;
    if (s.strategy === 'step') {
      if (s.feet.L.down && s.feet.R.down) s.strategy = 'settle';
    } else if (s.strategy === 'stand' && moving) {
      s.strategy = 'ankle';
      s.used.add('ankle');
    } else if ((s.strategy === 'ankle' || s.strategy === 'settle') && !moving && this.hipLeft <= 0) {
      this.settleTime += h;
      if (this.settleTime > 0.4) {
        this.settleTime = 0;
        s.strategy = 'stand';
      }
    }
    if (this.hipLeft > 0) s.strategy = s.strategy === 'step' ? 'step' : 'hip';
    else if (s.strategy === 'hip') s.strategy = 'ankle';
  }

  /** After the support changed within a tick, keep the CoP (and CMP) inside the new one. */
  private reclampCop(desired: P2) {
    const s = this.s;
    if (s.support.length < 3) return;
    const shift = s.cmp.clone().sub(s.cop);
    s.cop.copy(clampToPolygon(s.support, desired, this.p.margin));
    s.cmp.copy(s.cop).add(shift);
  }

  /** The feet are no longer at the nominal stance (after recovery steps): the balance lab then
   * walks them back with the gait generator (engine/gait.ts). */
  displaced(): boolean {
    const f = this.s.feet;
    return f.L.pos.distanceTo(this.home.L) > 0.02 || f.R.pos.distanceTo(this.home.R) > 0.02;
  }

  /** For the quasi-static return: the COM target is over the stance foot while the other swings. */
  get comTarget(): P2 {
    const f = this.s.feet;
    if (!f.L.down) return new Vector2(f.R.pos.x, f.R.pos.y + 0.03);
    if (!f.R.down) return new Vector2(f.L.pos.x, f.L.pos.y + 0.03);
    return this.restCom();
  }
}
