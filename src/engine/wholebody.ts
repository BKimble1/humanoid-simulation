/**
 * Whole-body posture: turns a COM target, foot poses and upper-body intentions into joint
 * angles, and checks the result against the mass model.
 *
 * The pelvis is placed so that the whole-body COM (calculated from every mass item) sits
 * where the balance or gait model wants it: a few fixed-point iterations of
 *   pelvis ← pelvis + (c_target − c_actual)   (horizontal only)
 * then both legs are solved in closed form to their foot poses. Arms, waist and neck are set
 * from the task (swing, carry, reach) before the COM is matched, so their mass is accounted
 * for: carrying a box moves the pelvis back.
 */
import { Quaternion, Vector2, Vector3 } from 'three';
import { DIM, type JointId } from '../spec/body';
import type { GaitFrame } from './gait';
import { solveLeg } from './ik';
import { RobotModel } from './robot';
import { DEG, Kinematics, Pose } from './skeleton';

export interface FootTarget {
  ankle: Vector3;
  quat: Quaternion;
}

export interface PostureInput {
  /** Desired whole-body COM in the ground plane (x, z); omit to keep the pelvis where set. */
  com?: Vector2;
  pelvisHeight: number;
  /** Pelvis rotation (yaw, pitch forward, roll), rad. */
  pelvisYaw?: number;
  pelvisPitch?: number;
  pelvisRoll?: number;
  feet: { L: FootTarget; R: FootTarget };
  /** Upper-body joints set directly (degrees), applied before the COM is matched. */
  upper?: Partial<Record<JointId, number>>;
  /** Payload position (world), when carrying. */
  payloadPos?: Vector3;
  iterations?: number;
}

export interface PostureResult {
  pose: Pose;
  com: Vector3;
  reached: boolean;
}

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);

export function pelvisQuat(yaw = 0, pitch = 0, roll = 0, out = new Quaternion()): Quaternion {
  // yaw about Y, then pitch forward (a positive angle tips the pelvis forward: about +X), then roll
  return out.setFromAxisAngle(Y, yaw).multiply(new Quaternion().setFromAxisAngle(X, pitch)).multiply(new Quaternion().setFromAxisAngle(Z, roll));
}

/** Solve a posture. `pose` is modified and returned (its upper body kept unless overridden). */
export function solvePosture(model: RobotModel, kin: Kinematics, pose: Pose, input: PostureInput): PostureResult {
  pelvisQuat(input.pelvisYaw ?? 0, input.pelvisPitch ?? 0, input.pelvisRoll ?? 0, pose.pelvisQuat);
  pose.pelvisPos.y = input.pelvisHeight;
  if (input.upper) pose.setDeg(input.upper);
  let reached = true;
  const iters = input.com ? (input.iterations ?? 4) : 1;
  const c = new Vector3();
  for (let i = 0; i < iters; i++) {
    const a = solveLeg(pose, 'L', input.feet.L.ankle, input.feet.L.quat, kin.scale);
    const b = solveLeg(pose, 'R', input.feet.R.ankle, input.feet.R.quat, kin.scale);
    reached = a.reached && b.reached;
    if (!input.com) break;
    kin.update(pose);
    model.com(kin, input.payloadPos, c);
    pose.pelvisPos.x += input.com.x - c.x;
    pose.pelvisPos.z += input.com.y - c.z;
  }
  if (input.com) {
    const a = solveLeg(pose, 'L', input.feet.L.ankle, input.feet.L.quat, kin.scale);
    const b = solveLeg(pose, 'R', input.feet.R.ankle, input.feet.R.quat, kin.scale);
    reached = a.reached && b.reached;
  }
  kin.update(pose);
  model.com(kin, input.payloadPos, c);
  return { pose, com: c, reached };
}

/** Foot target standing flat at a ground point with a heading. */
export function flatFoot(x: number, z: number, yaw = 0): FootTarget {
  const quat = new Quaternion().setFromAxisAngle(Y, yaw);
  return { ankle: new Vector3(x, DIM.ankleHeight, z), quat };
}

/**
 * Arms for walking: each arm swings with the opposite leg. The swing follows how far the left
 * foot is ahead of the right (a continuous signal, so there is no jump between single and
 * double support), elbows bending a little more as the arm comes forward.
 */
export function walkingArms(legLead: number, stepLength: number, speed: number): Partial<Record<JointId, number>> {
  const amp = 8 + 16 * Math.min(1, speed / 1.5);
  const s = stepLength > 0.01 ? Math.max(-1, Math.min(1, legLead / stepLength)) : 0;
  return {
    L_shoulder_pitch: 4 - amp * s,
    R_shoulder_pitch: 4 + amp * s,
    L_shoulder_roll: 8,
    R_shoulder_roll: 8,
    L_elbow: 20 + amp * 0.35 * (1 - s),
    R_elbow: 20 + amp * 0.35 * (1 + s),
    L_arm_yaw: -6,
    R_arm_yaw: -6,
  };
}

/** Arms holding a box in front at hip height (carry posture), degrees. */
export function carryArms(): Partial<Record<JointId, number>> {
  // upper arms close to vertical, forearms forward: the box is held close to the body, which
  // keeps the shoulder moment arm (and the COM shift) small
  return {
    L_shoulder_pitch: 10,
    R_shoulder_pitch: 10,
    L_shoulder_roll: 8,
    R_shoulder_roll: 8,
    L_arm_yaw: 18,
    R_arm_yaw: 18,
    L_elbow: 84,
    R_elbow: 84,
    L_wrist_yaw: 0,
    R_wrist_yaw: 0,
    L_wrist_pitch: -6,
    R_wrist_pitch: -6,
  };
}

/**
 * Pelvis height while walking. Mid-stance, the leg carries the gait's stance-knee bend; in
 * double support the legs are spread by a step length and must still reach both feet with
 * the knees bent at least ~20° (away from the straight-knee singularity), so the pelvis dips.
 * The two are joined by a cosine at the step frequency: the COM rises in single support and
 * falls in double support, as in human walking, with vertical accelerations of ~0.3 g.
 */
export function gaitPelvisHeight(f: GaitFrame, kin: Kinematics, pelvisComOffset = 0): number {
  const A = DIM.thigh * kin.scale.thigh;
  const B = DIM.shin * kin.scale.shin;
  const legAt = (kneeDeg: number) => Math.sqrt(A * A + B * B + 2 * A * B * Math.cos(kneeDeg * DEG));
  const stand = DIM.ankleHeight + legAt(12);
  const mid = DIM.ankleHeight + legAt(f.gait.stanceKnee);
  const reach = legAt(20);
  // the hips sit over the pelvis, which may be behind the COM (carrying a box shifts it back)
  const half = f.gait.stepLength / 2 + 0.01 + Math.abs(pelvisComOffset) * f.envelope;
  const ds = DIM.ankleHeight + Math.sqrt(Math.max(0.1, reach * reach - half * half)) - 0.004;
  const dip = Math.max(0, mid - ds);
  const e = f.envelope;
  return stand + (mid - stand) * e - dip * e * f.bob;
}

export function poseFromGait(model: RobotModel, kin: Kinematics, pose: Pose, f: GaitFrame, opts: { carry?: boolean; payloadPos?: Vector3 } = {}): PostureResult {
  const speed = f.gait.speed;
  const L = f.feet.L.ankle;
  const R = f.feet.R.ankle;
  // how far the left foot leads the right, along the walking direction
  const lead = L.z - R.z;
  const stepLength = Math.max(0.05, f.gait.stepLength);
  const s = Math.max(-1, Math.min(1, lead / stepLength));
  // the pelvis turns with the leading leg's hip (left foot ahead → pelvis yaws right)
  const yawAmp = (2 + 3 * Math.min(1, speed / 1.5)) * DEG;
  const pelvisYaw = -yawAmp * s;
  // and rolls a little away from the stance side, following the COM over the feet
  const mid = (L.x + R.x) / 2;
  const half = Math.max(0.05, Math.abs(L.x - R.x) / 2);
  const pelvisRoll = -1.5 * DEG * Math.max(-1, Math.min(1, (f.com.x - mid) / half));
  const upper: Partial<Record<JointId, number>> = opts.carry ? carryArms() : walkingArms(lead, stepLength, f.walking ? speed : 0);
  upper.waist_yaw = (-pelvisYaw / DEG) * 0.85;
  upper.neck_yaw = 0;
  upper.neck_pitch = 4;
  // the previous frame's pelvis-to-COM offset (smooth from frame to frame)
  const pelvisHeight = gaitPelvisHeight(f, kin, pose.pelvisPos.z - f.com.z);
  const lean = opts.carry ? -2 : 2 + 3 * Math.min(1, Math.hypot(f.comVel.x, f.comVel.z) / 1.5);
  return solvePosture(model, kin, pose, {
    com: new Vector2(f.com.x, f.com.z),
    pelvisHeight,
    pelvisYaw,
    pelvisRoll,
    pelvisPitch: lean * DEG,
    feet: { L: { ankle: f.feet.L.ankle, quat: f.feet.L.quat }, R: { ankle: f.feet.R.ankle, quat: f.feet.R.quat } },
    upper,
    payloadPos: opts.payloadPos,
    iterations: 3,
  });
}
