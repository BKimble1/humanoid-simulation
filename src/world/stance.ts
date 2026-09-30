/**
 * The stance of a robot standing on flat ground, and how it changes: a standing source takes
 * over the feet where they are displayed and, if they are not where it wants them, steps them
 * there one at a time the way a person would — weight over the other foot, lift, carry,
 * place, weight back — instead of sliding them.
 *
 * While a step is under way the keeper names the COM target (over the stance foot) and the
 * feet; the source puts both into its posture solver, so the COM drawn is the one shown.
 */
import { Quaternion, Vector2, Vector3 } from 'three';
import { DIM, type Side } from '../spec/body';
import type { FootPose } from './pose';

const Y = new Vector3(0, 1, 0);
const quintic = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

export interface StanceFoot {
  x: number;
  z: number;
  yaw: number;
}

interface Step {
  side: Side;
  from: StanceFoot;
  to: StanceFoot;
  /** 0 weight over the other foot, 1 lift-carry-place, 2 weight back. */
  stage: 0 | 1 | 2;
  t: number;
  com0: Vector2;
  /** The foot starts in the air (it comes straight down first). */
  fromAir: number;
  /** Duration of the current stage, s (from how far it goes). */
  dur: number;
}

/** Shortest durations of a quasi-static step's three stages, s. */
const STAGE_T = [0.7, 0.6, 0.7];
/** Peak speeds: the COM while the weight shifts, the foot while it is carried (m/s). */
const COM_V = 0.26;
const FOOT_V = 0.6;

export class StanceKeeper {
  feet: Record<Side, StanceFoot> = { L: { x: DIM.hipHalfWidth, z: 0, yaw: 0 }, R: { x: -DIM.hipHalfWidth, z: 0, yaw: 0 } };
  private steps: Step[] = [];
  private lift: Record<Side, number> = { L: 0, R: 0 };
  /** COM target while stepping (null: the source's own). */
  com: Vector2 | null = null;
  private comNow = new Vector2();

  /** True while a step is being taken. */
  get busy(): boolean {
    return this.steps.length > 0;
  }

  /** A foot is off the ground. */
  get lifted(): boolean {
    return this.lift.L > 0.001 || this.lift.R > 0.001;
  }

  /**
   * Take over the displayed feet; queue the steps to `home` (a foot within `tol` of its home
   * stays put). `com` is where the COM is now (x, z).
   */
  begin(display: Record<Side, FootPose>, home: Record<Side, StanceFoot> | null, com: Vector2, tol = 0.015) {
    this.steps = [];
    this.com = null;
    this.comNow.copy(com);
    for (const s of ['L', 'R'] as Side[]) {
      const f = display[s];
      this.feet[s] = { x: f.ankle.x, z: f.ankle.z, yaw: yawOf(f.quat) };
      this.lift[s] = Math.max(0, f.ankle.y - DIM.ankleHeight);
    }
    // a foot in the air comes down first (onto its home if near, else straight down)
    for (const s of ['L', 'R'] as Side[]) {
      if (this.lift[s] > 0.004) {
        const h = home?.[s];
        const to = h && Math.hypot(h.x - this.feet[s].x, h.z - this.feet[s].z) < 0.2 ? { ...h } : { ...this.feet[s] };
        this.steps.push({ side: s, from: { ...this.feet[s] }, to, stage: 1, t: 0, com0: com.clone(), fromAir: this.lift[s], dur: 0 });
      }
    }
    if (home) {
      // the foot furthest from home moves first
      const order = (['L', 'R'] as Side[]).sort((a, b) => dist(this.feet[b], home[b]) - dist(this.feet[a], home[a]));
      for (const s of order) {
        const queued = this.steps.find((st) => st.side === s);
        const from = queued ? queued.to : this.feet[s];
        if (dist(from, home[s]) > tol || Math.abs(from.yaw - home[s].yaw) > 0.05) this.steps.push({ side: s, from: { ...from }, to: { ...home[s] }, stage: 0, t: 0, com0: com.clone(), fromAir: 0, dur: 0 });
      }
    }
    for (const s of ['L', 'R'] as Side[]) if (!this.steps.some((st) => st.side === s && st.fromAir)) this.lift[s] = 0;
  }

  /** Move the stance by itself (no steps), e.g. a source that places the feet directly. */
  set(side: Side, f: StanceFoot) {
    this.feet[side] = { ...f };
  }

  /** Advance; `comNominal` is where the source wants the COM when not stepping. */
  update(dt: number, comNominal: Vector2): void {
    const st = this.steps[0];
    if (!st) {
      this.com = null;
      this.comNow.copy(comNominal);
      return;
    }
    const other: Side = st.side === 'L' ? 'R' : 'L';
    const o = this.feet[other];
    // over the stance foot, a little inside it and forward of the ankle (over the mid-foot)
    const overOther = new Vector2(o.x + (st.side === 'L' ? -0.012 : 0.012), o.z + 0.035);
    const nx = this.steps[1];
    const placed = this.feet[st.side];
    const backGoal = nx && nx.side !== st.side ? new Vector2(placed.x + (nx.side === 'L' ? -0.012 : 0.012), placed.z + 0.035) : comNominal;
    if (st.t === 0) {
      // the stage's duration from how far it goes (quintic peak speed 1.875·d/T)
      const d = st.stage === 0 ? st.com0.distanceTo(overOther) : st.stage === 1 ? Math.hypot(st.to.x - st.from.x, st.to.z - st.from.z) : overOther.distanceTo(backGoal);
      st.dur = Math.max(STAGE_T[st.stage], (1.875 * d) / (st.stage === 1 ? FOOT_V : COM_V));
    }
    st.t += dt / st.dur;
    const u = quintic(st.t);
    if (st.stage === 0) {
      this.com = st.com0.clone().lerp(overOther, u);
    } else if (st.stage === 1) {
      this.com = overOther;
      const f = this.feet[st.side];
      f.x = st.from.x + (st.to.x - st.from.x) * u;
      f.z = st.from.z + (st.to.z - st.from.z) * u;
      f.yaw = st.from.yaw + (st.to.yaw - st.from.yaw) * u;
      // clearance: a lifted arc, or straight down from where it was
      const travel = Math.hypot(st.to.x - st.from.x, st.to.z - st.from.z);
      // (sin²: the foot leaves and lands with no vertical speed)
      const arc = travel > 0.004 ? Math.min(0.05, 0.022 + travel * 0.25) * Math.sin(Math.PI * Math.min(1, st.t)) ** 2 : 0;
      this.lift[st.side] = st.fromAir ? st.fromAir * (1 - u) + arc * u : arc;
    } else {
      // weight back: to the middle, or — when the other foot steps next — straight over the
      // foot just placed, so the weight crosses the stance once
      this.com = overOther.clone().lerp(backGoal, u);
    }
    this.comNow.copy(this.com);
    if (st.t >= 1) {
      st.t = 0;
      if (st.stage === 1) this.lift[st.side] = 0;
      if (st.stage < 2) st.stage = (st.stage + 1) as 1 | 2;
      else {
        this.steps.shift();
        const nx = this.steps[0];
        if (nx) {
          nx.com0.copy(this.comNow);
          // already over its stance foot: skip the weight shift
          const o2 = this.feet[nx.side === 'L' ? 'R' : 'L'];
          if (Math.hypot(this.comNow.x - (o2.x + (nx.side === 'L' ? -0.012 : 0.012)), this.comNow.y - (o2.z + 0.035)) < 0.01) nx.stage = 1;
        }
      }
    }
  }

  /** The feet as ankle poses (with contact) for the posture solver and the driver. */
  footPoses(out: Record<Side, FootPose>): Record<Side, FootPose> {
    for (const s of ['L', 'R'] as Side[]) {
      const f = this.feet[s];
      const o = out[s];
      o.ankle.set(f.x, DIM.ankleHeight + this.lift[s], f.z);
      o.quat.setFromAxisAngle(Y, f.yaw);
      o.contact = this.lift[s] > 0.0015 ? 'swing' : 'planted';
      o.support = 'floor';
    }
    return out;
  }
}

export function newFeet(): Record<Side, FootPose> {
  return {
    L: { ankle: new Vector3(DIM.hipHalfWidth, DIM.ankleHeight, 0), quat: new Quaternion(), contact: 'planted', support: 'floor' },
    R: { ankle: new Vector3(-DIM.hipHalfWidth, DIM.ankleHeight, 0), quat: new Quaternion(), contact: 'planted', support: 'floor' },
  };
}

/** The standard stance (hip width, square to +Z) around (x, z). */
export function homeStance(x = 0, z = 0, yaw = 0): Record<Side, StanceFoot> {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const w = DIM.hipHalfWidth;
  return { L: { x: x + w * c, z: z - w * s, yaw }, R: { x: x - w * c, z: z + w * s, yaw } };
}

function dist(a: StanceFoot, b: StanceFoot): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function yawOf(q: Quaternion): number {
  const f = new Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(f.x, f.z);
}
