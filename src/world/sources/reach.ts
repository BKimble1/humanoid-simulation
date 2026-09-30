/**
 * Kinematics lab: FO-H1 standing (COM-controlled), one arm following a target.
 *
 * IK mode: the target is dragged in the scene; damped-least-squares IK (engine/ik.ts) moves
 * the arm's seven joints so the palm reaches it, keeping a natural elbow through the
 * null-space posture term. A target out of reach leaves the palm at the closest point the arm
 * can get to, the joints at their limits named.
 * FK mode: the joint angles are set directly; the palm position is computed forward.
 * The workspace is sampled once by forward kinematics over the joint ranges.
 */
import { Vector2, Vector3 } from 'three';
import { DIM, JOINTS, type JointId, type Side } from '../../spec/body';
import { ARM_JOINTS, solveArm, type ArmIKResult } from '../../engine/ik';
import type { RobotModel } from '../../engine/robot';
import { DEG, JOINT_INDEX, Kinematics, Pose } from '../../engine/skeleton';
import { flatFoot, solvePosture } from '../../engine/wholebody';
import type { FootPose, PoseSource } from '../pose';

export class ReachSource implements PoseSource {
  id = 'reach';
  pose = new Pose();
  feet: Record<Side, FootPose>;
  side: Side = 'L';
  mode: 'ik' | 'fk' = 'ik';
  target = new Vector3(0.28, 1.12, 0.38);
  /** FK mode joint angles (deg) for the active arm. */
  fk: number[] = [20, 12, -10, 60, 0, 0, 0];
  result: ArmIKResult | null = null;
  palm = new Vector3();
  private kin: Kinematics;
  private stand: number;
  private armQ = new Map<Side, Float64Array>();
  private t = 0;

  constructor(
    private model: () => RobotModel,
    kin: Kinematics,
  ) {
    this.kin = kin;
    this.stand = DIM.ankleHeight + (DIM.thigh + DIM.shin) * Math.cos(12 * DEG) - 0.004;
    this.feet = { L: flatFoot(DIM.hipHalfWidth, 0), R: flatFoot(-DIM.hipHalfWidth, 0) };
  }

  enter(from: Pose) {
    this.pose.copy(from);
  }

  update(dt: number) {
    this.t += dt;
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
    // keep the working arm's joints from the last frame (IK warm start)
    const ids = ARM_JOINTS(this.side);
    const prev = this.armQ.get(this.side);
    if (prev) ids.forEach((id, i) => this.pose.set(id, prev[i]));
    this.feet = { L: flatFoot(DIM.hipHalfWidth, 0), R: flatFoot(-DIM.hipHalfWidth, 0) };
    const sway = 0.002 * Math.sin(this.t * 1.3);
    // the arm moves the COM: the posture solver shifts the pelvis to keep it over the feet
    for (let k = 0; k < 2; k++) {
      solvePosture(this.model(), this.kin, this.pose, { com: new Vector2(sway, 0.035), pelvisHeight: this.stand, pelvisPitch: 1.5 * DEG, feet: this.feet, upper: rest, iterations: 2 });
      if (this.mode === 'ik') this.result = solveArm(this.pose, this.side, this.target, this.kin, { iterations: 24 });
      else {
        ids.forEach((id, i) => {
          const j = JOINTS[JOINT_INDEX[id]];
          this.pose.set(id, Math.min(j.max, Math.max(j.min, this.fk[i])) * DEG);
        });
        this.result = null;
      }
    }
    this.armQ.set(this.side, Float64Array.from(ids.map((id) => this.pose.q[JOINT_INDEX[id]])));
    this.kin.update(this.pose);
    this.kin.point(`${this.side}_hand`, [0, -DIM.palm, 0.012], this.palm);
    if (this.mode === 'fk') this.target.copy(this.palm);
    // look at the hand
    const head = this.kin.point('neck', [0, DIM.neckLength, 0]);
    const d = this.palm.clone().sub(head);
    this.pose.set('neck_yaw', Math.max(-1, Math.min(1, Math.atan2(d.x, d.z))) * 0.6);
    this.pose.set('neck_pitch', Math.max(-0.4, Math.min(0.6, -Math.atan2(d.y, Math.hypot(d.x, d.z)))) * 0.7);
  }

  /** Joint angles of the active arm now (deg). */
  armAngles(): { id: JointId; label: string; deg: number; min: number; max: number }[] {
    return ARM_JOINTS(this.side).map((id) => {
      const j = JOINTS[JOINT_INDEX[id]];
      return { id, label: j.label, deg: this.pose.q[JOINT_INDEX[id]] / DEG, min: j.min, max: j.max };
    });
  }

  readouts(r: Record<string, number | string | boolean>) {
    r.ikError = this.result ? this.result.error : 0;
    r.ikReached = this.result ? this.result.reached : true;
    r.ikLimits = this.result ? this.result.atLimit.map((id) => JOINTS[JOINT_INDEX[id]].label).join(', ') : '';
    r.palmX = this.palm.x;
    r.palmY = this.palm.y;
    r.palmZ = this.palm.z;
    const sh = this.kin.point(`${this.side}_shoulder_link`, [0, 0, 0]);
    r.reachDist = this.palm.distanceTo(sh);
    this.armAngles().forEach((a, i) => (r[`arm${i}`] = a.deg));
  }
}

/** Sample the palm workspace of one arm by forward kinematics (robot standing at rest). */
export function sampleWorkspace(base: Pose, side: Side, kin: Kinematics, n = 3000): Float32Array {
  const pose = base.clone();
  const ids = ARM_JOINTS(side);
  const out = new Float32Array(n * 3);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
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
