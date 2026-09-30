/**
 * Inverse kinematics.
 *
 * Legs: closed form. The three hip axes intersect at the hip joint and the two ankle axes at
 * the ankle, so the knee angle follows from the hip–ankle distance (law of cosines), the ankle
 * angles from that vector seen in the foot's frame, and the hip angles from the remaining
 * rotation (Kajita et al., Introduction to Humanoid Robotics, §2.5; re-derived here for this
 * robot's axis conventions).
 *
 * Arms: numerical. Seven joints for a six-dimensional task (or three for position only), solved
 * by damped least squares on the geometric Jacobian, with joint limits and a posture term in
 * the null space so the redundant joint stays near a natural elbow position.
 */
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { DIM, JOINTS, type JointId, type SegmentId, type Side } from '../spec/body';
import { DEG, JOINT_INDEX, Kinematics, type LimbScale, Pose, chainTo } from './skeleton';

const _a = new Vector3();
const _b = new Vector3();
const _r = new Vector3();
const _m = new Matrix4();
// scratch for the arm solver (it runs every frame: no allocation in its loop); m ≤ 6, n ≤ 8
const _p = new Vector3();
const _q = new Quaternion();
const _cur = new Quaternion();
const _inv = new Quaternion();
const _err = new Float64Array(6);
const _J = new Float64Array(6 * 8);
const _JJt = new Float64Array(36);
const _dq = new Float64Array(8);
const _z = new Float64Array(8);
const _Jz = new Float64Array(6);
const _y = new Float64Array(6);
const _w = new Float64Array(6);
const _L = new Float64Array(36);
const _t = new Float64Array(8);
const _R = new Matrix3();

export interface LegIKResult {
  reached: boolean;
  /** Distance the ankle target was beyond the leg's reach (0 when reached), m. */
  shortfall: number;
}

/** Rotation-only 3×3 elements (row-major) of a Matrix4. */
function rot(m: Matrix4): number[] {
  const e = m.elements; // column-major
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
}
function mul3(a: number[], b: number[]): number[] {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
}
function tr3(a: number[]): number[] {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}
function rx(t: number): number[] {
  const c = Math.cos(t), s = Math.sin(t);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function rz(t: number): number[] {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/**
 * Solve one leg so that its foot frame (at the ankle joint) reaches `anklePos` with orientation
 * `footQuat`, for the pelvis pose already in `pose`. Writes the six joint angles into `pose`.
 */
export function solveLeg(pose: Pose, side: Side, anklePos: Vector3, footQuat: Quaternion, scale: LimbScale): LegIKResult {
  const s = side === 'L' ? 1 : -1;
  const A = DIM.thigh * scale.thigh;
  const B = DIM.shin * scale.shin;
  // hip joint in the world
  const hip = _a.set(s * DIM.hipHalfWidth, 0, 0).applyQuaternion(pose.pelvisQuat).add(pose.pelvisPos);
  const Rp = rot(_m.makeRotationFromQuaternion(pose.pelvisQuat));
  const Rf = rot(_m.makeRotationFromQuaternion(footQuat));
  // hip relative to ankle, in the foot frame
  _r.subVectors(hip, anklePos);
  const d = [_r.x, _r.y, _r.z];
  const RfT = tr3(Rf);
  const r = [RfT[0] * d[0] + RfT[1] * d[1] + RfT[2] * d[2], RfT[3] * d[0] + RfT[4] * d[1] + RfT[5] * d[2], RfT[6] * d[0] + RfT[7] * d[1] + RfT[8] * d[2]];
  let C = Math.hypot(r[0], r[1], r[2]);
  const maxC = (A + B) * 0.99999;
  const minC = Math.abs(A - B) + 1e-4;
  let shortfall = 0;
  if (C > maxC) {
    shortfall = C - maxC;
    C = maxC;
  } else if (C < minC) C = minC;
  // knee (canonical angle about +X; flexion positive)
  const ck = Math.min(1, Math.max(-1, (C * C - A * A - B * B) / (2 * A * B)));
  const thk = Math.acos(ck);
  // ankle roll about +Z: r = Rz(−φa)·v with v in the y–z plane
  const phia = Math.atan2(r[0], r[1]);
  const vy = Math.hypot(r[0], r[1]);
  const vz = r[2];
  // u = hip-from-ankle before the ankle pitch: (0, A cos θk + B, −A sin θk)
  const uy = A * Math.cos(thk) + B;
  const uz = -A * Math.sin(thk);
  const tha = Math.atan2(uz, uy) - Math.atan2(vz, vy);
  // hip: Ry(ψ)·Rz(φ)·Rx(θh) = Rpᵀ·Rf·Rz(−φa)·Rx(−θa)·Rx(−θk)
  const M = mul3(mul3(mul3(tr3(Rp), Rf), rz(-phia)), rx(-tha - thk));
  const phi = Math.asin(Math.min(1, Math.max(-1, M[3])));
  const psi = Math.atan2(-M[6], M[0]);
  const thh = Math.atan2(-M[5], M[4]);
  pose.set(`${side}_hip_yaw`, s * psi);
  pose.set(`${side}_hip_roll`, s * phi);
  pose.set(`${side}_hip_pitch`, -thh);
  pose.set(`${side}_knee`, thk);
  pose.set(`${side}_ankle_pitch`, -tha);
  pose.set(`${side}_ankle_roll`, s * phia);
  return { reached: shortfall === 0, shortfall };
}

/** Ankle-joint position for a sole point on the ground (the ankle sits `ankleHeight` above). */
export function ankleFromSole(sole: Vector3, footQuat: Quaternion, out = new Vector3()): Vector3 {
  return out.set(0, DIM.ankleHeight, 0).applyQuaternion(footQuat).add(sole);
}

// ───────────────────────────── arm IK ─────────────────────────────

export const ARM_JOINTS = (side: Side): JointId[] => [
  `${side}_shoulder_pitch`,
  `${side}_shoulder_roll`,
  `${side}_arm_yaw`,
  `${side}_elbow`,
  `${side}_wrist_yaw`,
  `${side}_wrist_pitch`,
  `${side}_wrist_roll`,
];

/** Natural posture the redundancy resolves towards (degrees), per joint of ARM_JOINTS. */
const ARM_REST_DEG = [20, 12, -10, 60, 0, 0, 0];

export interface ArmIKOptions {
  /** Also match the palm orientation (6-D task); otherwise position only. */
  orientation?: Quaternion;
  iterations?: number;
  /** Damping λ of the least-squares step. */
  damping?: number;
  /** Include the waist yaw in the chain. */
  useWaist?: boolean;
}

export interface ArmIKResult {
  /** Remaining position error, m. */
  error: number;
  /** Remaining orientation error, rad (0 when orientation is not requested). */
  angleError: number;
  reached: boolean;
  iterations: number;
  /** Joints that ended at a limit. */
  atLimit: JointId[];
}

/** The tool point of a hand: palm centre, slightly in front of the palm surface. */
export const PALM_POINT: [number, number, number] = [0, -DIM.palm, 0.012];

/**
 * Damped-least-squares IK for one arm (optionally with the waist). Modifies `pose` in place;
 * `kin` is used as scratch and ends updated to the result.
 */
export function solveArm(pose: Pose, side: Side, target: Vector3, kin: Kinematics, opts: ArmIKOptions = {}): ArmIKResult {
  const ids = opts.useWaist ? (['waist_yaw', ...ARM_JOINTS(side)] as JointId[]) : ARM_JOINTS(side);
  const idx = ids.map((id) => JOINT_INDEX[id]);
  const n = idx.length;
  const rest = opts.useWaist ? [0, ...ARM_REST_DEG] : ARM_REST_DEG;
  const iterations = opts.iterations ?? 40;
  const lambda = opts.damping ?? 0.06;
  const wantRot = !!opts.orientation;
  const m = wantRot ? 6 : 3;
  const hand: SegmentId = `${side}_hand`;
  const p = _p;
  const err = _err;
  const J = _J;
  let iter = 0;
  let posErr = 0;
  let angErr = 0;
  const qTmp = _q;
  const cur = _cur;
  for (; iter < iterations; iter++) {
    kin.update(pose);
    kin.point(hand, PALM_POINT, p);
    err[0] = target.x - p.x;
    err[1] = target.y - p.y;
    err[2] = target.z - p.z;
    posErr = Math.hypot(err[0], err[1], err[2]);
    if (wantRot) {
      cur.setFromRotationMatrix(kin.frames.get(hand)!);
      qTmp.copy(opts.orientation!).multiply(_inv.copy(cur).invert());
      if (qTmp.w < 0) qTmp.set(-qTmp.x, -qTmp.y, -qTmp.z, -qTmp.w);
      const ang = 2 * Math.acos(Math.min(1, qTmp.w));
      const sn = Math.sqrt(Math.max(1e-12, 1 - qTmp.w * qTmp.w));
      angErr = ang;
      const k = 0.5; // orientation weight (m per rad)
      err[3] = (qTmp.x / sn) * ang * k;
      err[4] = (qTmp.y / sn) * ang * k;
      err[5] = (qTmp.z / sn) * ang * k;
    }
    if (posErr < 5e-4 && (!wantRot || angErr < 0.01)) break;
    // geometric Jacobian
    for (let c = 0; c < n; c++) {
      const ji = idx[c];
      const a = kin.jointAxis[ji];
      _b.subVectors(p, kin.jointPos[ji]);
      _a.crossVectors(a, _b);
      J[c] = _a.x;
      J[n + c] = _a.y;
      J[2 * n + c] = _a.z;
      if (wantRot) {
        J[3 * n + c] = a.x * 0.5;
        J[4 * n + c] = a.y * 0.5;
        J[5 * n + c] = a.z * 0.5;
      }
    }
    // Δq = Jᵀ (J Jᵀ + λ² I)⁻¹ e  +  (I − J⁺J) k (q_rest − q)
    const JJt = _JJt;
    for (let i = 0; i < m; i++)
      for (let j = 0; j < m; j++) {
        let sum = 0;
        for (let c = 0; c < n; c++) sum += J[i * n + c] * J[j * n + c];
        JJt[i * m + j] = sum + (i === j ? lambda * lambda : 0);
      }
    const y = solveSym(JJt, err, m, _y);
    const dq = _dq;
    for (let c = 0; c < n; c++) {
      let sum = 0;
      for (let i = 0; i < m; i++) sum += J[i * n + c] * y[i];
      dq[c] = sum;
    }
    // posture in the null space (approximate projector with the damped pseudo-inverse)
    const z = _z;
    for (let c = 0; c < n; c++) z[c] = 0.08 * (rest[c] * DEG - pose.q[idx[c]]);
    const Jz = _Jz;
    for (let i = 0; i < m; i++) {
      let sum = 0;
      for (let c = 0; c < n; c++) sum += J[i * n + c] * z[c];
      Jz[i] = sum;
    }
    const w = solveSym(JJt, Jz, m, _w);
    for (let c = 0; c < n; c++) {
      let sum = 0;
      for (let i = 0; i < m; i++) sum += J[i * n + c] * w[i];
      dq[c] += z[c] - sum;
    }
    // step limit and joint limits
    let maxStep = 0;
    for (let c = 0; c < n; c++) maxStep = Math.max(maxStep, Math.abs(dq[c]));
    const scale = maxStep > 0.2 ? 0.2 / maxStep : 1;
    for (let c = 0; c < n; c++) {
      const j = JOINTS[idx[c]];
      pose.q[idx[c]] = Math.min(j.max * DEG, Math.max(j.min * DEG, pose.q[idx[c]] + dq[c] * scale));
    }
  }
  kin.update(pose);
  kin.point(hand, PALM_POINT, p);
  posErr = p.distanceTo(target);
  const atLimit = ids.filter((id) => {
    const j = JOINTS[JOINT_INDEX[id]];
    const q = pose.q[JOINT_INDEX[id]] / DEG;
    return q <= j.min + 0.5 || q >= j.max - 0.5;
  });
  return { error: posErr, angleError: angErr, reached: posErr < 0.01, iterations: iter, atLimit };
}

/** Solve a small symmetric positive-definite system by Cholesky (into `out`, if given; n ≤ 6
 * uses shared scratch, so the result must be used before the next call). */
export function solveSym(A: Float64Array, b: Float64Array, n: number, out?: Float64Array): Float64Array {
  const small = n <= 6;
  const L = small ? _L.fill(0, 0, n * n) : new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j];
      for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k];
      if (i === j) L[i * n + i] = Math.sqrt(Math.max(sum, 1e-12));
      else L[i * n + j] = sum / L[j * n + j];
    }
  const y = small ? _t : new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i * n + k] * y[k];
    y[i] = sum / L[i * n + i];
  }
  const x = out ?? new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= L[k * n + i] * x[k];
    x[i] = sum / L[i * n + i];
  }
  return x;
}

/** Jacobian (3 × chain) of a point on `seg`, for inspection and statics. */
export function pointJacobian(kin: Kinematics, seg: SegmentId, point: Vector3): { joints: number[]; J: Vector3[] } {
  const joints = chainTo(seg);
  return {
    joints,
    J: joints.map((ji) => new Vector3().crossVectors(kin.jointAxis[ji], _b.subVectors(point, kin.jointPos[ji]))),
  };
}

// exported for tests
export const __internal = { rot, mul3, tr3, _R };
