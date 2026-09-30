/**
 * FO-H1 actuator families. Each rotary actuator is a frameless permanent-magnet synchronous
 * motor (PMSM, driven by field-oriented control) with a co-located drive board, dual absolute
 * encoders, a reducer and a crossed-roller output bearing. The ankles use a motor, a belt stage
 * and a ball screw instead; the fingers use micro coreless motors and lead screws.
 *
 * Motor values are stated in a DC-equivalent form (torque = Kt·I, back-EMF = Ke·ω with
 * Ke = Kt in SI units, one lumped terminal resistance). That is the usual reduced-order model
 * for sizing; it ignores field weakening, d-axis current and cogging. The continuous ratings
 * are not typed in: engine/actuator.ts derives them from the thermal network below, so a change
 * of motor size or cooling changes them consistently.
 */

export type ReducerKind = 'planetary' | 'cycloidal' | 'harmonic' | 'ballscrew' | 'leadscrew';

export interface ReducerSpec {
  kind: ReducerKind;
  /** Reduction ratio N (motor turns per output turn). For the ball screw, see LinearSpec. */
  ratio: number;
  /** Forward (motor driving load) efficiency at rated load, 0–1. estimate */
  efficiency: number;
  /** Backdrive efficiency (load driving motor), 0–1. Low values mean hard to backdrive. estimate */
  backEfficiency: number;
  /** Lost motion / backlash at the output, arc-minutes. estimate */
  backlashArcmin: number;
  /** Torsional stiffness at the output, Nm/rad. estimate */
  stiffness: number;
}

export interface MotorFrame {
  id: string;
  /** Stator outer diameter, m. design */
  statorOD: number;
  /** Reference stack length, m. design */
  stack: number;
  /** Torque constant at the reference stack, Nm/A (DC-equivalent). estimate */
  kt: number;
  /** Terminal resistance at 20 °C at the reference stack, Ω (DC-equivalent). estimate */
  resistance: number;
  /** Rotor inertia at the reference stack, kg·m². estimate */
  rotorInertia: number;
  /** Motor (stator + rotor) mass at the reference stack, kg. estimate */
  motorMass: number;
  /** Coulomb friction referred to the motor shaft (bearings, seals), Nm. estimate */
  coulomb: number;
  /** Viscous friction referred to the motor shaft, Nm·s/rad. estimate */
  viscous: number;
  /** Winding-to-housing thermal resistance, K/W. estimate */
  rWindingHousing: number;
  /** Housing-to-ambient (structure + air) thermal resistance, K/W. estimate */
  rHousingAmbient: number;
  /** Winding heat capacity, J/K (copper and lamination teeth). estimate */
  cWinding: number;
  /** Housing heat capacity, J/K. estimate */
  cHousing: number;
}

export interface ActuatorFamily {
  id: string;
  name: string;
  motor: MotorFrame;
  reducer: ReducerSpec;
  /** Drive's phase-current limit, A. design */
  peakCurrent: number;
  /** Whole actuator mass (motor, reducer, housing, bearing, drive, encoders), kg. design */
  mass: number;
  /** Housing outer diameter and length, m (the 3D model is built from these). design */
  housingOD: number;
  housingLength: number;
  /** An output torque sensor (strain-gauge flexure) is fitted. design */
  torqueSensor: boolean;
  /** One-line description for the interface. */
  summary: string;
}

/** Winding insulation class F: 155 °C absolute. Drives derate from 120 °C and stop at 140 °C. */
export const WINDING = {
  classLimit: 155,
  derateStart: 120,
  shutdown: 140,
  /** Copper resistance temperature coefficient, 1/K (at 20 °C). */
  alphaCu: 0.00393,
} as const;

/** Frameless PMSM frames (stator OD / reference stack). Values are estimates in the range of
 * published frameless-motor datasheets of the same diameter; see ENGINEERING.md. */
export const MOTOR_FRAMES: Record<string, MotorFrame> = {
  F100: {
    id: 'F100',
    statorOD: 0.1,
    stack: 0.025,
    kt: 0.14,
    resistance: 0.16,
    rotorInertia: 3.0e-4,
    motorMass: 0.82,
    coulomb: 0.035,
    viscous: 6e-5,
    rWindingHousing: 0.38,
    rHousingAmbient: 0.85,
    cWinding: 160,
    cHousing: 950,
  },
  F80: {
    id: 'F80',
    statorOD: 0.08,
    stack: 0.02,
    kt: 0.085,
    resistance: 0.22,
    rotorInertia: 1.1e-4,
    motorMass: 0.48,
    coulomb: 0.02,
    viscous: 3e-5,
    rWindingHousing: 0.5,
    rHousingAmbient: 0.9,
    cWinding: 95,
    cHousing: 560,
  },
  F60: {
    id: 'F60',
    statorOD: 0.06,
    stack: 0.018,
    kt: 0.05,
    resistance: 0.38,
    rotorInertia: 3.5e-5,
    motorMass: 0.26,
    coulomb: 0.012,
    viscous: 1.5e-5,
    rWindingHousing: 0.85,
    rHousingAmbient: 1.45,
    cWinding: 52,
    cHousing: 300,
  },
  F50: {
    id: 'F50',
    statorOD: 0.05,
    stack: 0.02,
    kt: 0.04,
    resistance: 0.45,
    rotorInertia: 1.6e-5,
    motorMass: 0.2,
    coulomb: 0.008,
    viscous: 1e-5,
    rWindingHousing: 1.0,
    rHousingAmbient: 2.2,
    cWinding: 40,
    cHousing: 220,
  },
  F45: {
    id: 'F45',
    statorOD: 0.045,
    stack: 0.015,
    kt: 0.028,
    resistance: 0.75,
    rotorInertia: 9e-6,
    motorMass: 0.12,
    coulomb: 0.006,
    viscous: 8e-6,
    rWindingHousing: 1.2,
    rHousingAmbient: 2.4,
    cWinding: 26,
    cHousing: 160,
  },
};

/** Typical reducer characteristics by kind (estimates; see ENGINEERING.md). */
export const REDUCER_TYPICAL: Record<Exclude<ReducerKind, 'ballscrew' | 'leadscrew'>, {
  label: string;
  ratioRange: [number, number];
  /** Efficiency model: η(N) = eta0 − etaSlope·log10(N / refRatio), clamped. */
  eta0: number;
  etaSlope: number;
  refRatio: number;
  backlashArcmin: number;
  /** Stiffness scales roughly with size; value for the F100 class. Nm/rad */
  stiffness: number;
  /** Relative mass factor of the reducer vs a planetary of the same torque. */
  massFactor: number;
  note: string;
}> = {
  planetary: {
    label: 'Planetary',
    ratioRange: [4, 50],
    eta0: 0.95,
    etaSlope: 0.07,
    refRatio: 6,
    backlashArcmin: 8,
    stiffness: 9000,
    massFactor: 1.0,
    note: 'About 95–97 % per stage; one stage up to ~10:1, two stages beyond. Backdrivable at low ratios (the "quasi-direct-drive" idea), with some backlash.',
  },
  cycloidal: {
    label: 'Cycloidal',
    ratioRange: [10, 120],
    eta0: 0.88,
    etaSlope: 0.06,
    refRatio: 30,
    backlashArcmin: 2,
    stiffness: 24000,
    massFactor: 0.9,
    note: 'High ratio in one compact stage, many lobes share the load: stiff and shock-tolerant. Rolling contact keeps efficiency in the 80–90 % range.',
  },
  harmonic: {
    label: 'Harmonic (strain wave)',
    ratioRange: [30, 160],
    eta0: 0.78,
    etaSlope: 0.12,
    refRatio: 50,
    backlashArcmin: 0.5,
    stiffness: 11000,
    massFactor: 0.75,
    note: 'Near-zero backlash and very compact, but efficiency falls at high ratio and low temperature, and it is hard to backdrive. Flexspline fatigue limits peak torque.',
  },
};

export const ACTUATORS: Record<string, ActuatorFamily> = {
  A100: {
    id: 'A100',
    name: 'A100-C30',
    motor: MOTOR_FRAMES.F100,
    reducer: { kind: 'cycloidal', ratio: 30, efficiency: 0.88, backEfficiency: 0.68, backlashArcmin: 2, stiffness: 24000 },
    peakCurrent: 80,
    mass: 2.1,
    housingOD: 0.118,
    housingLength: 0.086,
    torqueSensor: true,
    summary: 'Large rotary actuator: 100 mm frameless PMSM, 30:1 cycloidal reducer, output torque sensor.',
  },
  A80: {
    id: 'A80',
    name: 'A80-C40',
    motor: MOTOR_FRAMES.F80,
    reducer: { kind: 'cycloidal', ratio: 40, efficiency: 0.86, backEfficiency: 0.64, backlashArcmin: 2, stiffness: 14000 },
    peakCurrent: 50,
    mass: 1.25,
    housingOD: 0.096,
    housingLength: 0.074,
    torqueSensor: false,
    summary: 'Medium rotary actuator: 80 mm frameless PMSM, 40:1 cycloidal reducer.',
  },
  A60: {
    id: 'A60',
    name: 'A60-P25',
    motor: MOTOR_FRAMES.F60,
    reducer: { kind: 'planetary', ratio: 25, efficiency: 0.9, backEfficiency: 0.78, backlashArcmin: 8, stiffness: 5200 },
    peakCurrent: 40,
    mass: 0.72,
    housingOD: 0.076,
    housingLength: 0.066,
    torqueSensor: false,
    summary: 'Compact rotary actuator: 60 mm frameless PMSM, two-stage 25:1 planetary reducer.',
  },
  A45: {
    id: 'A45',
    name: 'A45-H100',
    motor: MOTOR_FRAMES.F45,
    reducer: { kind: 'harmonic', ratio: 100, efficiency: 0.72, backEfficiency: 0.35, backlashArcmin: 0.5, stiffness: 4500 },
    peakCurrent: 12,
    mass: 0.38,
    housingOD: 0.058,
    housingLength: 0.062,
    torqueSensor: false,
    summary: 'Precision actuator: 45 mm frameless PMSM, 100:1 strain-wave (harmonic) reducer, zero backlash.',
  },
};

/** The ankle's linear actuators: motor, 2:1 belt, ball screw, rod end to the foot. */
export interface LinearSpec {
  motor: MotorFrame;
  beltRatio: number;
  /** Ball screw lead, m per revolution. design */
  lead: number;
  /** Ball screw efficiency (forward / back). estimate */
  efficiency: number;
  backEfficiency: number;
  peakCurrent: number;
  /** Stroke, m. design */
  stroke: number;
  mass: number;
  bodyOD: number;
  bodyLength: number;
  /** Moment arm of each rod about the ankle pitch axis, m, and half-spacing for roll, m. design */
  pitchArm: number;
  rollArm: number;
}

export const ANKLE_LINEAR: LinearSpec = {
  motor: MOTOR_FRAMES.F50,
  beltRatio: 2,
  lead: 0.004,
  efficiency: 0.9,
  backEfficiency: 0.82,
  peakCurrent: 16,
  stroke: 0.064,
  mass: 0.55,
  bodyOD: 0.044,
  bodyLength: 0.17,
  pitchArm: 0.058,
  rollArm: 0.036,
};

/** Finger actuators: 12 mm coreless DC motor, 16:1 gearhead, 0.5 mm-lead screw and linkage. The
 * lead screw does not backdrive, so a grasp holds without current. */
export const FINGER_ACTUATOR = {
  kt: 0.0061,
  resistance: 4.4,
  gearhead: 16,
  gearheadEfficiency: 0.8,
  leadscrewLead: 0.0005,
  leadscrewEfficiency: 0.35,
  /** Linkage mechanical advantage from nut force to fingertip normal force. design */
  linkageAdvantage: 0.089,
  peakCurrent: 0.5,
  /** Supply: the 24 V low-voltage bus. design */
  supply: 24,
  /** Close time, open to fully flexed, s. design */
  closeTime: 0.75,
  mass: 0.045,
  summary: '12 mm coreless DC motor, 16:1 gearhead, self-locking lead screw and a linkage in the palm.',
} as const;
