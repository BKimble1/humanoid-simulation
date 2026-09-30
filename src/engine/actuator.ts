/**
 * Rotary actuator model: PMSM (DC-equivalent), reducer, drive, and a two-node thermal network.
 *
 *   motor torque        τm = Kt(I)·I                     (Kt falls ~12 % towards peak current: saturation)
 *   output torque       τo = τm·N·η − friction           (motor driving the load)
 *                       τo = τm·N/η_back                 (load driving the motor)
 *   back-EMF            V  = I·R(T) + Ke·ωm,  Ke = Kt    (SI units)
 *   copper loss         Pcu = I²·R(T),  R(T) = R20·(1 + α·(T − 20))
 *   thermal network     Cw·dTw/dt = Pcu − (Tw − Th)/Rwh
 *                       Ch·dTh/dt = (Tw − Th)/Rwh + Pfric − (Th − Ta)/Rha
 *   reflected inertia   J = N²·J_rotor (+ reducer input stage)
 *
 * What it leaves out (documented in ENGINEERING.md): field weakening, d-axis current, cogging,
 * iron losses beyond a viscous term, magnet temperature (Kt drop with heat), gear tooth
 * dynamics and backlash nonlinearity, and heat spreading between neighbouring actuators.
 */
import { MOTOR_FRAMES, REDUCER_TYPICAL, WINDING, type ActuatorFamily, type MotorFrame, type ReducerKind } from '../spec/actuators';

export type RotaryReducer = Exclude<ReducerKind, 'ballscrew' | 'leadscrew'>;

export interface MotorParams {
  frame: string;
  kt: number;
  r20: number;
  rotorInertia: number;
  mass: number;
  coulomb: number;
  viscous: number;
  rwh: number;
  rha: number;
  cw: number;
  ch: number;
}

/** A frame at a stack length (scale 1 = the reference stack). Kt and inertia scale with the
 * stack; resistance with the active length plus the end turns; thermal capacity with mass;
 * the winding-to-housing resistance falls as the contact area grows. */
export function motorAtStack(frame: MotorFrame, stackScale: number): MotorParams {
  const s = stackScale;
  const endTurn = 0.35;
  return {
    frame: frame.id,
    kt: frame.kt * s,
    r20: frame.resistance * ((1 - endTurn) * s + endTurn),
    rotorInertia: frame.rotorInertia * s,
    mass: frame.motorMass * (0.3 + 0.7 * s),
    coulomb: frame.coulomb * (0.6 + 0.4 * s),
    viscous: frame.viscous * s,
    rwh: frame.rWindingHousing / (0.5 + 0.5 * s),
    rha: frame.rHousingAmbient / (0.7 + 0.3 * s),
    cw: frame.cWinding * s,
    ch: frame.cHousing * (0.4 + 0.6 * s),
  };
}

/** Reducer efficiency by kind and ratio (forward), and backdrive efficiency. estimate */
export function reducerEfficiency(kind: RotaryReducer, ratio: number): { forward: number; back: number } {
  const t = REDUCER_TYPICAL[kind];
  const fwd = Math.min(0.97, Math.max(0.55, t.eta0 - t.etaSlope * Math.log10(ratio / t.refRatio)));
  // Backdrive efficiency: losses grow when the load drives the motor. For simple gear trains
  // η_b ≈ 2 − 1/η_f; cycloidal and strain-wave reducers backdrive worse than that (sliding
  // contact, flexspline hysteresis), so the loss is scaled per kind to match the spec values.
  const k = kind === 'planetary' ? 2.2 : kind === 'cycloidal' ? 2.7 : 2.3;
  const back = Math.max(0.03, 1 - (1 - fwd) * k);
  return { forward: fwd, back };
}

export interface ActuatorConfig {
  id: string;
  motor: MotorParams;
  reducer: RotaryReducer;
  ratio: number;
  eta: number;
  etaBack: number;
  peakCurrent: number;
  busVoltage: number;
  /** Whole actuator mass, kg. */
  mass: number;
  /** Reflected inertia of the reducer's input stage, as a fraction of the rotor's. */
  inputInertiaFraction: number;
}

/** The configuration of a spec family, optionally with changes (Engineer mode). */
export function configureActuator(
  fam: ActuatorFamily,
  busVoltage: number,
  change: Partial<{ ratio: number; reducer: RotaryReducer; stackScale: number; peakCurrent: number }> = {},
): ActuatorConfig {
  const stack = change.stackScale ?? 1;
  const motor = motorAtStack(MOTOR_FRAMES[fam.motor.id] ?? fam.motor, stack);
  const reducer = change.reducer ?? (fam.reducer.kind as RotaryReducer);
  const ratio = change.ratio ?? fam.reducer.ratio;
  const changedReducer = change.reducer !== undefined || change.ratio !== undefined;
  const eff = changedReducer ? reducerEfficiency(reducer, ratio) : { forward: fam.reducer.efficiency, back: fam.reducer.backEfficiency };
  const peakCurrent = change.peakCurrent ?? fam.peakCurrent;
  // Mass: motor scales with stack; the reducer and housing with the torque they must carry.
  const refMotor = MOTOR_FRAMES[fam.motor.id] ?? fam.motor;
  const refPeak = refMotor.kt * fam.peakCurrent * fam.reducer.ratio * fam.reducer.efficiency;
  const newPeak = motor.kt * peakCurrent * ratio * eff.forward;
  const rest = fam.mass - refMotor.motorMass;
  const massFactor = REDUCER_TYPICAL[reducer].massFactor / REDUCER_TYPICAL[fam.reducer.kind as RotaryReducer].massFactor;
  const reducerAndHousing = rest * Math.pow(Math.max(0.2, newPeak / refPeak), 2 / 3) * massFactor;
  return {
    id: fam.id,
    motor,
    reducer,
    ratio,
    eta: eff.forward,
    etaBack: eff.back,
    peakCurrent,
    busVoltage,
    mass: motor.mass + reducerAndHousing,
    inputInertiaFraction: reducer === 'cycloidal' ? 0.25 : reducer === 'harmonic' ? 0.3 : 0.15,
  };
}

/** Resistance at winding temperature T (°C). */
export const resistanceAt = (m: MotorParams, T: number) => m.r20 * (1 + WINDING.alphaCu * (T - 20));

/** Torque constant at current I: flat to 55 % of peak, then falling to 88 % at peak (saturation). */
export function ktAt(cfg: ActuatorConfig, current: number): number {
  const x = Math.abs(current) / cfg.peakCurrent;
  const drop = Math.max(0, (x - 0.55) / 0.45);
  return cfg.motor.kt * (1 - 0.12 * Math.min(1.5, drop));
}

/** Current needed for motor torque τm (inverts the saturating Kt with a few fixed-point steps). */
export function currentFor(cfg: ActuatorConfig, tauM: number): number {
  let I = tauM / cfg.motor.kt;
  for (let k = 0; k < 4; k++) I = tauM / ktAt(cfg, I);
  return I;
}

/** Usable voltage from the bus with space-vector modulation margin. */
export const usableVoltage = (cfg: ActuatorConfig) => cfg.busVoltage * 0.95;

export interface ActuatorRatings {
  peakTorque: number;
  continuousTorque: number;
  continuousCurrent: number;
  /** Output speed at which back-EMF equals the usable voltage (no load), rad/s. */
  noLoadSpeed: number;
  /** Output speed at which peak torque can still be produced, rad/s. */
  cornerSpeed: number;
  reflectedInertia: number;
  /** Torque needed at the output to turn the motor backwards through the reducer, Nm. */
  backdriveTorque: number;
  peakPower: number;
  mass: number;
  torqueDensity: number;
  efficiency: number;
}

export function ratings(cfg: ActuatorConfig, ambient = 25): ActuatorRatings {
  const m = cfg.motor;
  const Tlim = WINDING.derateStart;
  const Rhot = resistanceAt(m, Tlim);
  const Pmax = (Tlim - ambient) / (m.rwh + m.rha);
  const Icont = Math.sqrt(Math.max(0, Pmax) / Rhot);
  const tauCont = ktAt(cfg, Icont) * Icont * cfg.ratio * cfg.eta;
  const tauPeakM = ktAt(cfg, cfg.peakCurrent) * cfg.peakCurrent;
  const peakTorque = tauPeakM * cfg.ratio * cfg.eta;
  const V = usableVoltage(cfg);
  const wNL = V / m.kt;
  const wCorner = Math.max(0, (V - cfg.peakCurrent * resistanceAt(m, 60)) / m.kt);
  const reflected = cfg.ratio * cfg.ratio * m.rotorInertia * (1 + cfg.inputInertiaFraction);
  const backdrive = (cfg.ratio * m.coulomb) / cfg.etaBack;
  // peak mechanical power: maximise τ(ω)·ω along the voltage-limited line
  let peakPower = 0;
  for (let k = 1; k <= 60; k++) {
    const w = (wNL * k) / 60;
    const I = Math.min(cfg.peakCurrent, (V - m.kt * w) / resistanceAt(m, 60));
    if (I <= 0) break;
    peakPower = Math.max(peakPower, ktAt(cfg, I) * I * w * cfg.eta);
  }
  return {
    peakTorque,
    continuousTorque: tauCont,
    continuousCurrent: Icont,
    noLoadSpeed: wNL / cfg.ratio,
    cornerSpeed: wCorner / cfg.ratio,
    reflectedInertia: reflected,
    backdriveTorque: backdrive,
    peakPower,
    mass: cfg.mass,
    torqueDensity: peakTorque / cfg.mass,
    efficiency: cfg.eta,
  };
}

/** Largest output torque available at output speed ω (rad/s) and winding temperature T. */
export function torqueAvailable(cfg: ActuatorConfig, omegaOut: number, T = 60, currentLimit = cfg.peakCurrent): number {
  const m = cfg.motor;
  const wm = Math.abs(omegaOut) * cfg.ratio;
  const Ivolt = (usableVoltage(cfg) - m.kt * wm) / resistanceAt(m, T);
  const I = Math.max(0, Math.min(currentLimit, Ivolt));
  return ktAt(cfg, I) * I * cfg.ratio * cfg.eta;
}

export interface OperatingPoint {
  /** Requested output torque and speed. */
  tauOut: number;
  omegaOut: number;
  tauMotor: number;
  omegaMotor: number;
  current: number;
  voltage: number;
  /** Electrical power into the motor (positive: drawing from the bus), W. */
  pElec: number;
  pMech: number;
  pCopper: number;
  pFriction: number;
  /** Power flows from the load into the motor (braking / regenerating). */
  regenerating: boolean;
  /** Current limit or voltage limit reached: the request cannot be met. */
  currentLimited: boolean;
  voltageLimited: boolean;
  /** Output torque actually delivered after limits. */
  tauDelivered: number;
}

/**
 * What the motor must do to produce output torque τ at output speed ω, at winding
 * temperature T. Clips to the current limit (thermal derating included) and voltage limit.
 */
export function operate(cfg: ActuatorConfig, tauOut: number, omegaOut: number, T: number, currentLimit = cfg.peakCurrent): OperatingPoint {
  const m = cfg.motor;
  const wm = omegaOut * cfg.ratio;
  const friction = Math.sign(wm) * m.coulomb * Math.min(1, Math.abs(wm) / 2) + m.viscous * wm;
  const driving = tauOut * omegaOut >= 0;
  // Motor torque referred through the reducer, plus friction at the motor shaft.
  let tauM = driving ? tauOut / (cfg.ratio * cfg.eta) : (tauOut * cfg.etaBack) / cfg.ratio;
  tauM += friction;
  let I = currentFor(cfg, tauM);
  const R = resistanceAt(m, T);
  let currentLimited = false;
  if (Math.abs(I) > currentLimit) {
    I = Math.sign(I) * currentLimit;
    currentLimited = true;
  }
  let V = I * R + m.kt * wm;
  const Vmax = usableVoltage(cfg);
  let voltageLimited = false;
  if (Math.abs(V) > Vmax) {
    voltageLimited = true;
    V = Math.sign(V) * Vmax;
    I = (V - m.kt * wm) / R;
    if (Math.abs(I) > currentLimit) I = Math.sign(I) * currentLimit;
  }
  const tauMd = ktAt(cfg, I) * I - friction;
  const tauDelivered = driving ? tauMd * cfg.ratio * cfg.eta : (tauMd * cfg.ratio) / cfg.etaBack;
  const pCopper = I * I * R;
  const pElec = V * I;
  return {
    tauOut,
    omegaOut,
    tauMotor: ktAt(cfg, I) * I,
    omegaMotor: wm,
    current: I,
    voltage: V,
    pElec,
    pMech: tauDelivered * omegaOut,
    pCopper,
    pFriction: Math.abs(friction * wm) + Math.abs(tauMd * wm) * (1 - (driving ? cfg.eta : cfg.etaBack)),
    regenerating: pElec < 0,
    currentLimited,
    voltageLimited,
    tauDelivered,
  };
}

/** Two-node (winding, housing) thermal state of one actuator. */
export class ActuatorThermal {
  Tw: number;
  Th: number;
  constructor(
    public motor: MotorParams,
    ambient = 25,
  ) {
    this.Tw = ambient;
    this.Th = ambient;
  }
  /** Advance by dt seconds with copper loss and friction heat (W) at ambient Ta (°C). */
  step(pCopper: number, pFriction: number, dt: number, Ta = 25): void {
    const m = this.motor;
    // sub-step for stability when dt is large (accelerated time)
    const n = Math.max(1, Math.ceil(dt / 0.5));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const qwh = (this.Tw - this.Th) / m.rwh;
      const qha = (this.Th - Ta) / m.rha;
      this.Tw += (h * (pCopper - qwh)) / m.cw;
      this.Th += (h * (qwh + pFriction - qha)) / m.ch;
    }
  }
  /** Current limit after thermal derating: full up to derateStart, zero at shutdown. */
  currentLimit(peak: number): number {
    const x = (this.Tw - WINDING.derateStart) / (WINDING.shutdown - WINDING.derateStart);
    return peak * Math.max(0, Math.min(1, 1 - x * 0.75));
  }
  /** Winding time constant (fast) and whole-actuator time constant (slow), s. */
  timeConstants(): { winding: number; housing: number } {
    const m = this.motor;
    return { winding: m.cw * m.rwh, housing: m.ch * (m.rwh + m.rha) };
  }
}
