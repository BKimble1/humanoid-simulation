/**
 * Walking on the instrumented treadmill. The gait generator runs at 100 Hz in the belt's
 * frame; each render frame interpolates between the last two planning ticks (so the motion is
 * smooth at any display rate). The belt moves backwards at the speed that keeps the robot near
 * the middle of the treadmill: the planned COM speed plus a gentle position correction. A foot
 * on the belt moves with the belt by construction — world position = belt position − belt
 * travel — so it can never slide.
 *
 * Every tick also runs the reduced-order dynamics (joint torques from segment accelerations
 * and the ground reaction) and the power model (actuator operating points, battery), for the
 * overlays and readouts.
 */
import { Quaternion, Vector3 } from 'three';
import type { Side } from '../../spec/body';
import { GAITS, LOCOMOTION, type GaitSpec } from '../../spec/motion';
import { footPolygon } from '../../engine/balance';
import { GaitGenerator, type GaitFrame } from '../../engine/gait';
import { MotionDynamics, type DynamicsResult } from '../../engine/motionDynamics';
import type { BodyEnergy } from '../../engine/power';
import type { RobotModel } from '../../engine/robot';
import { JOINT_INDEX, Kinematics, Pose } from '../../engine/skeleton';
import { solveLeg } from '../../engine/ik';
import { poseFromGait } from '../../engine/wholebody';
import { bothHands, relax } from '../handPose';
import type { DisplayState, FootPose, Held, PoseSource } from '../pose';

interface Snap {
  com: Vector3;
  feet: Record<Side, { ankle: Vector3; quat: Quaternion; contact: GaitFrame['feet']['L']['contact'] }>;
  q: Float64Array;
  pelvisPos: Vector3;
  pelvisQuat: Quaternion;
  belt: number;
}

export class WalkSource implements PoseSource {
  id = 'walk';
  pose = new Pose();
  feet: Record<Side, FootPose> = { L: { ankle: new Vector3(), quat: new Quaternion(), contact: 'planted', support: 'belt' }, R: { ankle: new Vector3(), quat: new Quaternion(), contact: 'planted', support: 'belt' } };
  hands = bothHands();
  /** Called at every 100 Hz planning tick with the joint loads (the world integrates the
   * energy from these while walking is what the robot does: one owner per interval). */
  onLoad: ((dt: number, tau: Float64Array, qd: Float64Array) => void) | null = null;
  gen: GaitGenerator;
  gait: GaitSpec = GAITS.normal;
  carry = false;
  /** Mass carried when `carry` (the Engineer payload if set, otherwise a 10 kg box). */
  carryMass = 10;
  held: Held | null = null;
  /** Belt travel so far (m) and speed (m/s). */
  belt = 0;
  beltSpeed = 0;
  private acc = 0;
  private prev: Snap | null = null;
  private cur: Snap | null = null;
  private tickPose = new Pose();
  dyn: MotionDynamics;
  last: DynamicsResult | null = null;
  frame: GaitFrame;
  running = false;
  /** Where the robot stands in the world when it starts (x, z). */
  origin = new Vector3();
  onTick: ((w: WalkSource) => void)[] = [];
  /** The last 4 s at 100 Hz: vertical ground reaction per foot (N), battery power (W), knee torques (Nm). */
  trace = { fl: [] as number[], fr: [] as number[], p: [] as number[], kl: [] as number[], kr: [] as number[] };

  get posture(): string {
    return this.carry ? 'carry' : 'free';
  }

  constructor(
    private model: () => RobotModel,
    private kin: Kinematics,
    private energy: () => BodyEnergy,
  ) {
    this.gen = new GaitGenerator(undefined, LOCOMOTION.comHeight - 0.015);
    this.dyn = new MotionDynamics(model());
    this.frame = this.gen.frame;
  }

  enter(from: DisplayState) {
    // start in the belt frame where the robot stands now, each foot where it is displayed
    const l = from.feet.L.ankle;
    const r = from.feet.R.ankle;
    this.origin.set((l.x + r.x) / 2, 0, (l.z + r.z) / 2);
    const yaw = (q: Quaternion) => {
      const f = new Vector3(0, 0, 1).applyQuaternion(q);
      return Math.atan2(f.x, f.z);
    };
    this.gen = new GaitGenerator(
      { L: { side: 'L', x: l.x - this.origin.x, z: l.z - this.origin.z, yaw: yaw(from.feet.L.quat) }, R: { side: 'R', x: r.x - this.origin.x, z: r.z - this.origin.z, yaw: yaw(from.feet.R.quat) } },
      LOCOMOTION.comHeight - 0.015,
    );
    this.dyn = new MotionDynamics(this.model());
    this.belt = 0;
    this.beltSpeed = 0;
    this.prev = this.cur = null;
    this.acc = 0;
    this.running = false;
    this.tick();
    this.tick();
  }

  /** Asked to hand over: walking comes to a stop through a normal final step. */
  release() {
    this.stop();
  }

  releasable(): boolean {
    const f = this.gen.frame;
    return !f.walking && Math.abs(this.beltSpeed) < 0.01 && f.feet.L.contact !== 'air' && f.feet.R.contact !== 'air';
  }

  start(gait: GaitSpec) {
    this.gait = gait;
    this.gen.walk(gait);
    this.running = true;
  }

  stop() {
    this.gen.stop();
    this.running = false;
  }

  get walking(): boolean {
    return this.gen.frame.walking;
  }

  private snap(): Snap {
    const f = this.gen.frame;
    const res = poseFromGait(this.model(), this.kin, this.tickPose, f, { carry: this.carry });
    const s: Snap = {
      com: f.com.clone(),
      feet: {
        L: { ankle: f.feet.L.ankle.clone(), quat: f.feet.L.quat.clone(), contact: f.feet.L.contact },
        R: { ankle: f.feet.R.ankle.clone(), quat: f.feet.R.quat.clone(), contact: f.feet.R.contact },
      },
      q: Float64Array.from(res.pose.q),
      pelvisPos: res.pose.pelvisPos.clone(),
      pelvisQuat: res.pose.pelvisQuat.clone(),
      belt: this.belt,
    };
    return s;
  }

  private tick() {
    const dt = this.gen.dt;
    this.gen.tick();
    const f = this.gen.frame;
    this.frame = f;
    // belt speed: the COM's planned speed plus a gentle pull back to the treadmill's middle
    const worldComZ = this.origin.z + f.com.z - this.belt;
    const target = f.walking ? f.comVel.z + 0.6 * (worldComZ - 0.02) : 0;
    this.beltSpeed += (target - this.beltSpeed) * Math.min(1, dt * 3);
    if (!f.walking && Math.abs(this.beltSpeed) < 0.002) this.beltSpeed = 0;
    this.belt += this.beltSpeed * dt;
    this.prev = this.cur;
    this.cur = this.snap();
    // dynamics in the belt frame
    const contacts = (['L', 'R'] as Side[]).map((s) => ({
      side: s,
      ankle: f.feet[s].ankle.clone(),
      polygon: f.feet[s].contact === 'air' ? [] : footPolygon(f.feet[s].step.x, f.feet[s].step.z, f.feet[s].step.yaw),
    }));
    this.kin.update(this.tickPose);
    const pay = this.carry ? this.kin.palm('L').add(this.kin.palm('R')).multiplyScalar(0.5) : null;
    this.last = this.dyn.update(this.tickPose, dt, contacts, pay, this.carry ? this.carryMass : 0);
    const e = this.energy();
    this.onLoad?.(dt, this.last.tau, this.last.qd);
    const tr = this.trace;
    tr.fl.push(this.last.grf.L.force.y);
    tr.fr.push(this.last.grf.R.force.y);
    tr.p.push(e.summary.battery);
    tr.kl.push(this.last.tau[JOINT_INDEX.L_knee]);
    tr.kr.push(this.last.tau[JOINT_INDEX.R_knee]);
    if (tr.fl.length > 400) for (const k of Object.keys(tr) as (keyof typeof tr)[]) tr[k].shift();
    for (const cb of this.onTick) cb(this);
  }

  readouts(r: Record<string, number | string | boolean>) {
    const f = this.frame;
    r.wWalking = f.walking;
    r.wSpeed = f.walking ? this.gait.speed : 0;
    r.wBelt = -this.beltSpeed;
    r.wCadence = 60 / this.gait.stepTime;
    r.wStepLength = this.gait.stepLength;
    r.wCarry = this.carry;
    r.wCarryMass = this.carry ? this.carryMass : 0;
    r.wContactL = f.feet.L.contact;
    r.wContactR = f.feet.R.contact;
  }

  update(dt: number) {
    this.acc += dt;
    let guard = 0;
    while (this.acc >= this.gen.dt && guard++ < 20) {
      this.acc -= this.gen.dt;
      this.tick();
    }
    const a = this.prev ?? this.cur!;
    const b = this.cur!;
    const u = Math.min(1, this.acc / this.gen.dt);
    const o = this.origin;
    // interpolate between the two latest ticks, then move from the belt frame to the world
    for (let i = 0; i < this.pose.q.length; i++) this.pose.q[i] = a.q[i] + (b.q[i] - a.q[i]) * u;
    const beltNow = a.belt + (b.belt - a.belt) * u;
    this.pose.pelvisPos.lerpVectors(a.pelvisPos, b.pelvisPos, u).add(new Vector3(o.x, 0, o.z - beltNow));
    this.pose.pelvisQuat.slerpQuaternions(a.pelvisQuat, b.pelvisQuat, u);
    for (const s of ['L', 'R'] as Side[]) {
      this.feet[s].ankle.lerpVectors(a.feet[s].ankle, b.feet[s].ankle, u).add(new Vector3(o.x, 0, o.z - beltNow));
      this.feet[s].quat.slerpQuaternions(a.feet[s].quat, b.feet[s].quat, u);
      this.feet[s].contact = (u < 0.5 ? a : b).feet[s].contact === 'air' ? 'swing' : 'planted';
      this.feet[s].support = 'belt';
      // re-solve the leg to the interpolated foot so a planted foot stays exactly planted
      solveLeg(this.pose, s, this.feet[s].ankle, this.feet[s].quat, this.kin.scale);
    }
    this.beltNow = beltNow;
    relax(this.hands.L, this.carry ? 0 : 0.04);
    relax(this.hands.R, this.carry ? 0 : 0.04);
    if (this.carry)
      for (const h of [this.hands.L, this.hands.R]) {
        h.fingers = [0.5, 0.5, 0.52, 0.54];
        h.thumbFlex = 0.3;
        h.thumbOpp = 0.45;
      }
    if (this.carry) {
      this.kin.update(this.pose);
      const pos = this.kin.palm('L').add(this.kin.palm('R')).multiplyScalar(0.5);
      this.held = { pos, mass: this.carryMass, hands: 'both' };
    } else this.held = null;
  }

  /** Belt travel at the interpolated render time (the lab's belt texture follows it). */
  beltNow = 0;

  /** World offset of the belt frame (add to belt-frame positions). */
  worldOffset(out = new Vector3()): Vector3 {
    return out.set(this.origin.x, 0, this.origin.z - this.beltNow);
  }
}
