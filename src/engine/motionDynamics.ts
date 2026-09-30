/**
 * Joint torques for a moving robot, frame by frame: segment and joint accelerations by finite
 * differences over successive poses, the ground reaction from Newton's law for the whole body,
 * its point of application from the moment balance (the ZMP of the multibody model), shared
 * between the feet, then engine/dynamics.ts for each joint, plus each actuator's reflected rotor
 * inertia N²·J·q̈.
 */
import { Vector2, Vector3 } from 'three';
import type { SegmentId, Side } from '../spec/body';
import { GRAVITY } from '../spec/motion';
import { type P2, clampToPolygon, footPolygon, convexHull } from './balance';
import { jointTorques, loadShare, type ContactForce } from './dynamics';
import { ratings } from './actuator';
import type { RobotModel } from './robot';
import { Kinematics, NJ, Pose, SEGMENTS } from './skeleton';

export interface FootContact {
  side: Side;
  /** Contact polygon of this foot on the ground (x, z); empty when in the air. */
  polygon: P2[];
  ankle: Vector3;
}

export interface DynamicsResult {
  tau: Float64Array;
  qd: Float64Array;
  qdd: Float64Array;
  /** Ground reaction force on each foot (world), N, and its centre of pressure. */
  grf: Record<Side, { force: Vector3; cop: Vector3; load: number }>;
  zmp: Vector3;
  totalForce: Vector3;
  com: Vector3;
}

export class MotionDynamics {
  model: RobotModel;
  kin: Kinematics;
  private hist: { q: Float64Array; coms: Map<SegmentId, Vector3>; payload: Vector3 | null }[] = [];
  private reflected: Float64Array;
  result: DynamicsResult;

  constructor(model: RobotModel) {
    this.model = model;
    this.kin = new Kinematics(model.config.scale);
    this.reflected = new Float64Array(NJ);
    model.actuatorRatings.forEach((r, i) => (this.reflected[i] = r ? r.reflectedInertia : 0.05));
    this.result = {
      tau: new Float64Array(NJ),
      qd: new Float64Array(NJ),
      qdd: new Float64Array(NJ),
      grf: { L: { force: new Vector3(), cop: new Vector3(), load: 0.5 }, R: { force: new Vector3(), cop: new Vector3(), load: 0.5 } },
      zmp: new Vector3(),
      totalForce: new Vector3(),
      com: new Vector3(),
    };
  }

  reset() {
    this.hist = [];
  }

  /** Feed the next pose (dt after the previous one) and its contacts. */
  update(pose: Pose, dt: number, feet: FootContact[], payloadPos: Vector3 | null = null): DynamicsResult {
    const kin = this.kin.update(pose);
    const coms = this.model.segmentComs(kin);
    this.hist.push({ q: Float64Array.from(pose.q), coms, payload: payloadPos?.clone() ?? null });
    if (this.hist.length > 3) this.hist.shift();
    const h = this.hist;
    const n = h.length;
    const r = this.result;
    // joint velocities and accelerations (backward differences)
    for (let i = 0; i < NJ; i++) {
      r.qd[i] = n >= 2 ? (h[n - 1].q[i] - h[n - 2].q[i]) / dt : 0;
      r.qdd[i] = n >= 3 ? (h[n - 1].q[i] - 2 * h[n - 2].q[i] + h[n - 3].q[i]) / (dt * dt) : 0;
    }
    const acc = new Map<SegmentId, Vector3>();
    for (const seg of SEGMENTS) {
      const a = new Vector3();
      if (n >= 3) a.copy(h[n - 1].coms.get(seg)!).addScaledVector(h[n - 2].coms.get(seg)!, -2).add(h[n - 3].coms.get(seg)!).divideScalar(dt * dt);
      acc.set(seg, a);
    }
    let payAcc: Vector3 | undefined;
    if (payloadPos && n >= 3 && h[n - 2].payload && h[n - 3].payload) payAcc = payloadPos.clone().addScaledVector(h[n - 2].payload!, -2).add(h[n - 3].payload!).divideScalar(dt * dt);
    // Newton for the whole body and the moment balance about the origin → force and ZMP
    const g = new Vector3(0, -GRAVITY, 0);
    const F = new Vector3();
    const M = new Vector3();
    const com = new Vector3();
    let mass = 0;
    const tmp = new Vector3();
    for (const [seg, s] of this.model.segments) {
      const c = coms.get(seg)!;
      const f = tmp.copy(acc.get(seg)!).sub(g).multiplyScalar(s.mass);
      F.add(f);
      M.add(new Vector3().crossVectors(c, f));
      com.addScaledVector(c, s.mass);
      mass += s.mass;
    }
    const payloadMass = this.model.config.payload;
    const extra: { seg: SegmentId; mass: number; point: Vector3; acc?: Vector3 }[] = [];
    if (payloadMass > 0 && payloadPos) {
      const f = new Vector3().copy(payAcc ?? new Vector3()).sub(g).multiplyScalar(payloadMass);
      F.add(f);
      M.add(new Vector3().crossVectors(payloadPos, f));
      com.addScaledVector(payloadPos, payloadMass);
      mass += payloadMass;
      // Held between the palms: the box is a rigid bridge, so each hand carries half the load
      // at its own palm (same total force and moment as the box's weight at its centre).
      extra.push({ seg: 'L_hand', mass: payloadMass / 2, point: kin.palm('L'), acc: payAcc }, { seg: 'R_hand', mass: payloadMass / 2, point: kin.palm('R'), acc: payAcc });
    }
    r.com.copy(com).divideScalar(mass);
    r.totalForce.copy(F);
    const Fy = Math.max(1, F.y);
    r.zmp.set(M.z / Fy, 0, -M.x / Fy);
    // share between the feet in contact
    const down = feet.filter((f) => f.polygon.length > 0);
    const contacts: ContactForce[] = [];
    r.grf.L.force.set(0, 0, 0);
    r.grf.R.force.set(0, 0, 0);
    r.grf.L.load = 0;
    r.grf.R.load = 0;
    const zmp2 = new Vector2(r.zmp.x, r.zmp.z);
    if (down.length === 1) {
      const f = down[0];
      const cop = clampToPolygon(convexHull(f.polygon), zmp2, 0);
      r.grf[f.side].force.copy(F);
      r.grf[f.side].cop.set(cop.x, 0, cop.y);
      r.grf[f.side].load = 1;
      contacts.push({ seg: `${f.side}_foot`, point: r.grf[f.side].cop.clone(), force: F.clone() });
    } else if (down.length === 2) {
      const L = down.find((f) => f.side === 'L')!;
      const R = down.find((f) => f.side === 'R')!;
      const a = loadShare(r.zmp, L.ankle, R.ankle);
      const mid = new Vector2(a * L.ankle.x + (1 - a) * R.ankle.x, a * L.ankle.z + (1 - a) * R.ankle.z);
      const d = zmp2.clone().sub(mid);
      for (const [f, w] of [
        [L, a],
        [R, 1 - a],
      ] as const) {
        const cop = clampToPolygon(convexHull(f.polygon), new Vector2(f.ankle.x + d.x, f.ankle.z + d.y), 0);
        const force = F.clone().multiplyScalar(w);
        r.grf[f.side].force.copy(force);
        r.grf[f.side].cop.set(cop.x, 0, cop.y);
        r.grf[f.side].load = w;
        contacts.push({ seg: `${f.side}_foot`, point: r.grf[f.side].cop.clone(), force });
      }
    }
    jointTorques(this.model, kin, contacts, acc, extra, r.tau);
    for (let i = 0; i < NJ; i++) r.tau[i] += this.reflected[i] * r.qdd[i];
    return r;
  }
}

/** Contact polygon of a flat foot at an ankle position with a yaw. */
export function flatContact(side: Side, ankle: Vector3, yaw: number): FootContact {
  return { side, ankle: ankle.clone(), polygon: footPolygon(ankle.x, ankle.z, yaw) };
}

export { ratings };
