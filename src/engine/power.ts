/**
 * Power and heat for the whole robot: every joint's operating point from its torque and speed,
 * the drives, the low-voltage loads, the battery, and the thermal state of actuators, drives,
 * computer and pack, integrated over time.
 *
 * Battery power = Σ joint electrical power (regeneration returns to the bus, minus the drive's
 * loss) + drive standby + LV loads / DC-DC efficiency. The ankles' two linear actuators are
 * mapped from the joint torques: F₁,₂ = τ_pitch/(2·r_p) ± τ_roll/(2·r_r).
 */
import { ANKLE_LINEAR, WINDING } from '../spec/actuators';
import { JOINTS } from '../spec/body';
import { DCDC_EFFICIENCY, DRIVE_EFFICIENCY, DRIVE_IDLE_W, LV_LOADS } from '../spec/power';
import { ActuatorThermal, motorAtStack, operate, ratings, type ActuatorConfig, type OperatingPoint } from './actuator';
import { stepPack, type PackState } from './battery';
import type { RobotModel } from './robot';
import { JOINT_INDEX, NJ } from './skeleton';

/** A linear actuator expressed as a "rotary" config whose ratio is motor rad per metre. */
export function ankleActuatorConfig(bus: number): ActuatorConfig {
  const motor = motorAtStack(ANKLE_LINEAR.motor, 1);
  return {
    id: 'ankle',
    motor,
    reducer: 'planetary',
    ratio: (2 * Math.PI * ANKLE_LINEAR.beltRatio) / ANKLE_LINEAR.lead,
    eta: ANKLE_LINEAR.efficiency,
    etaBack: ANKLE_LINEAR.backEfficiency,
    peakCurrent: ANKLE_LINEAR.peakCurrent,
    busVoltage: bus,
    mass: ANKLE_LINEAR.mass,
    inputInertiaFraction: 0.4,
  };
}

/** Peak force of one ankle actuator, N, and the ankle's peak pitch torque, Nm. */
export function ankleCapability(bus = 50.4) {
  const cfg = ankleActuatorConfig(bus);
  const r = ratings(cfg);
  // ratings() treats the ratio as rad per rad; here it is rad per metre, so its "torques" are
  // forces in newtons
  const force = r.peakTorque;
  const contForce = r.continuousTorque;
  return {
    force,
    contForce,
    pitchTorque: 2 * force * ANKLE_LINEAR.pitchArm,
    rollTorque: 2 * force * ANKLE_LINEAR.rollArm,
    pitchContinuous: 2 * contForce * ANKLE_LINEAR.pitchArm,
    rollContinuous: 2 * contForce * ANKLE_LINEAR.rollArm,
    /** Peak ankle pitch speed, rad/s (screw speed at no load over the lever). */
    pitchSpeed: r.noLoadSpeed / ANKLE_LINEAR.pitchArm,
    cfg,
  };
}

export interface JointPower {
  op: OperatingPoint | null;
  /** For the ankles, the two linear actuators' operating points. */
  linear?: [OperatingPoint, OperatingPoint];
  pElec: number;
  pMech: number;
  current: number;
}

export interface PowerSummary {
  jointsElec: number;
  jointsMech: number;
  regenerated: number;
  copper: number;
  driveStandby: number;
  lv: number;
  battery: number;
  batteryCurrent: number;
  batteryVoltage: number;
  batteryHeat: number;
  soc: number;
}

const ANKLES: Record<'L' | 'R', { pitch: number; roll: number }> = {
  L: { pitch: JOINT_INDEX.L_ankle_pitch, roll: JOINT_INDEX.L_ankle_roll },
  R: { pitch: JOINT_INDEX.R_ankle_pitch, roll: JOINT_INDEX.R_ankle_roll },
};

export class BodyEnergy {
  model: RobotModel;
  thermal: (ActuatorThermal | null)[];
  /** Ankle linear actuators' thermal nodes: [L inner, L outer, R inner, R outer]. */
  ankleThermal: ActuatorThermal[];
  ankleCfg: ActuatorConfig;
  /** Drive board temperatures by joint, °C. */
  driveT: Float64Array;
  computeT = 45;
  pack: PackState = { soc: 0.92, tempC: 27 };
  joints: JointPower[] = JOINTS.map(() => ({ op: null, pElec: 0, pMech: 0, current: 0 }));
  summary: PowerSummary = { jointsElec: 0, jointsMech: 0, regenerated: 0, copper: 0, driveStandby: 0, lv: 0, battery: 0, batteryCurrent: 0, batteryVoltage: 0, batteryHeat: 0, soc: 0.92 };
  /** Extra perception load (vision mode), W. */
  perceptionBoost = 0;
  ambient = 25;
  /** Battery power averaged over the last 3 s (for runtime: a few strides when walking), W. */
  avgPower = 200;
  private binE = new Float64Array(30);
  private binT = new Float64Array(30);
  private bin = 0;

  constructor(model: RobotModel) {
    this.model = model;
    this.thermal = model.actuators.map((a) => (a ? new ActuatorThermal(a.motor, 32) : null));
    this.ankleCfg = ankleActuatorConfig(model.pack.nominalV);
    this.ankleThermal = [0, 1, 2, 3].map(() => new ActuatorThermal(this.ankleCfg.motor, 32));
    this.driveT = new Float64Array(NJ).fill(33);
  }

  /** Swap in a new configuration, keeping temperatures and charge. */
  setModel(model: RobotModel) {
    const old = this.thermal;
    this.model = model;
    this.thermal = model.actuators.map((a, i) => {
      if (!a) return null;
      const th = new ActuatorThermal(a.motor, this.ambient);
      if (old[i]) (th.Tw = old[i]!.Tw), (th.Th = old[i]!.Th);
      return th;
    });
    this.ankleCfg = ankleActuatorConfig(model.pack.nominalV);
  }

  /**
   * Advance by dt seconds with joint torques (Nm) and velocities (rad/s). `thermalScale`
   * accelerates heating and discharge (for demonstrations of long duty cycles).
   */
  step(dt: number, tau: Float64Array, qd: Float64Array, thermalScale = 1) {
    let elec = 0;
    let mech = 0;
    let regen = 0;
    let copper = 0;
    const hdt = dt * thermalScale;
    for (let i = 0; i < NJ; i++) {
      const a = this.model.actuators[i];
      const jp = this.joints[i];
      if (!a) continue;
      const th = this.thermal[i]!;
      const limit = th.currentLimit(a.peakCurrent);
      const op = operate(a, tau[i], qd[i], th.Tw, limit);
      jp.op = op;
      jp.pElec = op.pElec;
      jp.pMech = op.pMech;
      jp.current = op.current;
      th.step(op.pCopper, op.pFriction, hdt, this.ambient + 7);
      const driveLoss = Math.abs(op.pElec) * (1 - DRIVE_EFFICIENCY) + op.current * op.current * 0.004;
      this.driveT[i] += (hdt * (driveLoss + DRIVE_IDLE_W - (this.driveT[i] - this.ambient - 5) / 3)) / 60;
      elec += op.pElec > 0 ? op.pElec / DRIVE_EFFICIENCY : op.pElec * DRIVE_EFFICIENCY;
      if (op.pElec < 0) regen -= op.pElec;
      mech += op.pMech;
      copper += op.pCopper;
    }
    // ankles: two linear actuators per foot
    const cfg = this.ankleCfg;
    let k = 0;
    for (const side of ['L', 'R'] as const) {
      const ip = ANKLES[side].pitch;
      const ir = ANKLES[side].roll;
      const fp = tau[ip] / (2 * ANKLE_LINEAR.pitchArm);
      const fr = tau[ir] / (2 * ANKLE_LINEAR.rollArm);
      const vp = qd[ip] * ANKLE_LINEAR.pitchArm;
      const vr = qd[ir] * ANKLE_LINEAR.rollArm;
      const ops: OperatingPoint[] = [];
      for (const sgn of [1, -1]) {
        const th = this.ankleThermal[k++];
        const op = operate(cfg, fp + sgn * fr, vp + sgn * vr, th.Tw, th.currentLimit(cfg.peakCurrent));
        th.step(op.pCopper, op.pFriction, hdt, this.ambient + 7);
        ops.push(op);
        elec += op.pElec > 0 ? op.pElec / DRIVE_EFFICIENCY : op.pElec * DRIVE_EFFICIENCY;
        if (op.pElec < 0) regen -= op.pElec;
        mech += op.pMech;
        copper += op.pCopper;
      }
      const both = ops as [OperatingPoint, OperatingPoint];
      for (const ji of [ip, ir]) {
        const jp = this.joints[ji];
        jp.linear = both;
        jp.op = null;
        jp.pElec = (both[0].pElec + both[1].pElec) / 2;
        jp.pMech = tau[ji] * qd[ji];
        jp.current = Math.max(Math.abs(both[0].current), Math.abs(both[1].current));
      }
    }
    // 25 rotary drives + 4 ankle linear drives (29), and 12 finger drivers
    const standby = 29 * DRIVE_IDLE_W + 12 * 0.25;
    const lvRaw = LV_LOADS.reduce((s, l) => s + l.watts, 0) + this.perceptionBoost;
    const lv = lvRaw / DCDC_EFFICIENCY;
    const battery = Math.max(-200, elec + standby + lv);
    const r = stepPack(this.model.pack, this.pack, battery, hdt, this.ambient + 5);
    // perception computer: heat sink and fan to the torso air path
    const pc = LV_LOADS[0].watts + this.perceptionBoost;
    this.computeT += (hdt * (pc - (this.computeT - this.ambient) / 0.9)) / 420;
    // 30 bins of 0.1 s
    this.binE[this.bin] += battery * dt;
    this.binT[this.bin] += dt;
    if (this.binT[this.bin] >= 0.1) {
      this.bin = (this.bin + 1) % this.binE.length;
      this.binE[this.bin] = 0;
      this.binT[this.bin] = 0;
    }
    let e = 0;
    let t = 0;
    for (let k = 0; k < this.binE.length; k++) (e += this.binE[k]), (t += this.binT[k]);
    this.avgPower = t > 0 ? e / t : battery;
    this.summary = {
      jointsElec: elec,
      jointsMech: mech,
      regenerated: regen,
      copper,
      driveStandby: standby,
      lv,
      battery,
      batteryCurrent: r.current,
      batteryVoltage: r.voltage,
      batteryHeat: r.heat,
      soc: this.pack.soc,
    };
  }

  /** Hottest winding and whether any actuator is derating. */
  hottest(): { joint: number; Tw: number; derating: boolean } {
    let best = { joint: -1, Tw: -Infinity, derating: false };
    this.thermal.forEach((th, i) => {
      if (th && th.Tw > best.Tw) best = { joint: i, Tw: th.Tw, derating: th.Tw > WINDING.derateStart };
    });
    return best;
  }
}
