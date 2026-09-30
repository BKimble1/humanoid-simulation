/**
 * Balance: FO-H1 standing under whole-body COM control, doing the balance lab's tasks, and
 * recovering from pushes.
 *
 * Tasks move a few posture parameters (pelvis height and pitch, COM target, arm reach, the
 * lifted foot, a lift timeline) with critically damped springs; every frame the COM-constrained
 * posture solver turns them into joint angles, so the COM drawn and the torques computed are
 * those of the posture shown. Order matters for safety and is enforced: on one foot, the COM
 * moves over the stance foot before the other foot lifts, and the foot is down before the COM
 * moves back.
 *
 * Pushes run the reduced-order push-recovery model (engine/balance.ts: LIPM with DCM
 * feedback, ankle, hip and stepping strategies). Its COM, torso rotation and foot placements
 * drive the posture. After recovery steps the robot walks its feet back to its stance, one
 * quasi-static step at a time. A push beyond what any step can recover ends in a "fall"
 * state: the motion stops and the lab says so, then the robot is restored.
 */
import { Vector2, Vector3 } from 'three';
import { DIM, type JointId, type Side } from '../../spec/body';
import { defaultRecoveryParams, PushRecovery, type Strategy } from '../../engine/balance';
import { solveArm } from '../../engine/ik';
import type { RobotModel } from '../../engine/robot';
import { DEG, Kinematics, Pose } from '../../engine/skeleton';
import { carryArms, flatFoot, solvePosture } from '../../engine/wholebody';
import { handPoses } from '../../scene/robot/hand';
import type { FootPose, Held, PoseSource } from '../pose';

export type BalanceTask = 'stand' | 'squat' | 'lean' | 'shift' | 'oneFoot' | 'lift';

/** The balance lab's box: 10 kg on a low stand in front of the robot. */
export const LIFT_BOX = { mass: 10, size: new Vector3(0.32, 0.24, 0.24), rest: new Vector3(0, 0.47, 0.44) };

class Spring {
  x: number;
  v = 0;
  constructor(x = 0) {
    this.x = x;
  }
  step(target: number, dt: number, w = 3.2) {
    this.v += (w * w * (target - this.x) - 2 * w * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

const quintic = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

type Phase = 'task' | 'push' | 'return' | 'fail' | 'restore';

export class BalanceSource implements PoseSource {
  id = 'balance';
  pose = new Pose();
  feet: Record<Side, FootPose>;
  held: Held | null = null;
  thermalScale = 1;
  task: BalanceTask = 'stand';
  /** Thermal demonstration: squats in a loop, heating sped up. */
  exercise = false;
  phase: Phase = 'task';
  rec: PushRecovery | null = null;
  /** The push arrow to draw (world point, force N), while the push acts and just after. */
  pushArrow: { at: Vector3; force: Vector3 } | null = null;
  /** Box position (world) for the prop. */
  box = LIFT_BOX.rest.clone();
  /** Last push outcome for the panel. */
  outcome: { strategies: Strategy[]; steps: number; failed: string | null; peakMargin: number } | null = null;
  private t = 0;
  private kin: Kinematics;
  private h: Spring;
  private comX = new Spring(0);
  private comZ = new Spring(0.035);
  private pitch = new Spring(1.5 * DEG);
  private arms = new Spring(0);
  private footR = new Spring(0);
  private lift = 0;
  /** Lift timeline 0 (box on its platform) … 1 (carried), for the props. */
  get liftProgress() {
    return this.lift;
  }
  private stand: number;
  private stance = { L: new Vector2(DIM.hipHalfWidth, 0), R: new Vector2(-DIM.hipHalfWidth, 0) };
  private arrowT = 0;
  private ret: { side: Side; from: Vector2; to: Vector2; t: number; stage: 0 | 1 | 2; com0: Vector2 }[] = [];
  private failT = 0;
  private restore: { from: Pose; t: number } | null = null;
  private minMargin = 0;

  constructor(
    private model: () => RobotModel,
    kin: Kinematics,
  ) {
    this.kin = kin;
    const legLen = DIM.thigh + DIM.shin;
    this.stand = DIM.ankleHeight + legLen * Math.cos(12 * DEG) - 0.004;
    this.h = new Spring(this.stand);
    this.feet = this.footTargets(0);
  }

  /** Leaving with the box in the hands: the props fade it out; the timeline resets here. */
  dropLift() {
    this.lift = 0;
    this.box.copy(LIFT_BOX.rest);
  }

  enter(from: Pose) {
    this.kin.update(from);
    this.phase = 'task';
    this.rec = null;
    this.pushArrow = null;
    this.stance.L.set(DIM.hipHalfWidth, 0);
    this.stance.R.set(-DIM.hipHalfWidth, 0);
    this.pose.copy(from);
    const legLen = DIM.thigh * this.kin.scale.thigh + DIM.shin * this.kin.scale.shin;
    this.stand = DIM.ankleHeight + legLen * Math.cos(12 * DEG) - 0.004;
    this.h.x = from.pelvisPos.y;
    this.h.v = 0;
  }

  private pending: { force: number; dir: 'front' | 'back' | 'left' | 'right' } | null = null;

  /** Push as soon as the robot is standing still (it may first have to stand up). */
  queuePush(forceN: number, dir: 'front' | 'back' | 'left' | 'right') {
    if (this.phase !== 'task') return;
    this.pending = { force: forceN, dir };
  }

  /** Extra condition for a push to land (the world: nothing in front of the robot). */
  pushGate: () => boolean = () => true;

  private settled(): boolean {
    return this.pushGate() && this.task === 'stand' && this.lift === 0 && Math.abs(this.h.x - this.stand) < 0.004 && Math.abs(this.h.v) < 0.01 && Math.abs(this.comX.x) < 0.004 && this.footR.x < 0.002 && Math.abs(this.pitch.x - 1.5 * DEG) < 0.01;
  }

  /** Apply a push to the torso: force (N) in the ground plane, lasting `duration` s. */
  push(forceN: number, dir: 'front' | 'back' | 'left' | 'right', duration = 0.15) {
    if (this.phase !== 'task' || this.task !== 'stand') return false;
    const m = this.model();
    const rec = new PushRecovery(defaultRecoveryParams(m.totalMass));
    // start from the COM where it is now
    rec.s.c.set(this.comX.x, this.comZ.x);
    rec.s.xi.copy(rec.s.c);
    const d = dir === 'front' ? [0, 1] : dir === 'back' ? [0, -1] : dir === 'left' ? [1, 0] : [-1, 0];
    // "front" pushes the robot from behind, forwards (+Z); "left" towards its left (+X)
    rec.push({ force: new Vector2(d[0] * forceN, d[1] * forceN), duration, height: 1.15 });
    this.rec = rec;
    this.phase = 'push';
    this.arrowT = 0;
    this.minMargin = Infinity;
    this.outcome = null;
    return true;
  }

  private footTargets(liftR: number) {
    const mk = (side: Side, up: number) => {
      const p = this.stance[side];
      const f = flatFoot(p.x, p.y, 0);
      f.ankle.y += up;
      return { ankle: f.ankle, quat: f.quat };
    };
    return { L: mk('L', 0), R: mk('R', liftR) };
  }

  private dt = 1 / 60;

  update(dt: number) {
    this.t += dt;
    this.dt = Math.max(1e-4, dt);
    const model = this.model();
    if (this.exercise) {
      // squats: down 1.6 s, up 1.6 s, with the heating sped up (the panel says by how much)
      this.task = Math.floor(this.t / 1.7) % 2 === 0 ? 'squat' : 'stand';
      this.thermalScale = 40;
    } else this.thermalScale = 1;
    if (this.phase === 'restore') return this.updateRestore(dt);
    if (this.phase === 'push' || this.phase === 'fail') return this.updatePush(dt, model);
    if (this.phase === 'return') return this.updateReturn(dt, model);
    // ── tasks ──
    if (this.pending && this.settled()) {
      const p = this.pending;
      this.pending = null;
      this.push(p.force, p.dir);
      return this.updatePush(dt, model);
    }
    const hw = this.stance.L.x;
    const task = this.task;
    const onOne = task === 'oneFoot';
    // COM over the left foot before the right lifts; foot down before the COM comes back
    const comXTarget = onOne || this.footR.x > 0.004 ? hw - 0.004 : task === 'shift' ? hw * 0.85 : 0;
    const comReady = Math.abs(this.comX.x - (hw - 0.004)) < 0.008 && Math.abs(this.comX.v) < 0.02;
    const footTarget = onOne && comReady ? 0.11 : 0;
    let hT = this.stand;
    let pitchT = 1.5 * DEG;
    let armsT = 0;
    let comZT = 0.035;
    if (task === 'squat') {
      hT = this.stand - 0.25;
      pitchT = 26 * DEG;
      armsT = 0.75;
    } else if (task === 'lean') {
      hT = this.stand - 0.03;
      pitchT = 34 * DEG;
      armsT = 0.55;
      comZT = 0.075;
    }
    // lift: a timeline (down, grasp, up) that runs backwards to put the box down
    const liftTarget = task === 'lift' ? 1 : 0;
    this.lift += Math.sign(liftTarget - this.lift) * Math.min(Math.abs(liftTarget - this.lift), dt / 5);
    const u = this.lift;
    const down = quintic(u / 0.42);
    const up = quintic((u - 0.58) / 0.42);
    const reach = down * (1 - up);
    if (u > 0) {
      hT = this.stand - 0.2 * reach - 0.015 * up;
      pitchT = 1.5 * DEG + 30 * DEG * reach + 3 * DEG * up;
      comZT = 0.035 + 0.02 * up;
    }
    const w = this.exercise ? 2.6 : 3.2;
    const h = u > 0 ? hT : this.h.step(hT, dt, w);
    if (u > 0) (this.h.x = h), (this.h.v = 0);
    const pitch = u > 0 ? pitchT : this.pitch.step(pitchT, dt, w);
    if (u > 0) (this.pitch.x = pitch), (this.pitch.v = 0);
    const arms = this.arms.step(armsT, dt, w);
    const comX = this.comX.step(comXTarget, dt, 2.6);
    const comZ = u > 0 ? comZT : this.comZ.step(comZT, dt, 2.6);
    if (u > 0) (this.comZ.x = comZ), (this.comZ.v = 0);
    const lifted = this.footR.step(footTarget, dt, 4);
    this.feet = this.footTargets(Math.max(0, lifted));
    // upper body
    const upper: Partial<Record<JointId, number>> = {
      L_shoulder_pitch: 5 + 55 * arms,
      R_shoulder_pitch: 5 + 55 * arms,
      L_shoulder_roll: 7 + 6 * arms + (onOne ? 10 * quintic(lifted / 0.11) : 0),
      R_shoulder_roll: 7 + 6 * arms + (onOne ? 18 * quintic(lifted / 0.11) : 0),
      L_arm_yaw: -8,
      R_arm_yaw: -8,
      L_elbow: 16 + 14 * arms,
      R_elbow: 16 + 14 * arms,
      L_wrist_yaw: 0,
      R_wrist_yaw: 0,
      L_wrist_pitch: 0,
      R_wrist_pitch: 0,
      waist_yaw: 0,
    };
    const holding = u >= 0.5;
    const boxPos = this.box;
    this.held = null;
    if (u > 0) {
      const carry = carryArms();
      for (const k of Object.keys(carry) as JointId[]) upper[k] = (upper[k] ?? 0) * (1 - up) + carry[k]! * up;
    }
    solvePosture(model, this.kin, this.pose, {
      com: new Vector2(comX, comZ),
      pelvisHeight: h,
      pelvisPitch: pitch,
      feet: this.feet,
      upper,
      iterations: 3,
      payloadPos: holding ? boxPos : undefined,
    });
    if (u > 0 && reach > 0.001 && up < 0.999) {
      // hands to the box's sides, blending from the posture's arms
      const q0 = Float64Array.from(this.pose.q);
      for (const side of ['L', 'R'] as Side[]) {
        const s = side === 'L' ? 1 : -1;
        const target = boxPos.clone().add(new Vector3(s * (LIFT_BOX.size.x / 2 + 0.01), 0.02, 0));
        solveArm(this.pose, side, target, this.kin, { iterations: 16 });
      }
      const k = holding ? 1 - up : reach;
      for (let i = 0; i < q0.length; i++) this.pose.q[i] = q0[i] + (this.pose.q[i] - q0[i]) * k;
    }
    if (holding) {
      this.kin.update(this.pose);
      this.box.copy(this.kin.palm('L').add(this.kin.palm('R')).multiplyScalar(0.5));
      this.held = { pos: this.box.clone(), mass: LIFT_BOX.mass, hands: 'both' };
    } else this.box.copy(LIFT_BOX.rest);
    const grip = holding ? 0.62 : 0.14 + 0.2 * reach;
    handPoses.L.fingers = [grip, grip, grip, grip];
    handPoses.R.fingers = [grip, grip, grip, grip];
    this.aimHead(u > 0 ? -0.35 * reach : this.task === 'oneFoot' ? -0.15 : 0);
  }

  private updatePush(dt: number, model: RobotModel) {
    const rec = this.rec!;
    const s = rec.s;
    if (this.phase === 'push') {
      rec.step(dt);
      this.minMargin = Math.min(this.minMargin, s.margin);
      if (s.strategy === 'fail') {
        this.phase = 'fail';
        this.failT = 0;
        this.outcome = { strategies: [...s.used], steps: s.steps, failed: s.failed ?? 'The capture point left every reachable foothold.', peakMargin: this.minMargin };
      }
    } else {
      // fallen (the motion is frozen); restore after a pause
      this.failT += dt;
      if (this.failT > 2.4) {
        this.phase = 'restore';
        this.restore = { from: this.pose.clone(), t: 0 };
        this.stance.L.set(DIM.hipHalfWidth, 0);
        this.stance.R.set(-DIM.hipHalfWidth, 0);
        this.comX.x = 0;
        this.comZ.x = 0.035;
        this.comX.v = this.comZ.v = 0;
        this.rec = null;
        this.pushArrow = null;
      }
      return;
    }
    // push arrow while the force acts, and a moment after
    if (s.push.lengthSq() > 0) this.arrowT = 0.45;
    this.arrowT -= dt;
    if (this.arrowT > 0) {
      this.kin.update(this.pose);
      const at = this.kin.point('torso', [0, 0.26, 0]);
      const force = new Vector3(s.push.x || this.lastPush.x, 0, s.push.y || this.lastPush.y);
      if (s.push.lengthSq() > 0) this.lastPush.set(s.push.x, s.push.y);
      this.pushArrow = { at, force };
    } else this.pushArrow = null;
    // feet from the recovery model
    for (const side of ['L', 'R'] as Side[]) {
      const f = s.feet[side];
      this.stance[side].copy(f.pos);
    }
    const lift = (side: Side) => {
      const f = s.feet[side];
      return f.down ? 0 : f.lift * Math.sin(Math.PI * f.t);
    };
    this.feet = {
      L: { ...flatFoot(s.feet.L.pos.x, s.feet.L.pos.y) },
      R: { ...flatFoot(s.feet.R.pos.x, s.feet.R.pos.y) },
    };
    this.feet.L.ankle.y += lift('L');
    this.feet.R.ankle.y += lift('R');
    // hip strategy: the torso bends in the direction of the fall; arms swing with it
    const dirF = rec.hipDir.y;
    const dirS = rec.hipDir.x;
    const pitch = 1.5 * DEG + s.torso * dirF;
    const roll = -s.torso * dirS;
    const swing = Math.max(-1, Math.min(1, s.torsoRate * 0.4));
    const upper: Partial<Record<JointId, number>> = {
      L_shoulder_pitch: 5 + 30 * swing * dirF,
      R_shoulder_pitch: 5 + 30 * swing * dirF,
      L_shoulder_roll: 7 + Math.max(0, 25 * swing * dirS),
      R_shoulder_roll: 7 + Math.max(0, -25 * swing * dirS),
      L_elbow: 18,
      R_elbow: 18,
    };
    solvePosture(model, this.kin, this.pose, { com: s.c.clone(), pelvisHeight: this.stand - (s.strategy === 'step' ? 0.02 : 0), pelvisPitch: pitch, pelvisRoll: roll, feet: this.feet, upper, iterations: 3 });
    this.comX.x = s.c.x;
    this.comZ.x = s.c.y;
    // done: settled standing
    if (s.strategy === 'stand' && s.t > 0.6 && s.push.lengthSq() === 0) {
      this.outcome = { strategies: [...s.used], steps: s.steps, failed: null, peakMargin: this.minMargin };
      this.pushArrow = null;
      if (rec.displaced()) this.beginReturn();
      else this.phase = 'task';
      this.rec = null;
    }
    this.aimHead(0);
  }

  private lastPush = new Vector2();

  /** Walk displaced feet back to the stance: COM over the other foot, step, COM back. */
  private beginReturn() {
    this.ret = [];
    const home = { L: new Vector2(DIM.hipHalfWidth, 0), R: new Vector2(-DIM.hipHalfWidth, 0) };
    for (const side of ['L', 'R'] as Side[]) {
      if (this.stance[side].distanceTo(home[side]) > 0.02) this.ret.push({ side, from: this.stance[side].clone(), to: home[side], t: 0, stage: 0, com0: new Vector2(this.comX.x, this.comZ.x) });
    }
    this.phase = this.ret.length ? 'return' : 'task';
  }

  private updateReturn(dt: number, model: RobotModel) {
    const r = this.ret[0];
    if (!r) {
      this.phase = 'task';
      return;
    }
    const other: Side = r.side === 'L' ? 'R' : 'L';
    const o = this.stance[other];
    const overOther = new Vector2(o.x + (r.side === 'L' ? -0.012 : 0.012), o.y + 0.035);
    const mid = this.stance.L.clone().add(this.stance.R).multiplyScalar(0.5).add(new Vector2(0, 0.035));
    const dur = [0.8, 0.75, 0.7][r.stage];
    r.t += dt / dur;
    const u = quintic(r.t);
    let com: Vector2;
    let lift = 0;
    if (r.stage === 0) com = r.com0.clone().lerp(overOther, u);
    else if (r.stage === 1) {
      com = overOther;
      this.stance[r.side].copy(r.from).lerp(r.to, u);
      lift = 0.045 * Math.sin(Math.PI * Math.min(1, r.t));
    } else {
      const goal = this.ret.length > 1 ? mid : new Vector2(0, 0.035);
      com = overOther.clone().lerp(goal, u);
    }
    if (r.t >= 1) {
      r.t = 0;
      if (r.stage < 2) r.stage = (r.stage + 1) as 1 | 2;
      else {
        this.ret.shift();
        if (this.ret[0]) this.ret[0].com0.copy(com);
      }
    }
    this.feet = { L: flatFoot(this.stance.L.x, this.stance.L.y), R: flatFoot(this.stance.R.x, this.stance.R.y) };
    this.feet[r.side].ankle.y += lift;
    solvePosture(model, this.kin, this.pose, { com, pelvisHeight: this.stand, pelvisPitch: 1.5 * DEG, feet: this.feet, upper: { L_shoulder_pitch: 5, R_shoulder_pitch: 5, L_shoulder_roll: 7, R_shoulder_roll: 7, L_elbow: 16, R_elbow: 16 }, iterations: 3 });
    this.comX.x = com.x;
    this.comZ.x = com.y;
    this.comX.v = this.comZ.v = 0;
    this.aimHead(-0.1);
  }

  private updateRestore(dt: number) {
    const r = this.restore!;
    r.t += dt / 1.4;
    const u = quintic(r.t);
    const model = this.model();
    const target = new Pose();
    target.copy(this.pose);
    this.feet = this.footTargets(0);
    solvePosture(model, this.kin, target, { com: new Vector2(0, 0.035), pelvisHeight: this.stand, pelvisPitch: 1.5 * DEG, feet: this.feet, upper: { L_shoulder_pitch: 5, R_shoulder_pitch: 5, L_shoulder_roll: 7, R_shoulder_roll: 7, L_elbow: 16, R_elbow: 16 }, iterations: 3 });
    this.pose.copy(r.from).lerp(target, u);
    if (r.t >= 1) {
      this.phase = 'task';
      this.restore = null;
      this.h.x = this.stand;
      this.h.v = 0;
    }
  }

  private neck = { yaw: 0, pitch: 0, vp: 0, vy: 0 };
  private aimHead(pitchT: number) {
    const n = this.neck;
    const dt = this.dt;
    const w = 4;
    n.vp += (w * w * (0.05 - pitchT * 0.6 - n.pitch) - 2 * w * n.vp) * dt;
    n.pitch += n.vp * dt;
    this.pose.set('neck_pitch', n.pitch);
    this.pose.set('neck_yaw', 0.03 * Math.sin(this.t * 0.4));
  }

  readouts(r: Record<string, number | string | boolean>) {
    r.balPhase = this.phase;
    r.pushQueued = !!this.pending;
    r.balTask = this.task;
    if (this.rec) {
      r.strategy = this.rec.s.strategy;
      r.recMargin = this.rec.s.margin;
      r.steps = this.rec.s.steps;
    } else r.strategy = this.phase === 'return' ? 'return' : 'stand';
    if (this.outcome) {
      r.outStrategies = this.outcome.strategies.join(', ');
      r.outSteps = this.outcome.steps;
      r.outFailed = this.outcome.failed ?? '';
      r.outMargin = this.outcome.peakMargin;
    }
    r.oneFootReady = this.task === 'oneFoot' && this.footR.x > 0.1;
  }
}

