/**
 * Joint torques from a pose, segment accelerations and contact forces.
 *
 * For each joint, the part of the robot beyond it (its distal subtree D) is in equilibrium
 * under the joint's moment, gravity, contacts and the subtree's own acceleration (Newton–Euler
 * applied to D about the joint):
 *
 *   M_j = Σ_{s∈D} (c_s − p_j) × m_s·(a_s − g)  −  Σ_{k∈D} (p_k − p_j) × F_k
 *   τ_j = axis_j · M_j   (+ J_reflected · q̈_j for the actuator's own rotor)
 *
 * c_s, a_s: segment centres of mass and their accelerations; F_k: contact forces (ground
 * reaction, payload) acting on D. With a = 0 this is exact statics (τ = r × F). The segments'
 * own rotational inertia (dL/dt about their centres) is neglected: a reduced-order model that
 * captures gravity, contact and translational inertia, which dominate in walking and lifting.
 */
import { Vector3 } from 'three';
import { JOINTS, type SegmentId } from '../spec/body';
import { GRAVITY } from '../spec/motion';
import type { RobotModel } from './robot';
import { Kinematics, NJ, SEGMENTS, isDistal } from './skeleton';

export interface ContactForce {
  seg: SegmentId;
  point: Vector3;
  force: Vector3;
}

/** Segments distal to each joint (its subtree). */
export const DISTAL: SegmentId[][] = JOINTS.map((_, ji) => SEGMENTS.filter((s) => isDistal(s, ji)));

const G = new Vector3(0, -GRAVITY, 0);
const _r = new Vector3();
const _f = new Vector3();
const _M = new Vector3();
const _c = new Vector3();

/**
 * Joint torques (Nm, by joint index) the actuators must supply.
 * `acc`: world acceleration of each segment's centre of mass (omit for statics).
 * `extra`: point masses attached to segments (payload), with their own acceleration.
 */
export function jointTorques(
  model: RobotModel,
  kin: Kinematics,
  contacts: ContactForce[],
  acc?: Map<SegmentId, Vector3>,
  extra: { seg: SegmentId; mass: number; point: Vector3; acc?: Vector3 }[] = [],
  out: Float64Array = new Float64Array(NJ),
): Float64Array {
  // world COM of each segment once
  const com = new Map<SegmentId, Vector3>();
  for (const [seg, s] of model.segments) com.set(seg, kin.point(seg, s.com, new Vector3()));
  for (let j = 0; j < NJ; j++) {
    const p = kin.jointPos[j];
    _M.set(0, 0, 0);
    for (const seg of DISTAL[j]) {
      const s = model.segments.get(seg)!;
      if (s.mass === 0) continue;
      _r.subVectors(com.get(seg)!, p);
      _f.copy(acc?.get(seg) ?? _c.set(0, 0, 0)).sub(G).multiplyScalar(s.mass);
      _M.add(_r.cross(_f));
    }
    for (const e of extra) {
      if (!DISTAL[j].includes(e.seg)) continue;
      _r.subVectors(e.point, p);
      _f.copy(e.acc ?? _c.set(0, 0, 0)).sub(G).multiplyScalar(e.mass);
      _M.add(_r.cross(_f));
    }
    for (const k of contacts) {
      if (!DISTAL[j].includes(k.seg)) continue;
      _r.subVectors(k.point, p);
      _M.sub(_r.cross(_f.copy(k.force)));
    }
    out[j] = kin.jointAxis[j].dot(_M);
  }
  return out;
}

/**
 * Split a total ground reaction force applied at a centre of pressure between two feet in
 * double support: the load share follows where the CoP lies between the two ankles.
 * Returns the share on the left foot (0–1).
 */
export function loadShare(cop: Vector3, left: Vector3, right: Vector3): number {
  const dx = left.x - right.x;
  const dz = left.z - right.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return 0.5;
  const t = ((cop.x - right.x) * dx + (cop.z - right.z) * dz) / len2;
  return Math.min(1, Math.max(0, t));
}
