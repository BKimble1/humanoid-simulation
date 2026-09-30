/**
 * Pose sources and the pose driver.
 *
 * Everything that moves the robot is a PoseSource: standing idle, walking, balancing, reaching,
 * manipulating. Each states a complete pose every frame: joint angles, the pelvis, both feet
 * (ankle pose, whether each is planted, and what supports it) and both hands.
 *
 * The driver owns what is displayed. It never cuts from one pose to another:
 *
 *  - A change of source, or of the posture a source is asked for (its `posture` identity:
 *    Overview's resting arms → Hands' presented hand, empty hands → carrying), starts an
 *    inertialized blend: the displayed pose is the source's pose plus an offset that starts at
 *    the difference between what was shown and the new target, with the displayed velocity,
 *    and decays to zero along a quintic. Interrupting a blend starts a new one from what is
 *    shown and how it is moving, so repeated clicks never pop. The blend lasts long enough to
 *    keep joint speeds and accelerations within set limits, however large the change.
 *  - Legs are never blended in joint space: the pelvis is blended and the legs are solved to
 *    the feet, so a planted foot stays exactly where it is.
 *  - A source is not left mid-action. Asked to hand over, it first finishes what cannot be cut
 *    (walking comes to a stop, a lifted foot comes down, an object is put back) and the driver
 *    switches when it reports it can; the next source starts from the displayed stance.
 */
import { Quaternion, Vector3 } from 'three';
import { DIM, type Side } from '../spec/body';
import { solveLeg } from '../engine/ik';
import { Pose, type LimbScale, JOINT_INDEX, NJ } from '../engine/skeleton';
import { HAND_N, bothHands, handFromArray, handToArray, type HandPose } from './handPose';

export type Contact = 'planted' | 'swing';

export interface FootPose {
  ankle: Vector3;
  quat: Quaternion;
  /** Planted (bearing weight or resting on its support) or swinging. Default planted. */
  contact?: Contact;
  /** What a planted foot stands on: the floor or the treadmill belt (which moves). */
  support?: 'floor' | 'belt';
}

/** Something the robot holds: where it is (world), its mass, and which hands carry it. */
export interface Held {
  pos: Vector3;
  mass: number;
  hands: 'both' | 'L' | 'R';
}

/** What the robot looks like now, handed to a source that takes over. */
export interface DisplayState {
  pose: Pose;
  feet: Record<Side, FootPose>;
  hands: Record<Side, HandPose>;
}

export interface PoseSource {
  id: string;
  pose: Pose;
  feet: Record<Side, FootPose>;
  hands: Record<Side, HandPose>;
  /** Identity of the posture the source is producing (a change starts a blend). */
  readonly posture?: string;
  /** What the robot holds now (null: nothing). */
  held?: Held | null;
  /** Heating and discharge speed-up for demonstrations of long duty cycles (1: real time). */
  thermalScale?: number;
  /** Advance the source by dt seconds (never called with dt ≤ 0). */
  update(dt: number): void;
  /** Called when the source becomes the driver's target: start from what is displayed. */
  enter?(from: DisplayState): void;
  /** Called when the driver leaves the source. */
  exit?(): void;
  /** Asked to hand over: finish what cannot be cut short. */
  release?(): void;
  /** Taken back before it handed over: carry on as before. */
  resume?(): void;
  /** It can hand over now without a discontinuity (both feet planted, nothing half done). */
  releasable?(): boolean;
  /** Numbers for the panels. */
  readouts?(r: Record<string, number | string | boolean>): void;
}

const LEG_JOINTS = new Set(['hip_yaw', 'hip_roll', 'hip_pitch', 'knee', 'ankle_pitch', 'ankle_roll'].flatMap((j) => [`L_${j}`, `R_${j}`]).map((id) => JOINT_INDEX[id as keyof typeof JOINT_INDEX]));

export function footPosesFrom(pose: Pose, kin: { update(p: Pose): unknown; frames: Map<string, import('three').Matrix4> }): Record<Side, FootPose> {
  kin.update(pose);
  const out = {} as Record<Side, FootPose>;
  for (const s of ['L', 'R'] as Side[]) {
    const m = kin.frames.get(`${s}_foot`)!;
    const ankle = new Vector3().setFromMatrixPosition(m);
    const quat = new Quaternion().setFromRotationMatrix(m);
    out[s] = { ankle, quat, contact: ankle.y < DIM.ankleHeight + 0.004 ? 'planted' : 'swing', support: 'floor' };
  }
  return out;
}

/** Limits on the displayed motion that a blend respects. */
export const BLEND_LIMITS = {
  /** Joint speed (rad/s) and acceleration (rad/s²). */
  jointV: 2.4,
  jointA: 12,
  /** Pelvis translation (m/s, m/s²) and rotation (rad/s, rad/s²). */
  pelvisV: 0.4,
  pelvisA: 2.5,
  pelvisW: 1.2,
  pelvisWa: 7,
  /** Hand pose scalars (1/s, 1/s²). */
  handV: 2.6,
  handA: 16,
  /** Longest blend, s. */
  maxT: 2.4,
};

/** Quintic offset: x(0) = x0, x'(0) = v0, x''(0) = 0, x(T) = x'(T) = x''(T) = 0; u = t/T. */
function decay(x0: number, v0T: number, u: number): number {
  if (u >= 1) return 0;
  const a3 = -10 * x0 - 6 * v0T;
  const a4 = 15 * x0 + 8 * v0T;
  const a5 = -6 * x0 - 3 * v0T;
  return x0 + v0T * u + a3 * u * u * u + a4 * u * u * u * u + a5 * u * u * u * u * u;
}

/** Shortest duration for which a quintic decay of x0 (starting at speed v0) stays within v and a. */
function needed(x0: number, v0: number, vmax: number, amax: number): number {
  const x = Math.abs(x0) + 0.35 * Math.abs(v0) * 0.5;
  return Math.max((1.875 * x) / vmax, Math.sqrt((5.77 * x) / amax));
}

const SIDES: Side[] = ['L', 'R'];

export class PoseDriver {
  out = new Pose();
  hands: Record<Side, HandPose> = bothHands();
  feet: Record<Side, FootPose> = {
    L: { ankle: new Vector3(DIM.hipHalfWidth, DIM.ankleHeight, 0), quat: new Quaternion(), contact: 'planted', support: 'floor' },
    R: { ankle: new Vector3(-DIM.hipHalfWidth, DIM.ankleHeight, 0), quat: new Quaternion(), contact: 'planted', support: 'floor' },
  };
  source: PoseSource | null = null;
  /** A source waiting for the current one to finish what it is doing. */
  pending: { src: PoseSource; duration: number; since: number } | null = null;
  scale: LimbScale;
  /** Called when a hand-over had to be forced (the current source did not finish in time). */
  onForced?: (from: string, to: string) => void;
  /** Called when a source takes over (at once, or after the previous one finished). */
  onSwitch?: (src: PoseSource) => void;
  /** Longest wait for a source to finish before switching anyway, s. */
  maxWait = 8;

  // displayed state of the previous frame and its velocity (for continuity)
  private prevQ = new Float64Array(NJ);
  private velQ = new Float64Array(NJ);
  private prevPel = new Vector3();
  private velPel = new Vector3();
  private prevRot = new Quaternion();
  private velRot = new Vector3();
  private prevHand = new Float64Array(HAND_N * 2);
  private velHand = new Float64Array(HAND_N * 2);
  private primed = 0;
  // the active blend: offsets at its start and their start velocities
  private blendT = 0;
  private blendDur = 0;
  private offQ = new Float64Array(NJ);
  private offQv = new Float64Array(NJ);
  private offPel = new Vector3();
  private offPelV = new Vector3();
  private offRot = new Vector3();
  private offRotV = new Vector3();
  private offHand = new Float64Array(HAND_N * 2);
  private offHandV = new Float64Array(HAND_N * 2);
  private offFoot: Record<Side, Vector3> = { L: new Vector3(), R: new Vector3() };
  private offFootQ: Record<Side, Quaternion> = { L: new Quaternion(), R: new Quaternion() };
  private footLift = { L: 0, R: 0 };
  private wantBlend: number | null = null;
  private postureKey = '';
  private srcHand = new Float64Array(HAND_N * 2);
  private waited = 0;

  constructor(scale: LimbScale) {
    this.scale = scale;
  }

  get blending(): boolean {
    return this.blendT < this.blendDur;
  }

  /** The source that the robot is handing over to, if any. */
  get target(): PoseSource | null {
    return this.pending?.src ?? this.source;
  }

  /** Displayed state, for a source taking over. */
  display(): DisplayState {
    return { pose: this.out, feet: this.feet, hands: this.hands };
  }

  /** Ask for a source (the switch waits until the current one can hand over). */
  use(src: PoseSource, duration = 0.9) {
    if (src === this.source) {
      if (this.pending) {
        this.pending = null;
        src.resume?.();
      }
      return;
    }
    if (this.pending?.src === src) return;
    const cur = this.source;
    if (cur && cur.releasable && !cur.releasable() && duration > 0.05) {
      if (!this.pending) cur.release?.();
      this.pending = { src, duration, since: 0 };
      this.waited = 0;
      return;
    }
    this.switchTo(src, duration);
  }

  /** Switch now (instant: no blend, for the first frame). */
  private switchTo(src: PoseSource, duration: number) {
    this.pending = null;
    this.source?.exit?.();
    this.source = src;
    src.enter?.(this.display());
    this.postureKey = this.keyOf(src);
    this.wantBlend = duration;
    this.onSwitch?.(src);
  }

  private keyOf(src: PoseSource): string {
    return `${src.id}:${src.posture ?? ''}`;
  }

  /** Take a pose as the displayed state (initialisation). */
  reset(p: Pose) {
    this.out.copy(p);
    this.prevQ.set(p.q);
    this.velQ.fill(0);
    this.prevPel.copy(p.pelvisPos);
    this.velPel.set(0, 0, 0);
    this.prevRot.copy(p.pelvisQuat);
    this.velRot.set(0, 0, 0);
    this.blendT = this.blendDur = 0;
    this.primed = 0;
  }

  update(dt: number) {
    if (dt <= 0) return;
    if (this.pending) {
      this.waited += dt;
      const cur = this.source;
      const ready = !cur || !cur.releasable || cur.releasable();
      if (ready || this.waited > this.maxWait) {
        if (!ready) this.onForced?.(cur?.id ?? '', this.pending.src.id);
        this.switchTo(this.pending.src, this.pending.duration);
      }
    }
    const src = this.source;
    if (!src) return;
    src.update(dt);
    // a new posture asked of the same source blends like a new source
    const key = this.keyOf(src);
    if (key !== this.postureKey) {
      this.postureKey = key;
      this.wantBlend = this.wantBlend ?? 0.9;
    }
    for (const s of SIDES) handToArray(src.hands[s], this.srcHand, s === 'L' ? 0 : HAND_N);
    if (this.wantBlend !== null) {
      this.startBlend(src, this.wantBlend, dt);
      this.wantBlend = null;
    }
    this.compose(src, dt);
  }

  /** Start a blend from the displayed state (and its motion) to the source's pose now. */
  private startBlend(src: PoseSource, base: number, dt: number) {
    if (base <= 0.02 || this.primed < 1) {
      // instant (first frame, or a deliberate cut)
      this.blendT = this.blendDur = 0;
      this.offQ.fill(0);
      this.offHand.fill(0);
      this.offPel.set(0, 0, 0);
      this.offRot.set(0, 0, 0);
      for (const s of SIDES) this.offFoot[s].set(0, 0, 0);
      return;
    }
    const L = BLEND_LIMITS;
    let T = base;
    // joints (the legs follow the pelvis and the feet)
    for (let i = 0; i < NJ; i++) {
      if (LEG_JOINTS.has(i)) {
        this.offQ[i] = this.offQv[i] = 0;
        continue;
      }
      const shown = this.prevQ[i] + this.velQ[i] * dt;
      const x0 = shown - src.pose.q[i];
      const v0 = Math.max(-L.jointV, Math.min(L.jointV, this.velQ[i]));
      this.offQ[i] = x0;
      this.offQv[i] = v0;
      T = Math.max(T, needed(x0, v0, L.jointV, L.jointA));
    }
    // pelvis
    const shownPel = this.prevPel.clone().addScaledVector(this.velPel, dt);
    this.offPel.subVectors(shownPel, src.pose.pelvisPos);
    this.offPelV.copy(this.velPel).clampLength(0, L.pelvisV);
    T = Math.max(T, needed(this.offPel.length(), this.offPelV.length(), L.pelvisV, L.pelvisA));
    const dq = this.prevRot.clone().multiply(src.pose.pelvisQuat.clone().invert());
    if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
    const ang = 2 * Math.acos(Math.min(1, dq.w));
    const sn = Math.sqrt(Math.max(1e-12, 1 - dq.w * dq.w));
    this.offRot.set(dq.x / sn, dq.y / sn, dq.z / sn).multiplyScalar(ang < 1e-6 ? 0 : ang);
    this.offRotV.copy(this.velRot).clampLength(0, L.pelvisW);
    T = Math.max(T, needed(ang, this.offRotV.length(), L.pelvisW, L.pelvisWa));
    // hands
    for (let k = 0; k < HAND_N * 2; k++) {
      const shown = this.prevHand[k] + this.velHand[k] * dt;
      this.offHand[k] = shown - this.srcHand[k];
      this.offHandV[k] = Math.max(-L.handV, Math.min(L.handV, this.velHand[k]));
      T = Math.max(T, needed(this.offHand[k], this.offHandV[k], L.handV, L.handA));
    }
    // feet: a new source starts from the displayed stance; if it did not, the foot is carried
    // over in a lifted arc (and never slid along the floor)
    for (const s of SIDES) {
      this.offFoot[s].subVectors(this.feet[s].ankle, src.feet[s].ankle);
      this.offFootQ[s].copy(this.feet[s].quat).multiply(src.feet[s].quat.clone().invert());
      const horiz = Math.hypot(this.offFoot[s].x, this.offFoot[s].z);
      this.footLift[s] = horiz > 0.008 ? Math.min(0.06, 0.02 + horiz * 0.4) : 0;
      if (horiz > 0.008) T = Math.max(T, 0.6 + horiz * 2.5);
    }
    this.blendT = 0;
    this.blendDur = Math.min(L.maxT, T);
  }

  private compose(src: PoseSource, dt: number) {
    const o = this.out;
    const blending = this.blendT < this.blendDur;
    if (blending) this.blendT = Math.min(this.blendDur, this.blendT + dt);
    const T = this.blendDur;
    const u = blending || T > 0 ? Math.min(1, this.blendT / Math.max(1e-6, T)) : 1;
    const active = u < 1;
    o.q.set(src.pose.q);
    if (active) for (let i = 0; i < NJ; i++) if (!LEG_JOINTS.has(i)) o.q[i] += decay(this.offQ[i], this.offQv[i] * T, u);
    o.pelvisPos.copy(src.pose.pelvisPos);
    o.pelvisQuat.copy(src.pose.pelvisQuat);
    if (active) {
      o.pelvisPos.x += decay(this.offPel.x, this.offPelV.x * T, u);
      o.pelvisPos.y += decay(this.offPel.y, this.offPelV.y * T, u);
      o.pelvisPos.z += decay(this.offPel.z, this.offPelV.z * T, u);
      _v.set(decay(this.offRot.x, this.offRotV.x * T, u), decay(this.offRot.y, this.offRotV.y * T, u), decay(this.offRot.z, this.offRotV.z * T, u));
      const a = _v.length();
      if (a > 1e-7) o.pelvisQuat.premultiply(_q.setFromAxisAngle(_v.divideScalar(a), a));
    }
    // hands
    for (let k = 0; k < HAND_N * 2; k++) _h[k] = this.srcHand[k] + (active ? decay(this.offHand[k], this.offHandV[k] * T, u) : 0);
    handFromArray(_h, this.hands.L, 0);
    handFromArray(_h, this.hands.R, HAND_N);
    // feet: the source's, unless one is being carried over from where it was shown
    for (const s of SIDES) {
      const f = this.feet[s];
      const b = src.feet[s];
      f.ankle.copy(b.ankle);
      f.quat.copy(b.quat);
      f.contact = b.contact ?? 'planted';
      f.support = b.support ?? 'floor';
      if (active && (this.offFoot[s].lengthSq() > 1e-10 || this.footLift[s] > 0)) {
        const k = decayWeight(u);
        f.ankle.addScaledVector(this.offFoot[s], k);
        if (this.footLift[s] > 0) {
          f.ankle.y += this.footLift[s] * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 2;
          f.contact = 'swing';
        }
        f.quat.copy(b.quat).premultiply(_q.identity().slerp(this.offFootQ[s], k));
      }
      solveLeg(o, s, f.ankle, f.quat, this.scale);
    }
    // displayed velocities (for the next blend)
    if (this.primed > 0) {
      for (let i = 0; i < NJ; i++) this.velQ[i] = (o.q[i] - this.prevQ[i]) / dt;
      this.velPel.subVectors(o.pelvisPos, this.prevPel).divideScalar(dt);
      const dq = o.pelvisQuat.clone().multiply(this.prevRot.clone().invert());
      if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
      const ang = 2 * Math.acos(Math.min(1, dq.w));
      const sn = Math.sqrt(Math.max(1e-12, 1 - dq.w * dq.w));
      this.velRot.set(dq.x / sn, dq.y / sn, dq.z / sn).multiplyScalar(ang < 1e-7 ? 0 : ang / dt);
      for (let k = 0; k < HAND_N * 2; k++) this.velHand[k] = (_h[k] - this.prevHand[k]) / dt;
    }
    this.prevQ.set(o.q);
    this.prevPel.copy(o.pelvisPos);
    this.prevRot.copy(o.pelvisQuat);
    for (let k = 0; k < HAND_N * 2; k++) this.prevHand[k] = Math.min(1, Math.max(0, _h[k]));
    this.primed++;
  }
}

/** Weight of an offset that decays with the blend (1 → 0, smooth at both ends). */
function decayWeight(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return 1 - x * x * x * (x * (x * 6 - 15) + 10);
}

const _v = new Vector3();
const _q = new Quaternion();
const _h = new Float64Array(HAND_N * 2);
