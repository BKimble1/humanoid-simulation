/**
 * One steady stride of walking, recorded from the gait generator and the reduced-order
 * dynamics: every joint's torque and speed at 100 Hz. Explore → Actuators replays it through
 * the selected actuator's model (slowed down so the rotor can be followed), so the live motor
 * speed, current and losses on screen are those of a real walking duty cycle, not an
 * invented animation.
 */
import { GAITS, LOCOMOTION, type GaitSpec } from '../spec/motion';
import { footPolygon } from './balance';
import { GaitGenerator } from './gait';
import { MotionDynamics } from './motionDynamics';
import type { RobotModel } from './robot';
import { Kinematics, NJ, Pose } from './skeleton';
import { poseFromGait } from './wholebody';

export interface DutyCycle {
  gait: GaitSpec;
  dt: number;
  /** Samples in one stride (two steps). */
  n: number;
  /** tau[k * NJ + j], qd[k * NJ + j]. */
  tau: Float32Array;
  qd: Float32Array;
}

export function recordStride(model: RobotModel, gait: GaitSpec = GAITS.normal, carry = false): DutyCycle {
  const gen = new GaitGenerator(undefined, LOCOMOTION.comHeight - 0.015);
  const kin = new Kinematics(model.config.scale);
  const md = new MotionDynamics(model);
  const pose = new Pose();
  gen.walk(gait);
  const n = Math.round((2 * gait.stepTime) / gen.dt);
  const settle = 300;
  const tau = new Float32Array(n * NJ);
  const qd = new Float32Array(n * NJ);
  for (let i = 0; i < settle + n; i++) {
    gen.tick();
    const f = gen.frame;
    const res = poseFromGait(model, kin, pose, f, { carry });
    kin.update(res.pose);
    const pay = carry ? kin.palm('L').add(kin.palm('R')).multiplyScalar(0.5) : null;
    const contacts = (['L', 'R'] as const).map((s) => ({
      side: s,
      ankle: f.feet[s].ankle.clone(),
      polygon: f.feet[s].contact === 'air' ? [] : footPolygon(f.feet[s].step.x, f.feet[s].step.z, f.feet[s].step.yaw),
    }));
    const r = md.update(res.pose, gen.dt, contacts, pay);
    if (i < settle) continue;
    const k = i - settle;
    for (let j = 0; j < NJ; j++) {
      tau[k * NJ + j] = r.tau[j];
      qd[k * NJ + j] = r.qd[j];
    }
  }
  return { gait, dt: gen.dt, n, tau, qd };
}

/** Torque and speed of joint j at time t (s) into the (repeating) stride, interpolated. */
export function sampleStride(c: DutyCycle, j: number, t: number): { tau: number; qd: number } {
  const T = c.n * c.dt;
  const u = (((t % T) + T) % T) / c.dt;
  const k0 = Math.floor(u) % c.n;
  const k1 = (k0 + 1) % c.n;
  const a = u - Math.floor(u);
  return {
    tau: c.tau[k0 * NJ + j] * (1 - a) + c.tau[k1 * NJ + j] * a,
    qd: c.qd[k0 * NJ + j] * (1 - a) + c.qd[k1 * NJ + j] * a,
  };
}
