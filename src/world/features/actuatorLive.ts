/**
 * Explore → Actuators: the opened actuator runs a real duty cycle. One stride of walking at
 * 1.0 m/s (recorded from the gait simulation) is replayed through the selected joint's
 * actuator model: output torque and speed → motor torque, speed, current, voltage, losses and
 * efficiency; the winding temperature follows its thermal network in real time.
 *
 * The rotor on screen turns at the real motor speed divided by SLOW (the stride is replayed
 * at the same slowed rate), so the motion is legible; the numbers are the real-time values.
 */
import { JOINT_INDEX } from '../../engine/skeleton';
import { ActuatorThermal, operate, type OperatingPoint } from '../../engine/actuator';
import { recordStride, sampleStride, type DutyCycle } from '../../engine/dutyCycle';
import type { RobotModel } from '../../engine/robot';
import { useApp, type ActuatorView } from '../../state/store';
import type { Feature, World } from '../world';

export const SLOW = 8;

const JOINT: Record<ActuatorView, number> = {
  knee: JOINT_INDEX.L_knee,
  hip: JOINT_INDEX.L_hip_pitch,
  elbow: JOINT_INDEX.L_elbow,
};

export class ActuatorLive implements Feature {
  cycle: DutyCycle | null = null;
  private modelRef: RobotModel | null = null;
  /** Stride time (real seconds into the stride). */
  t = 0;
  op: OperatingPoint | null = null;
  thermal = new Map<ActuatorView, ActuatorThermal>();
  /** Motor angle (visual, slowed), rad. */
  angle = 0;
  /** Fade-in of the motion when the actuator opens, 0 … 1. */
  active = 0;
  /** Recent output torque (Nm) and motor current (A), one sample per frame. */
  hist = { tau: [] as number[], current: [] as number[], speed: [] as number[] };

  update(w: World, dt: number) {
    const on = w.ch.get('actuatorOut') + w.ch.get('explode');
    this.active += ((on > 0.01 ? 1 : 0) - this.active) * Math.min(1, dt * 2);
    if (on < 0.001 && this.active < 0.01) return;
    if (!this.cycle || this.modelRef !== w.model) {
      this.cycle = recordStride(w.model);
      this.modelRef = w.model;
    }
    const sel = useApp.getState().actuator;
    const j = JOINT[sel];
    const cfg = w.model.actuators[j]!;
    let th = this.thermal.get(sel);
    if (!th) {
      th = new ActuatorThermal(cfg.motor, 32);
      this.thermal.set(sel, th);
    }
    this.t += dt / SLOW;
    const s = sampleStride(this.cycle, j, this.t);
    // the elbow barely works while walking with arms swinging: that is the honest result
    this.op = operate(cfg, s.tau, s.qd, th.Tw, th.currentLimit(cfg.peakCurrent));
    th.step(this.op.pCopper, this.op.pFriction, dt, 32);
    this.angle += (this.op.omegaMotor / SLOW) * dt * this.active;
    const h = this.hist;
    h.tau.push(this.op.tauOut);
    h.current.push(this.op.current);
    h.speed.push(this.op.omegaOut);
    if (h.tau.length > 300) {
      h.tau.shift();
      h.current.shift();
      h.speed.shift();
    }
  }

  get joint(): number {
    return JOINT[useApp.getState().actuator];
  }

  get temperature(): number {
    return this.thermal.get(useApp.getState().actuator)?.Tw ?? 32;
  }
}
