/**
 * The joint test rig: FO-H1's knee on a fixture, thigh horizontal, lifting its own shin and
 * foot plus a payload strapped at the ankle. Everything between the command and the motion is
 * simulated at 10 kHz:
 *
 *   target angle ─▶ minimum-jerk trajectory ─▶ joint controller (PID + model feed-forward)
 *     ─▶ current command ─▶ current loop (first-order, 1.5 kHz bandwidth, current and voltage
 *     limits) ─▶ motor torque Kt·I ─▶ reducer (N, η or η_back, friction) ─▶ output torque
 *     ─▶ joint dynamics (link + payload + N²·J_rotor) ─▶ measured angle (19-bit encoder)
 *
 * Gravity on the shin: τ_g = m·g·r·cos(q) towards flexion (q = 0 is the shin horizontal).
 * The controller's feed-forward knows the shin but not the payload: the integral term and
 * feedback make up the rest, which is what a real joint controller has to do.
 */
import { ACTUATORS } from '../spec/actuators';
import { DIM } from '../spec/body';
import { GRAVITY } from '../spec/motion';
import { ActuatorThermal, configureActuator, ktAt, resistanceAt, usableVoltage, type ActuatorConfig, type RotaryReducer } from './actuator';

export interface RigSettings {
  ratio: number;
  reducer: RotaryReducer;
  payload: number;
  /** Peak joint speed allowed for the move, deg/s. */
  speed: number;
  /** Bus voltage (battery), V. */
  bus: number;
  stackScale: number;
  peakCurrent: number;
}

export const DEFAULT_RIG: RigSettings = { ratio: 30, reducer: 'cycloidal', payload: 5, speed: 180, bus: 50.4, stackScale: 1, peakCurrent: ACTUATORS.A100.peakCurrent };

/** The shin, ankle and foot as seen from the knee (from the mass budget): mass, first and
 * second moments. */
export const SHIN = (() => {
  // shin segment (2.2 kg incl. ankle actuators), ankle cross 0.1 kg, foot 1.0 kg
  const parts: [number, number][] = [
    [0.7, 0.2], // member
    [0.3, 0.17], // covers
    [1.1, 0.13], // ankle actuators, high on the shin
    [0.1, 0.31], // push rods
    [0.1, DIM.shin], // ankle cross
    [1.0, DIM.shin + 0.04], // foot and F/T sensor (its COM ahead of the ankle)
  ];
  const m = parts.reduce((a, [mm]) => a + mm, 0);
  const mr = parts.reduce((a, [mm, r]) => a + mm * r, 0);
  const I = parts.reduce((a, [mm, r]) => a + mm * r * r, 0) + (1 / 12) * 1.0 * DIM.shin * DIM.shin;
  return { m, mr, I };
})();

/** Payload cuff radius from the knee axis, m. */
export const CUFF_R = DIM.shin - 0.02;

export interface RigSample {
  t: number;
  qRef: number;
  q: number;
  qd: number;
  current: number;
  tauOut: number;
}

export class JointRig {
  s: RigSettings;
  act: ActuatorConfig;
  thermal: ActuatorThermal;
  // state
  t = 0;
  q = Math.PI / 2;
  qd = 0;
  qdd = 0;
  current = 0;
  currentCmd = 0;
  integ = 0;
  // trajectory
  private q0 = Math.PI / 2;
  private q1 = Math.PI / 2;
  private tr0 = 0;
  private trT = 0.01;
  qRef = Math.PI / 2;
  qdRef = 0;
  qddRef = 0;
  // outputs
  tauMotor = 0;
  tauOut = 0;
  tauGravity = 0;
  voltage = 0;
  pElec = 0;
  pMech = 0;
  pCopper = 0;
  currentLimited = false;
  voltageLimited = false;
  /** Rotor angle (for the animation), rad. */
  rotor = 0;
  /** Encoder quantisation of the output encoder, rad. */
  readonly encoderStep = (2 * Math.PI) / 2 ** 19;
  history: RigSample[] = [];
  private lastSample = -1;

  constructor(settings: RigSettings = DEFAULT_RIG) {
    this.s = { ...settings };
    this.act = this.configure();
    this.thermal = new ActuatorThermal(this.act.motor, 25);
    this.hold();
  }

  private configure() {
    return configureActuator(ACTUATORS.A100, this.s.bus, { ratio: this.s.ratio, reducer: this.s.reducer, stackScale: this.s.stackScale, peakCurrent: this.s.peakCurrent });
  }

  /** Change settings mid-run (the joint keeps its state; the thermal state carries over). */
  update(settings: Partial<RigSettings>) {
    const motorChanged = settings.stackScale !== undefined && settings.stackScale !== this.s.stackScale;
    this.s = { ...this.s, ...settings };
    this.act = this.configure();
    if (motorChanged) {
      const { Tw, Th } = this.thermal;
      this.thermal = new ActuatorThermal(this.act.motor, 25);
      this.thermal.Tw = Tw;
      this.thermal.Th = Th;
    } else this.thermal.motor = this.act.motor;
  }

  /** Link inertia about the knee including the payload, kg·m². */
  get linkInertia(): number {
    return SHIN.I + this.s.payload * CUFF_R * CUFF_R;
  }
  get reflectedInertia(): number {
    const m = this.act.motor;
    return this.act.ratio * this.act.ratio * m.rotorInertia * (1 + this.act.inputInertiaFraction);
  }
  /** Gravity torque towards flexion at angle q, Nm. */
  gravity(q: number, withPayload = true): number {
    return (SHIN.mr + (withPayload ? this.s.payload * CUFF_R : 0)) * GRAVITY * Math.cos(q);
  }

  private hold() {
    this.q0 = this.q1 = this.qRef = this.q;
    this.trT = 0.01;
  }

  /** Command a new target angle (degrees of knee flexion; 0 = straight). */
  moveTo(deg: number) {
    const target = (Math.max(0, Math.min(120, deg)) * Math.PI) / 180;
    this.q0 = this.qRef;
    this.q1 = target;
    this.tr0 = this.t;
    const vmax = (this.s.speed * Math.PI) / 180;
    this.trT = Math.max(0.2, (1.875 * Math.abs(target - this.q0)) / vmax);
  }

  private trajectory() {
    const u = Math.min(1, Math.max(0, (this.t - this.tr0) / this.trT));
    const d = this.q1 - this.q0;
    const s = u * u * u * (10 - 15 * u + 6 * u * u);
    const sd = (30 * u * u * (1 - u) * (1 - u)) / this.trT;
    const sdd = (60 * u * (1 - u) * (1 - 2 * u)) / (this.trT * this.trT);
    this.qRef = this.q0 + d * s;
    this.qdRef = d * sd;
    this.qddRef = d * sdd;
  }

  /** Advance by dt seconds (sub-stepped at 10 kHz). `timeScale` speeds up heating only. */
  step(dt: number, thermalScale = 1) {
    const h = 1e-4;
    const n = Math.max(1, Math.round(dt / h));
    const a = this.act;
    const m = a.motor;
    const Jt = this.linkInertia + this.reflectedInertia;
    // controller gains scale with the inertia so the closed loop keeps ~10 Hz bandwidth
    const wn = 2 * Math.PI * 9;
    const Kp = Jt * wn * wn;
    const Kd = 2 * 0.85 * wn * Jt;
    const Ki = Kp * 3;
    let pCuSum = 0;
    let pFrSum = 0;
    for (let i = 0; i < n; i++) {
      this.t += h;
      // 1 kHz joint controller
      if (i % 10 === 0) {
        this.trajectory();
        const qMeas = Math.round(this.q / this.encoderStep) * this.encoderStep;
        const e = this.qRef - qMeas;
        this.integ = Math.max(-0.2, Math.min(0.2, this.integ + e * 1e-3));
        const nominal = (this.linkInertia - this.s.payload * CUFF_R * CUFF_R + this.reflectedInertia) * this.qddRef - this.gravity(this.qRef, false);
        const tauCmd = nominal + Kp * e + Kd * (this.qdRef - this.qd) + Ki * this.integ;
        this.currentCmd = tauCmd / (a.ratio * a.eta * m.kt);
      }
      // current loop with limits
      const limit = this.thermal.currentLimit(a.peakCurrent);
      const wm = this.qd * a.ratio;
      const R = resistanceAt(m, this.thermal.Tw);
      const V = usableVoltage(a);
      const iMaxV = (V - m.kt * wm) / R;
      const iMinV = (-V - m.kt * wm) / R;
      let cmd = this.currentCmd;
      this.currentLimited = Math.abs(cmd) > limit;
      cmd = Math.max(-limit, Math.min(limit, cmd));
      this.voltageLimited = cmd > iMaxV || cmd < iMinV;
      cmd = Math.max(iMinV, Math.min(iMaxV, cmd));
      const tauI = 1 / (2 * Math.PI * 1500);
      this.current += ((cmd - this.current) * h) / tauI;
      // motor → reducer → output
      this.tauMotor = ktAt(a, this.current) * this.current;
      const fr = Math.sign(wm) * m.coulomb * Math.min(1, Math.abs(wm) / 2) + m.viscous * wm;
      const tm = this.tauMotor - fr;
      this.tauGravity = this.gravity(this.q);
      const fwd = tm * a.ratio * a.eta;
      const back = (tm * a.ratio) / a.etaBack;
      let driving = tm * this.qd >= 0;
      if (Math.abs(this.qd) < 2e-3) {
        // Stiction: at rest the reducer's friction can hold any output torque between the
        // forward-driven and back-driven values, so the joint stays put if gravity lies there.
        const need = -this.tauGravity;
        const lo = Math.min(fwd, back);
        const hi = Math.max(fwd, back);
        if (need >= lo && need <= hi) {
          this.tauOut = need;
          this.qd = 0;
          this.qdd = 0;
          this.rotor += 0;
          this.voltage = this.current * R + m.kt * wm;
          this.pCopper = this.current * this.current * R;
          pCuSum += this.pCopper;
          continue;
        }
        driving = Math.abs(fwd + this.tauGravity) > Math.abs(back + this.tauGravity) ? true : false;
      }
      this.tauOut = driving ? fwd : back;
      // The actuator's torque acts towards extension when negative (lifting the shin).
      this.qdd = (this.tauOut + this.tauGravity - 0.4 * this.qd) / Jt;
      this.qd += this.qdd * h;
      this.q += this.qd * h;
      // hard stops (the rig's mechanical limits)
      if (this.q < -0.02) (this.q = -0.02), (this.qd = Math.max(0, this.qd));
      if (this.q > 2.2) (this.q = 2.2), (this.qd = Math.min(0, this.qd));
      this.rotor += wm * h;
      this.voltage = this.current * R + m.kt * wm;
      this.pCopper = this.current * this.current * R;
      pCuSum += this.pCopper;
      pFrSum += Math.abs(fr * wm) + Math.abs(tm * wm) * (1 - (driving ? a.eta : a.etaBack));
    }
    this.pElec = this.voltage * this.current;
    this.pMech = this.tauOut * this.qd;
    this.thermal.step(pCuSum / n, pFrSum / n, dt * thermalScale, 25);
    if (this.t - this.lastSample >= 0.01) {
      this.lastSample = this.t;
      this.history.push({ t: this.t, qRef: this.qRef, q: this.q, qd: this.qd, current: this.current, tauOut: this.tauOut });
      if (this.history.length > 800) this.history.splice(0, this.history.length - 800);
    }
  }

  /** Motor speed, rpm. */
  get motorRpm(): number {
    return (this.qd * this.act.ratio * 60) / (2 * Math.PI);
  }

  /** Efficiency of the conversion now (mechanical out / electrical in, or the reverse). */
  get efficiency(): number | null {
    if (Math.abs(this.pElec) < 2 || Math.abs(this.pMech) < 1) return null;
    return this.pElec > 0 ? Math.max(0, this.pMech / this.pElec) : Math.max(0, this.pElec / this.pMech);
  }

  /** Holding torque needed at the current angle, and whether the actuator can hold it forever. */
  holdingReport() {
    const tau = Math.abs(this.gravity(this.q));
    return { tau, continuous: tau };
  }
}
