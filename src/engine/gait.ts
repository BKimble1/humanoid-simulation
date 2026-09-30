/**
 * Walking pattern generator.
 *
 *  1. Footsteps are planned a few steps ahead (step length, width and timing from the gait).
 *  2. A ZMP reference follows them: under the stance foot in single support, moving smoothly
 *     from one foot to the next in double support.
 *  3. ZMP preview control (engine/preview.ts) turns that reference into a COM trajectory that
 *     satisfies the linear-inverted-pendulum dynamics.
 *  4. Swing feet follow minimum-jerk paths with a clearance arc. The trailing foot rolls onto
 *     its toe before lifting (toe-off) and the leading foot lands on its heel and rolls flat
 *     (heel-strike): each rotation is about the edge that touches the ground, so a foot in
 *     contact never slides.
 *
 * Everything is in the "ground frame": on the instrumented treadmill that is the belt, which
 * the scene moves backwards at the walking speed.
 */
import { Quaternion, Vector2, Vector3 } from 'three';
import { DIM } from '../spec/body';
import { GAITS, LOCOMOTION, type GaitSpec } from '../spec/motion';
import { type P2, convexHull } from './balance';
import { PreviewAxis, previewGains, type PreviewGains } from './preview';

export type SideKey = 'L' | 'R';

export interface Footstep {
  side: SideKey;
  /** Ground point under the ankle, (x, z). */
  x: number;
  z: number;
  yaw: number;
}

interface Phase {
  kind: 'DS' | 'SS';
  t0: number;
  t1: number;
  /** ZMP moves from `from` to `to` (DS) or stays at `from` (SS). */
  from: P2;
  to: P2;
  /** SS: the swing foot's side and its footsteps; DS: the foot that will lift next (trailing). */
  swing?: SideKey;
  lift?: Footstep;
  land?: Footstep;
  trailing?: SideKey;
  leading?: SideKey;
  gait: GaitSpec;
}

export interface FootState {
  /** Ankle joint position (ground frame). */
  ankle: Vector3;
  quat: Quaternion;
  /** 'flat', 'heel' (rolling onto the sole), 'toe' (rolling off), or 'air'. */
  contact: 'flat' | 'heel' | 'toe' | 'air';
  /** Foot pitch about its lateral axis (toe down positive), rad. */
  pitch: number;
  /** The footstep the foot is on (or last left). */
  step: Footstep;
}

export interface GaitFrame {
  t: number;
  com: Vector3;
  comVel: Vector3;
  comAcc: Vector3;
  zmp: Vector3;
  zmpRef: Vector3;
  feet: Record<SideKey, FootState>;
  support: 'DS' | SideKey;
  /** Progress through the current step, 0–1. */
  phase: number;
  /** +1 when the left leg swings forward, −1 for the right (for arm swing and pelvis yaw). */
  swingSign: number;
  walking: boolean;
  gait: GaitSpec;
  /** Ground contact polygon (x, z). */
  polygon: P2[];
  /** 0 standing … 1 walking, ramping through the first and last double supports. */
  envelope: number;
  /** COM bob profile: 1 at mid double support (lowest), 0 at mid single support (highest). */
  bob: number;
}

const ZMP_OFFSET = 0.03; // standing ZMP target ahead of the ankle, inside the foot (m)
/** Walking: the ZMP rolls under the stance foot from the ankle to the forefoot, so the heel can
 * rise (toe-off) as soon as double support begins. */
const ZMP_ROLL: [number, number] = [0.0, 0.165];
const FOOT_CENTRE = (DIM.heel + DIM.toe) / 2;
/** Fraction of double support before the trailing heel starts to rise. */
const TOE_START = 0.18;

function footPoint(f: Footstep, forward: number): P2 {
  return new Vector2(f.x + Math.sin(f.yaw) * forward, f.z + Math.cos(f.yaw) * forward);
}

const minjerk = (s: number) => s * s * s * (10 - 15 * s + 6 * s * s);
/** Quintic from p0 (slope v0, no curvature) to p1 (at rest), u ∈ [0, 1]. */
function quintic(p0: number, v0: number, p1: number, u: number): number {
  // p(u) = p0 + v0·u + a3·u³ + a4·u⁴ + a5·u⁵ with p(1) = p1, p'(1) = 0, p''(1) = 0 (p''(0) = 0)
  const a3 = 10 * (p1 - p0) - 6 * v0;
  const a4 = -15 * (p1 - p0) + 8 * v0;
  const a5 = 6 * (p1 - p0) - 3 * v0;
  return p0 + v0 * u + a3 * u * u * u + a4 * u * u * u * u + a5 * u * u * u * u * u;
}
const smooth = (s: number) => s * s * (3 - 2 * s);
const clamp01 = (s: number) => Math.min(1, Math.max(0, s));

/** Foot pose rolling about its heel (pitch < 0, toe up) or toe (pitch > 0, heel up) edge. */
export function footPose(step: Footstep, pitch: number, out: FootState['ankle'], quat: Quaternion): void {
  const yawQ = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), step.yaw);
  const pitchQ = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch);
  quat.copy(yawQ).multiply(pitchQ);
  // pivot on the ground: heel edge for toe-up, toe edge for heel-up
  const pivotZ = pitch < 0 ? DIM.heel : pitch > 0 ? DIM.toe : 0;
  const pivot = new Vector3(0, 0, pivotZ).applyQuaternion(yawQ).add(new Vector3(step.x, 0, step.z));
  // ankle relative to the pivot, in the foot frame: (0, ankleHeight, −pivotZ)
  out.set(0, DIM.ankleHeight, -pivotZ).applyQuaternion(quat).add(pivot);
}

export class GaitGenerator {
  readonly dt = 0.01;
  private gains = new Map<number, PreviewGains>();
  private ax: PreviewAxis;
  private az: PreviewAxis;
  private phases: Phase[] = [];
  t = 0;
  gait: GaitSpec = GAITS.normal;
  /** Keep appending steps (continuous walking) until stop() is called. */
  private continuous = false;
  private stopping = false;
  private last: Record<SideKey, Footstep>;
  /** Foot that swings next when the plan is extended. */
  private nextSwing: SideKey = 'R';
  frame: GaitFrame;
  zc: number;

  constructor(stance: { L: Footstep; R: Footstep } = { L: { side: 'L', x: DIM.hipHalfWidth, z: 0, yaw: 0 }, R: { side: 'R', x: -DIM.hipHalfWidth, z: 0, yaw: 0 } }, zc = LOCOMOTION.comHeight) {
    this.zc = zc;
    const g = this.gainsFor(zc);
    this.ax = new PreviewAxis(g);
    this.az = new PreviewAxis(g);
    this.last = { L: { ...stance.L }, R: { ...stance.R } };
    const mid = this.standZmp();
    this.ax.reset(mid.x);
    this.az.reset(mid.y);
    this.frame = this.makeFrame();
    this.evaluate();
  }

  private gainsFor(zc: number): PreviewGains {
    const key = Math.round(zc * 1000);
    if (!this.gains.has(key)) this.gains.set(key, previewGains(this.dt, key / 1000));
    return this.gains.get(key)!;
  }

  private standZmp(): P2 {
    const a = footPoint(this.last.L, ZMP_OFFSET);
    const b = footPoint(this.last.R, ZMP_OFFSET);
    return a.add(b).multiplyScalar(0.5);
  }

  get walking(): boolean {
    return this.phases.some((p) => p.t1 > this.t);
  }

  /** Begin (or keep) walking straight ahead with a gait. */
  walk(gait: GaitSpec) {
    const changed = gait.id !== this.gait.id;
    this.gait = gait;
    this.continuous = true;
    this.stopping = false;
    if (this.walking && changed) this.truncateFuture();
    if (!this.walking) {
      // start: shift the ZMP onto the stance foot before the first swing
      const start = this.t;
      const stance: SideKey = this.nextSwing === 'R' ? 'L' : 'R';
      const initDS = 0.9;
      this.phases = [
        {
          kind: 'DS',
          t0: start,
          t1: start + initDS,
          from: this.standZmp(),
          to: footPoint(this.last[stance], ZMP_OFFSET),
          trailing: this.nextSwing,
          leading: stance,
          gait,
        },
      ];
      this.extendPlan(true);
    }
  }

  /** Finish the current step, bring the feet together and stand. */
  stop() {
    if (!this.continuous) return;
    this.continuous = false;
    this.stopping = true;
    this.truncateFuture();
  }

  /** Execute a given list of footsteps (e.g. walking back after a push), then stand. */
  stepTo(steps: Footstep[], gait: GaitSpec) {
    this.gait = gait;
    this.continuous = false;
    this.stopping = false;
    let t = Math.max(this.t, this.phases.length ? this.phases[this.phases.length - 1].t1 : this.t);
    const first = steps[0];
    if (!first) return;
    const stance0: SideKey = first.side === 'L' ? 'R' : 'L';
    const ds0 = 0.8;
    this.phases.push({ kind: 'DS', t0: t, t1: t + ds0, from: this.standZmp(), to: footPoint(this.last[stance0], ZMP_OFFSET), trailing: first.side, leading: stance0, gait });
    t += ds0;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const stance: SideKey = s.side === 'L' ? 'R' : 'L';
      const Tss = gait.stepTime * (1 - gait.doubleSupport);
      const Tds = gait.stepTime * gait.doubleSupport;
      const zmpStance = footPoint(this.last[stance], ZMP_OFFSET);
      this.phases.push({ kind: 'SS', t0: t, t1: t + Tss, from: zmpStance, to: zmpStance, swing: s.side, lift: { ...this.last[s.side] }, land: { ...s }, gait });
      t += Tss;
      this.last[s.side] = { ...s };
      const next = steps[i + 1];
      const lastStep = !next;
      const to = lastStep ? footPoint(this.last.L, ZMP_OFFSET).add(footPoint(this.last.R, ZMP_OFFSET)).multiplyScalar(0.5) : footPoint(s, ZMP_OFFSET);
      this.phases.push({ kind: 'DS', t0: t, t1: t + (lastStep ? 0.9 : Tds), from: zmpStance, to, trailing: stance, leading: s.side, gait });
      t += lastStep ? 0.9 : Tds;
    }
    this.nextSwing = steps[steps.length - 1].side === 'L' ? 'R' : 'L';
  }

  /** Where the ZMP enters the stance foot: where the previous double support left it. */
  private prevRollEnd(stance: SideKey): number {
    const lastP = this.phases[this.phases.length - 1];
    if (lastP && lastP.kind === 'DS' && lastP.leading === stance) {
      // the DS ended on this foot at ZMP_ROLL[0] (walking) or ZMP_OFFSET (from standing)
      const st = this.last[stance];
      const back = new Vector2(lastP.to.x - st.x, lastP.to.y - st.z);
      return back.x * Math.sin(st.yaw) + back.y * Math.cos(st.yaw);
    }
    return ZMP_OFFSET;
  }

  /**
   * Drop the steps that have not started yet (keeping the current phase and, after a single
   * support, the double support that completes it), so a stop or a new speed takes effect at
   * the next step rather than after the whole preview horizon.
   */
  private truncateFuture() {
    const t = this.t;
    const i = this.phases.findIndex((p) => t >= p.t0 && t < p.t1);
    if (i < 0) return;
    let keep = i + 1;
    if (this.phases[i].kind === 'SS' && this.phases[i + 1]?.kind === 'DS') keep = i + 2;
    this.phases.length = Math.min(this.phases.length, keep);
    // rebuild the footstep memory from what is kept
    for (const p of this.phases) if (p.kind === 'SS') this.last[p.swing!] = { ...p.land! };
    const lastSS = [...this.phases].reverse().find((p) => p.kind === 'SS');
    if (lastSS) this.nextSwing = lastSS.swing === 'L' ? 'R' : 'L';
  }

  /** Append footsteps until the plan covers the preview horizon. */
  private extendPlan(force = false) {
    const horizon = this.t + this.ax.g.N * this.dt + 1.0;
    let end = this.phases.length ? this.phases[this.phases.length - 1].t1 : this.t;
    let guard = 0;
    while ((force || end < horizon) && (this.continuous || this.stopping) && guard++ < 16) {
      force = false;
      const g = this.gait;
      const swing = this.nextSwing;
      const stance: SideKey = swing === 'L' ? 'R' : 'L';
      const Tss = g.stepTime * (1 - g.doubleSupport);
      const Tds = g.stepTime * g.doubleSupport;
      const st = this.last[stance];
      const width = LOCOMOTION.stepWidth;
      const sgn = swing === 'L' ? 1 : -1;
      // the swing foot lands a step length ahead of the stance foot (or alongside when stopping)
      const land: Footstep = this.stopping
        ? { side: swing, x: st.x + sgn * width, z: st.z, yaw: st.yaw }
        : { side: swing, x: st.x + sgn * width, z: st.z + g.stepLength, yaw: 0 };
      // the first step from standing is half length
      const fromStand = this.phases.length <= 1 && Math.abs(this.last.L.z - this.last.R.z) < 1e-6;
      if (fromStand && !this.stopping) land.z = st.z + g.stepLength * 0.5;
      const stop = this.stopping;
      const zIn = footPoint(st, this.prevRollEnd(stance));
      const zOut = footPoint(st, stop ? ZMP_OFFSET : ZMP_ROLL[1]);
      this.phases.push({ kind: 'SS', t0: end, t1: end + Tss, from: zIn, to: zOut, swing, lift: { ...this.last[swing] }, land, gait: g });
      end += Tss;
      this.last[swing] = land;
      this.nextSwing = stance;
      if (stop) {
        const mid = footPoint(this.last.L, ZMP_OFFSET).add(footPoint(this.last.R, ZMP_OFFSET)).multiplyScalar(0.5);
        this.phases.push({ kind: 'DS', t0: end, t1: end + 1.0, from: zOut, to: mid, trailing: stance, leading: swing, gait: g });
        end += 1.0;
        this.stopping = false;
        break;
      }
      this.phases.push({ kind: 'DS', t0: end, t1: end + Tds, from: zOut, to: footPoint(land, ZMP_ROLL[0]), trailing: stance, leading: swing, gait: g });
      end += Tds;
    }
  }

  private phaseAt(t: number): Phase | null {
    for (const p of this.phases) if (t >= p.t0 && t < p.t1) return p;
    return null;
  }

  /** ZMP reference at time t (after the plan: centred between the feet). */
  zmpRef(t: number): P2 {
    const p = this.phaseAt(t);
    if (!p) {
      const lastP = this.phases[this.phases.length - 1];
      if (lastP && t >= lastP.t1) return lastP.to.clone();
      return this.standZmp();
    }
    const s = clamp01((t - p.t0) / (p.t1 - p.t0));
    if (p.kind === 'SS') return p.from.clone().lerp(p.to, s);
    return p.from.clone().lerp(p.to, smooth(s));
  }

  /** Advance the pattern by exactly one planning period (10 ms). */
  tick() {
    if (this.continuous || this.stopping) this.extendPlan();
    const t = this.t;
    const dt = this.dt;
    const refs: P2[] = [];
    const N = this.ax.g.N;
    for (let j = 1; j <= N; j++) refs.push(this.zmpRef(t + j * dt));
    this.ax.step((j) => refs[j - 1].x);
    this.az.step((j) => refs[j - 1].y);
    this.t = t + dt;
    // drop finished phases (keep the last one for the stand reference)
    while (this.phases.length > 1 && this.phases[0].t1 < this.t - 1) this.phases.shift();
    this.evaluate();
  }

  /** Advance by any dt (whole planning periods; the frame is interpolated between them). */
  advance(dt: number) {
    this.acc += dt;
    while (this.acc >= this.dt) {
      this.acc -= this.dt;
      this.tick();
    }
  }
  private acc = 0;

  private makeFrame(): GaitFrame {
    const mk = (s: SideKey): FootState => ({ ankle: new Vector3(), quat: new Quaternion(), contact: 'flat', pitch: 0, step: { ...this.last[s] } });
    return {
      t: 0,
      com: new Vector3(),
      comVel: new Vector3(),
      comAcc: new Vector3(),
      zmp: new Vector3(),
      zmpRef: new Vector3(),
      feet: { L: mk('L'), R: mk('R') },
      support: 'DS',
      phase: 0,
      swingSign: 0,
      walking: false,
      gait: this.gait,
      polygon: [],
      envelope: 0,
      bob: 0,
    };
  }

  private toeOff(g: GaitSpec) {
    return ((18 * Math.PI) / 180) * Math.min(1, g.stepLength / 0.6);
  }
  private heelStrike(g: GaitSpec) {
    return (10 * Math.PI) / 180 * Math.min(1, g.stepLength / 0.6);
  }

  /** Fill `frame` for the current time. */
  private evaluate() {
    const f = this.frame;
    const t = this.t;
    f.t = t;
    f.com.set(this.ax.x[0], this.zc, this.az.x[0]);
    f.comVel.set(this.ax.x[1], 0, this.az.x[1]);
    f.comAcc.set(this.ax.x[2], 0, this.az.x[2]);
    f.zmp.set(this.ax.zmp, 0, this.az.zmp);
    const r = this.zmpRef(t);
    f.zmpRef.set(r.x, 0, r.y);
    const p = this.phaseAt(t);
    f.walking = !!p;
    f.gait = p?.gait ?? this.gait;
    // default: both feet flat on their last footsteps
    for (const s of ['L', 'R'] as SideKey[]) {
      const foot = f.feet[s];
      foot.step = this.stepUnder(s, t);
      foot.pitch = 0;
      foot.contact = 'flat';
    }
    f.support = 'DS';
    f.phase = 0;
    f.swingSign = 0;
    if (p && p.kind === 'SS') {
      const u = clamp01((t - p.t0) / (p.t1 - p.t0));
      const sw = p.swing!;
      const foot = f.feet[sw];
      f.support = sw === 'L' ? 'R' : 'L';
      f.phase = u;
      f.swingSign = sw === 'L' ? 1 : -1;
      const g = p.gait;
      const Tss = p.t1 - p.t0;
      const small = Math.abs(p.land!.z - p.lift!.z) < 0.05; // in-place or return steps: no roll
      const th1 = small ? 0 : -this.heelStrike(g);
      // Lift-off state: where the toe-off of the preceding double support left the foot, and
      // how fast it was moving (the swing continues that motion instead of restarting).
      const prev = this.phases[this.phases.indexOf(p) - 1];
      const tdsPrev = prev && prev.kind === 'DS' ? prev.t1 - prev.t0 : 0;
      const th0 = small || !tdsPrev ? 0 : this.toeOff(g);
      const w0 = small || !tdsPrev ? 0 : (2 * th0) / ((1 - TOE_START) * tdsPrev); // d(pitch)/dt at the end of θ·v²
      const a0 = new Vector3();
      const a0b = new Vector3();
      const a1 = new Vector3();
      const qTmp = new Quaternion();
      footPose(p.lift!, th0, a0, qTmp);
      const v0 = new Vector3();
      if (w0 > 0) {
        footPose(p.lift!, th0 + 1e-4, a0b, qTmp);
        v0.subVectors(a0b, a0).multiplyScalar((w0 / 1e-4) * Tss); // in u units
      }
      footPose(p.land!, th1, a1, qTmp);
      foot.ankle.set(quintic(a0.x, v0.x, a1.x, u), quintic(a0.y, v0.y, a1.y, u), quintic(a0.z, v0.z, a1.z, u));
      const clearance = small ? 0.045 : g.clearance;
      // clearance bump 16w²(1−w)², skewed so the peak comes early (toe clearance), with zero
      // vertical speed at lift-off and touch-down
      const w = u - (0.12 * Math.sin(Math.PI * u)) / Math.PI;
      foot.ankle.y += clearance * 16 * w * w * (1 - w) * (1 - w);
      // pitch: continues the toe-off rotation, levels, then sets up the heel strike
      const pitch = quintic(th0, w0 * Tss, th1, u);
      foot.pitch = pitch;
      const m = minjerk(u);
      const yaw = p.lift!.yaw + (p.land!.yaw - p.lift!.yaw) * m;
      foot.quat.setFromAxisAngle(new Vector3(0, 1, 0), yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));
      foot.contact = 'air';
      foot.step = { ...p.land! };
      const st = f.feet[f.support as SideKey];
      footPose(st.step, 0, st.ankle, st.quat);
    } else {
      // double support (or standing): the leading foot rolls down from its heel, the trailing
      // foot rolls onto its toe (θ·u², accelerating into the swing)
      const u = p ? clamp01((t - p.t0) / (p.t1 - p.t0)) : 1;
      f.phase = u;
      for (const s of ['L', 'R'] as SideKey[]) {
        const foot = f.feet[s];
        let pitch = 0;
        if (p && p.kind === 'DS' && p.gait) {
          const next = this.phases[this.phases.indexOf(p) + 1];
          const prev = this.phases[this.phases.indexOf(p) - 1];
          const rolling = prev && prev.kind === 'SS' && prev.swing === s && Math.abs(prev.land!.z - prev.lift!.z) >= 0.05;
          const lifting = next && next.kind === 'SS' && next.swing === s && Math.abs(next.land!.z - next.lift!.z) >= 0.05;
          if (rolling) pitch = -this.heelStrike(p.gait) * (1 - smooth(clamp01(u / 0.45)));
          if (lifting) {
            // the heel rises once the ZMP has moved past the trailing toe line
            const v = Math.max(0, (u - TOE_START) / (1 - TOE_START));
            pitch = this.toeOff(p.gait) * v * v;
          }
        }
        if (Math.abs(pitch) < 1e-4) pitch = 0;
        foot.pitch = pitch;
        foot.contact = pitch < 0 ? 'heel' : pitch > 0 ? 'toe' : 'flat';
        footPose(foot.step, pitch, foot.ankle, foot.quat);
      }
    }
    f.polygon = this.contactPolygon();
    // envelope and bob: a smooth vertical rhythm at the step frequency
    let env = 0;
    let sigma = 0;
    if (p) {
      const idx = this.phases.indexOf(p);
      const u = clamp01((t - p.t0) / (p.t1 - p.t0));
      const first = p.kind === 'DS' && !this.phases.slice(0, idx).some((q) => q.kind === 'SS' && q.t1 > t - 5);
      const last = p.kind === 'DS' && !this.phases.slice(idx + 1).some((q) => q.kind === 'SS');
      env = first ? smooth(u) : last ? 1 - smooth(u) : 1;
      const ss = 1 - p.gait.doubleSupport;
      sigma = p.kind === 'SS' ? u * ss : ss + u * (1 - ss);
      if (first) sigma = ss + u * (1 - ss);
      const centre = 1 - p.gait.doubleSupport / 2;
      f.bob = (1 + Math.cos(2 * Math.PI * (sigma - centre))) / 2;
    } else f.bob = 0;
    f.envelope = env;
  }

  /** The footstep a foot stands on at time t. */
  private stepUnder(s: SideKey, t: number): Footstep {
    // the last landing of this foot at or before t
    let best: Footstep | null = null;
    for (const p of this.phases) {
      if (p.kind !== 'SS' || p.swing !== s) continue;
      if (p.t1 <= t + 1e-9) best = p.land!;
      else if (p.t0 <= t) return p.lift!;
      else if (!best) return p.lift!;
    }
    return best ?? this.frame?.feet[s].step ?? this.last[s];
  }

  /** Points of the soles touching the ground now, as a convex polygon. */
  contactPolygon(): P2[] {
    const pts: P2[] = [];
    for (const s of ['L', 'R'] as SideKey[]) {
      const foot = this.frame.feet[s];
      if (foot.contact === 'air') continue;
      const st = foot.step;
      const c = Math.cos(st.yaw);
      const sn = Math.sin(st.yaw);
      const w = DIM.footWidth / 2;
      const zs = foot.contact === 'heel' ? [DIM.heel] : foot.contact === 'toe' ? [DIM.toe] : [DIM.heel, DIM.toe];
      for (const lz of zs) for (const lx of [-w, w]) pts.push(new Vector2(st.x + lx * c + lz * sn, st.z - lx * sn + lz * c));
    }
    return convexHull(pts);
  }

  /** Current footsteps (for re-planning). */
  footsteps(): Record<SideKey, Footstep> {
    return { L: { ...this.last.L }, R: { ...this.last.R } };
  }
}

export { FOOT_CENTRE };
