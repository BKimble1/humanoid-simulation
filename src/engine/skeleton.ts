/**
 * The kinematic model: FO-H1's joint tree, forward kinematics, and the geometry every other
 * model reads (joint positions and axes, segment frames, sole corners).
 *
 * Built from spec/body.ts. Limb lengths can be scaled (Engineer mode); the joint origins and
 * the mass items along a scaled segment move with it.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { DIM, JOINTS, type JointId, type JointSpec, type SegmentId, type Side } from '../spec/body';

export const DEG = Math.PI / 180;

export interface LimbScale {
  thigh: number;
  shin: number;
  upperArm: number;
  forearm: number;
}

export const UNIT_SCALE: LimbScale = { thigh: 1, shin: 1, upperArm: 1, forearm: 1 };

/** Which scale stretches each segment along its own −Y (the limb's long axis). */
export function segmentScale(seg: SegmentId, s: LimbScale): number {
  if (seg.endsWith('_thigh')) return s.thigh;
  if (seg.endsWith('_shin')) return s.shin;
  if (seg.endsWith('_upper_arm')) return s.upperArm;
  if (seg.endsWith('_forearm') || seg.endsWith('_wrist_link')) return s.forearm;
  return 1;
}

export const JOINT_IDS: JointId[] = JOINTS.map((j) => j.id);
export const JOINT_INDEX: Record<JointId, number> = Object.fromEntries(JOINT_IDS.map((id, i) => [id, i])) as Record<JointId, number>;
export const NJ = JOINTS.length;

/** Segments in topological order (parents first). */
export const SEGMENTS: SegmentId[] = (() => {
  const out: SegmentId[] = ['pelvis'];
  const queue: SegmentId[] = ['pelvis'];
  while (queue.length) {
    const p = queue.shift()!;
    for (const j of JOINTS) if (j.parent === p && !out.includes(j.child)) (out.push(j.child), queue.push(j.child));
  }
  return out;
})();

/** The joint that moves each segment (pelvis: none). */
export const PARENT_JOINT: Partial<Record<SegmentId, number>> = Object.fromEntries(JOINTS.map((j, i) => [j.child, i]));

/** Joint indices from the pelvis to (and including) the joint that moves `seg`. */
export function chainTo(seg: SegmentId): number[] {
  const out: number[] = [];
  let s: SegmentId | undefined = seg;
  while (s && PARENT_JOINT[s] !== undefined) {
    const ji: number = PARENT_JOINT[s]!;
    out.unshift(ji);
    s = JOINTS[ji].parent;
  }
  return out;
}

/** Is `seg` at or below joint `ji` in the tree? */
export function isDistal(seg: SegmentId, ji: number): boolean {
  return chainTo(seg).includes(ji);
}

const _q = new Quaternion();
const _m = new Matrix4();
const _v = new Vector3();

/** Joint origin in its parent's frame, with limb scaling applied. */
export function jointOrigin(j: JointSpec, s: LimbScale, out = new Vector3()): Vector3 {
  out.set(j.origin[0], j.origin[1], j.origin[2]);
  // A joint that sits at the end of a scaled segment moves with the segment's length.
  out.y *= segmentScale(j.parent, s);
  return out;
}

/**
 * A pose of the whole robot: the pelvis frame in the world and every joint angle (radians).
 */
export class Pose {
  q = new Float64Array(NJ);
  pelvisPos = new Vector3(0, DIM.thigh + DIM.shin + DIM.ankleHeight, 0);
  pelvisQuat = new Quaternion();

  copy(o: Pose): this {
    this.q.set(o.q);
    this.pelvisPos.copy(o.pelvisPos);
    this.pelvisQuat.copy(o.pelvisQuat);
    return this;
  }
  clone(): Pose {
    return new Pose().copy(this);
  }
  get(id: JointId): number {
    return this.q[JOINT_INDEX[id]];
  }
  set(id: JointId, rad: number): this {
    this.q[JOINT_INDEX[id]] = rad;
    return this;
  }
  setDeg(values: Partial<Record<JointId, number>>): this {
    for (const k in values) this.q[JOINT_INDEX[k as JointId]] = (values[k as JointId] as number) * DEG;
    return this;
  }
  /** Linear blend towards `b` by t (joint angles and pelvis position; pelvis rotation slerped). */
  lerp(b: Pose, t: number): this {
    for (let i = 0; i < NJ; i++) this.q[i] += (b.q[i] - this.q[i]) * t;
    this.pelvisPos.lerp(b.pelvisPos, t);
    this.pelvisQuat.slerp(b.pelvisQuat, t);
    return this;
  }
}

/** Clamp every joint to its range of motion. */
export function clampToLimits(p: Pose): Pose {
  for (let i = 0; i < NJ; i++) {
    const j = JOINTS[i];
    p.q[i] = Math.min(j.max * DEG, Math.max(j.min * DEG, p.q[i]));
  }
  return p;
}

/**
 * Forward kinematics of the whole tree. `frames` holds each segment's world transform;
 * `jointPos` / `jointAxis` each joint's world position and axis (after its parent's motion,
 * before its own — the axis is fixed in the parent).
 */
export class Kinematics {
  scale: LimbScale = { ...UNIT_SCALE };
  frames = new Map<SegmentId, Matrix4>(SEGMENTS.map((s) => [s, new Matrix4()]));
  jointPos: Vector3[] = JOINTS.map(() => new Vector3());
  jointAxis: Vector3[] = JOINTS.map(() => new Vector3());
  private origins: Vector3[] = JOINTS.map(() => new Vector3());

  constructor(scale?: LimbScale) {
    if (scale) this.setScale(scale);
    else this.setScale(UNIT_SCALE);
  }

  setScale(s: LimbScale) {
    this.scale = { ...s };
    JOINTS.forEach((j, i) => jointOrigin(j, this.scale, this.origins[i]));
  }

  origin(i: number): Vector3 {
    return this.origins[i];
  }

  update(p: Pose): this {
    const root = this.frames.get('pelvis')!;
    root.compose(p.pelvisPos, p.pelvisQuat, _v.set(1, 1, 1));
    for (let i = 0; i < NJ; i++) {
      const j = JOINTS[i];
      const parent = this.frames.get(j.parent)!;
      const o = this.origins[i];
      this.jointPos[i].copy(o).applyMatrix4(parent);
      this.jointAxis[i].set(j.axis[0], j.axis[1], j.axis[2]).transformDirection(parent);
      _q.setFromAxisAngle(_v.set(j.axis[0], j.axis[1], j.axis[2]), p.q[i]);
      _m.compose(o, _q, _v.set(1, 1, 1));
      this.frames.get(j.child)!.multiplyMatrices(parent, _m);
    }
    return this;
  }

  /** A point given in a segment's frame, in the world. */
  point(seg: SegmentId, local: Vector3 | readonly [number, number, number], out = new Vector3()): Vector3 {
    if (Array.isArray(local)) out.set(local[0], local[1], local[2]);
    else out.copy(local as Vector3);
    return out.applyMatrix4(this.frames.get(seg)!);
  }

  /** Sole frame of a foot: the point under the ankle at ground level, oriented with the foot. */
  sole(side: Side, out = new Vector3()): Vector3 {
    return this.point(`${side}_foot`, [0, -DIM.ankleHeight, 0], out);
  }

  /** The four sole corners of a foot in the world (heel-in, heel-out, toe-out, toe-in). */
  soleCorners(side: Side): Vector3[] {
    const w = DIM.footWidth / 2;
    const y = -DIM.ankleHeight;
    return [
      this.point(`${side}_foot`, [-w, y, DIM.heel]),
      this.point(`${side}_foot`, [w, y, DIM.heel]),
      this.point(`${side}_foot`, [w, y, DIM.toe]),
      this.point(`${side}_foot`, [-w, y, DIM.toe]),
    ];
  }

  /** Palm centre of a hand (grasp point), in the world. */
  palm(side: Side, out = new Vector3()): Vector3 {
    return this.point(`${side}_hand`, [0, -DIM.palm, 0.012], out);
  }
}

/** Standing poses used across the simulation (degrees). */
export function restPose(): Pose {
  const p = new Pose();
  p.setDeg({
    L_hip_pitch: 7,
    R_hip_pitch: 7,
    L_knee: 14,
    R_knee: 14,
    L_ankle_pitch: 7,
    R_ankle_pitch: 7,
    L_shoulder_roll: 7,
    R_shoulder_roll: 7,
    L_shoulder_pitch: 4,
    R_shoulder_pitch: 4,
    L_elbow: 14,
    R_elbow: 14,
    L_arm_yaw: -8,
    R_arm_yaw: -8,
    L_wrist_yaw: 0,
    R_wrist_yaw: 0,
  });
  return p;
}
