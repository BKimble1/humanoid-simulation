/**
 * Collision proxies for FO-H1: a few capsules that enclose each body segment, updated from the
 * displayed pose. The camera director keeps its path outside them (with the near plane's
 * clearance) and the developer telemetry measures how close the camera comes. They are
 * deliberately a little generous: a camera that grazes a proxy is still clear of the shell.
 */
import { Vector3 } from 'three';
import type { Side, SegmentId } from '../spec/body';
import type { Kinematics } from '../engine/skeleton';

export interface Capsule {
  /** Name, for telemetry ("L_thigh"…). */
  id: string;
  a: Vector3;
  b: Vector3;
  r: number;
}

type End = { seg: SegmentId; local: [number, number, number] };
interface Def {
  id: string;
  a: End;
  b: End;
  r: number;
}

const O: [number, number, number] = [0, 0, 0];

function defs(): Def[] {
  const d: Def[] = [
    { id: 'torso', a: { seg: 'pelvis', local: [0, 0.05, -0.01] }, b: { seg: 'neck', local: [0, -0.08, -0.02] }, r: 0.165 },
    { id: 'shoulders', a: { seg: 'L_shoulder_link', local: O }, b: { seg: 'R_shoulder_link', local: O }, r: 0.085 },
    { id: 'head', a: { seg: 'head', local: [0, 0.03, 0.01] }, b: { seg: 'head', local: [0, 0.17, 0.01] }, r: 0.12 },
    { id: 'hips', a: { seg: 'L_thigh', local: O }, b: { seg: 'R_thigh', local: O }, r: 0.115 },
  ];
  for (const s of ['L', 'R'] as Side[]) {
    d.push(
      { id: `${s}_thigh`, a: { seg: `${s}_thigh`, local: O }, b: { seg: `${s}_shin`, local: O }, r: 0.085 },
      { id: `${s}_shin`, a: { seg: `${s}_shin`, local: O }, b: { seg: `${s}_foot`, local: O }, r: 0.07 },
      { id: `${s}_foot`, a: { seg: `${s}_foot`, local: [0, -0.045, -0.05] }, b: { seg: `${s}_foot`, local: [0, -0.05, 0.15] }, r: 0.055 },
      { id: `${s}_upper_arm`, a: { seg: `${s}_upper_arm`, local: O }, b: { seg: `${s}_forearm`, local: O }, r: 0.065 },
      { id: `${s}_forearm`, a: { seg: `${s}_forearm`, local: O }, b: { seg: `${s}_hand`, local: O }, r: 0.058 },
      { id: `${s}_hand`, a: { seg: `${s}_hand`, local: [0, -0.02, 0] }, b: { seg: `${s}_hand`, local: [0, -0.15, 0.01] }, r: 0.05 },
    );
  }
  return d;
}

export class RobotProxies {
  private d = defs();
  capsules: Capsule[] = this.d.map((x) => ({ id: x.id, a: new Vector3(), b: new Vector3(), r: x.r }));

  /** Refresh from kinematics already updated to the displayed pose. */
  update(kin: Kinematics) {
    for (let i = 0; i < this.d.length; i++) {
      const x = this.d[i];
      const c = this.capsules[i];
      kin.point(x.a.seg, x.a.local, c.a);
      kin.point(x.b.seg, x.b.local, c.b);
    }
    return this;
  }
}

const _ab = new Vector3();
const _ap = new Vector3();

/** Distance from p to the capsule's surface (negative inside) and the closest axis point. */
export function capsuleDistance(c: { a: Vector3; b: Vector3; r: number }, p: Vector3, closest?: Vector3): number {
  _ab.subVectors(c.b, c.a);
  _ap.subVectors(p, c.a);
  const L2 = _ab.lengthSq();
  const t = L2 > 1e-12 ? Math.min(1, Math.max(0, _ap.dot(_ab) / L2)) : 0;
  const cx = c.a.x + _ab.x * t;
  const cy = c.a.y + _ab.y * t;
  const cz = c.a.z + _ab.z * t;
  if (closest) closest.set(cx, cy, cz);
  return Math.hypot(p.x - cx, p.y - cy, p.z - cz) - c.r;
}

/** Nearest clearance from p to any capsule (m, negative inside) and which one. */
export function clearance(caps: readonly { a: Vector3; b: Vector3; r: number; id?: string }[], p: Vector3): { d: number; id: string } {
  let d = Infinity;
  let id = '';
  for (const c of caps) {
    const x = capsuleDistance(c, p);
    if (x < d) {
      d = x;
      id = c.id ?? '';
    }
  }
  return { d, id };
}
