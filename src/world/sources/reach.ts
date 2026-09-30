/**
 * Kinematics lab: FO-H1 standing (COM-controlled), one arm following a target.
 *
 * IK mode: the target is dragged in the scene; damped-least-squares IK (engine/ik.ts) moves
 * the arm's seven joints so the palm reaches it, keeping a natural elbow through the
 * null-space posture term. The solver is warm-started from the arm as it is displayed; what
 * it asks for goes to the joints through a servo with speed and acceleration limits, so a
 * target that jumps (or the other arm chosen) makes a smooth move rather than a snap, and a
 * target out of reach settles at the closest point without chatter, the joints at their
 * limits named.
 * FK mode: the joint angles are set directly; the palm position is computed forward.
 * The workspace is sampled once by forward kinematics over the joint ranges.
 */
import { Vector2, Vector3 } from 'three';
import { DIM, JOINTS, type JointId, type Side } from '../../spec/body';
import { ARM_JOINTS, solveArm, type ArmIKResult } from '../../engine/ik';
import type { RobotModel } from '../../engine/robot';
import { DEG, JOINT_INDEX, Kinematics, Pose } from '../../engine/skeleton';
import { solvePosture, standHeight } from '../../engine/wholebody';
import { bothHands, relax } from '../handPose';
import type { DisplayState, FootPose, PoseSource } from '../pose';
import { StanceKeeper, homeStance, newFeet } from '../stance';

/** The arm servo: joint speed (rad/s) and acceleration (rad/s²) limits. */
const SERVO_V = 2.2;
const SERVO_A = 9;

export class ReachSource implements PoseSource {
  id = 'reach';
  pose = new Pose();
  feet: Record<Side, FootPose> = newFeet();
  hands = bothHands();
  side: Side = 'L';
  mode: 'ik' | 'fk' = 'ik';
  /** The target asked for (dragged in the scene, or set by a scenario). */
  target = new Vector3(0.28, 1.12, 0.38);
  /** The target the solver follows: `target`, smoothed. */
  aim = new Vector3(0.28, 1.12, 0.38);
  private aimV = new Vector3();
  /** FK mode joint angles (deg) for the active arm. */
  fk: number[] = [20, 12, -10, 60, 0, 0, 0];
  result: ArmIKResult | null = null;
  palm = new Vector3();
  private kin: Kinematics;
  private stand: number;
  private t = 0;
  private stance = new StanceKeeper();
  /** Servoed arm joints (both arms) and their speeds. */
  private armQ: Record<Side, Float64Array> = { L: new Float64Array(7), R: new Float64Array(7) };
  private armV: Record<Side, Float64Array> = { L: new Float64Array(7), R: new Float64Array(7) };
  private solveQ = new Float64Array(7);
  private scratch = new Pose();

  constructor(
    private model: () => RobotModel,
    kin: Kinematics,
  ) {
    this.kin = kin;
    this.stand = standHeight(kin);
  }

  get posture(): string {
    return `${this.side}:${this.mode}`;
  }

  enter(from: DisplayState) {
    this.pose.copy(from.pose);
    // warm start: the arms as they are displayed
    for (const s of ['L', 'R'] as Side[])
      ARM_JOINTS(s).forEach((id, i) => {
        this.armQ[s][i] = from.pose.q[JOINT_INDEX[id]];
        this.armV[s][i] = 0;
      });
    this.aim.copy(this.target);
    this.aimV.set(0, 0, 0);
    this.kin.update(from.pose);
    const com = this.model().com(this.kin);
    this.stance.begin(from.feet, homeStance(), new Vector2(com.x, com.z));
  }

  releasable(): boolean {
    return !this.stance.lifted;
  }

  update(dt: number) {
    this.stand = standHeight(this.kin);
    this.t += dt;
    // the aim follows the target (critically damped; a dragged target is followed closely)
    const w = 9;
    this.aimV.addScaledVector(this.aim.clone().sub(this.target), -w * w * dt).addScaledVector(this.aimV, -2 * w * dt);
    this.aim.addScaledVector(this.aimV, dt);
    const other: Side = this.side === 'L' ? 'R' : 'L';
    const rest: Partial<Record<JointId, number>> = {
      [`${other}_shoulder_pitch`]: 5,
      [`${other}_shoulder_roll`]: 7,
      [`${other}_arm_yaw`]: -8,
      [`${other}_elbow`]: 16,
      [`${other}_wrist_yaw`]: 0,
      [`${other}_wrist_pitch`]: 0,
      [`${other}_wrist_roll`]: 0,
      waist_yaw: 0,
    };
    const ids = ARM_JOINTS(this.side);
    const sway = 0.0015 * Math.sin(this.t * 1.3);
    const nominal = new Vector2(sway, 0.035);
    this.stance.update(dt, nominal);
    this.stance.footPoses(this.feet);
    // the arm's command: IK from the servoed arm, or the FK sliders
    const cmd = this.solveQ;
    solvePosture(this.model(), this.kin, this.pose, { com: this.stance.com ?? nominal, pelvisHeight: this.stand, pelvisPitch: 1.5 * DEG, feet: this.feet, upper: rest, iterations: 2 });
    if (this.mode === 'ik') {
      this.scratch.copy(this.pose);
      ids.forEach((id, i) => this.scratch.set(id, this.armQ[this.side][i]));
      this.result = solveArm(this.scratch, this.side, this.aim, this.kin, { iterations: 24 });
      ids.forEach((id, i) => (cmd[i] = this.scratch.q[JOINT_INDEX[id]]));
    } else {
      ids.forEach((id, i) => {
        const j = JOINTS[JOINT_INDEX[id]];
        cmd[i] = Math.min(j.max, Math.max(j.min, this.fk[i])) * DEG;
      });
      this.result = null;
    }
    // servo both arms: the working arm to its command, the other to rest
    for (const s of ['L', 'R'] as Side[]) {
      const arm = ARM_JOINTS(s);
      arm.forEach((id, i) => {
        const goal = s === this.side ? cmd[i] : (rest[id] ?? 0) * DEG;
        this.armQ[s][i] = servo(this.armQ[s], this.armV[s], i, goal, dt);
        this.pose.q[JOINT_INDEX[id]] = this.armQ[s][i];
      });
    }
    this.kin.update(this.pose);
    this.kin.point(`${this.side}_hand`, [0, -DIM.palm, 0.012], this.palm);
    if (this.mode === 'fk') this.target.copy(this.palm), this.aim.copy(this.palm);
    // look at the hand
    const head = this.kin.point('neck', [0, DIM.neckLength, 0]);
    const d = this.palm.clone().sub(head);
    this.pose.set('neck_yaw', Math.max(-1, Math.min(1, Math.atan2(d.x, d.z))) * 0.6);
    this.pose.set('neck_pitch', Math.max(-0.4, Math.min(0.6, -Math.atan2(d.y, Math.hypot(d.x, d.z)))) * 0.7);
    relax(this.hands.L);
    relax(this.hands.R);
  }

  /** Joint angles of the active arm now (deg). */
  armAngles(): { id: JointId; label: string; deg: number; min: number; max: number }[] {
    return ARM_JOINTS(this.side).map((id) => {
      const j = JOINTS[JOINT_INDEX[id]];
      return { id, label: j.label, deg: this.pose.q[JOINT_INDEX[id]] / DEG, min: j.min, max: j.max };
    });
  }

  readouts(r: Record<string, number | string | boolean>) {
    r.ikError = this.result ? this.palm.distanceTo(this.target) : 0;
    r.ikReached = this.result ? this.result.reached && this.palm.distanceTo(this.target) < 0.012 : true;
    r.ikLimits = this.result ? this.result.atLimit.map((id) => JOINTS[JOINT_INDEX[id]].label).join(', ') : '';
    r.palmX = this.palm.x;
    r.palmY = this.palm.y;
    r.palmZ = this.palm.z;
    const sh = this.kin.point(`${this.side}_shoulder_link`, [0, 0, 0]);
    r.reachDist = this.palm.distanceTo(sh);
    this.armAngles().forEach((a, i) => (r[`arm${i}`] = a.deg));
  }
}

/** One joint of a servo with speed and acceleration limits (critically damped towards goal). */
function servo(q: Float64Array, v: Float64Array, i: number, goal: number, dt: number): number {
  const wn = 14;
  let a = wn * wn * (goal - q[i]) - 2 * wn * v[i];
  a = Math.max(-SERVO_A, Math.min(SERVO_A, a));
  v[i] = Math.max(-SERVO_V, Math.min(SERVO_V, v[i] + a * dt));
  // never overshoot a close goal by more than the step
  const next = q[i] + v[i] * dt;
  if ((goal - q[i]) * (goal - next) < 0 && Math.abs(v[i]) < 0.5) {
    v[i] = 0;
    return goal;
  }
  return next;
}

/** Sample the palm workspace of one arm by forward kinematics (robot standing at rest). */
export function sampleWorkspace(base: Pose, side: Side, kin: Kinematics, n = 3000): Float32Array {
  const pose = base.clone();
  const ids = ARM_JOINTS(side);
  const out = new Float32Array(n * 3);
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const p = new Vector3();
  for (let k = 0; k < n; k++) {
    // wrist joints hardly move the palm point: sample the four big joints fully, the wrist mid-range
    ids.forEach((id, i) => {
      const j = JOINTS[JOINT_INDEX[id]];
      const lo = i >= 4 ? j.min * 0.3 : j.min;
      const hi = i >= 4 ? j.max * 0.3 : j.max;
      pose.set(id, (lo + (hi - lo) * rnd()) * DEG);
    });
    kin.update(pose);
    kin.point(`${side}_hand`, [0, -DIM.palm, 0.012], p);
    out[k * 3] = p.x;
    out[k * 3 + 1] = p.y;
    out[k * 3 + 2] = p.z;
  }
  return out;
}
