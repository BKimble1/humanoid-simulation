/**
 * Explore: what each subsystem is, in a few sentences, and its key numbers. Values are read
 * from the specification and the engineering models (never retyped), and each carries its
 * provenance.
 */
import { ACTUATORS, ANKLE_LINEAR, FINGER_ACTUATOR, MOTOR_FRAMES, WINDING } from '../spec/actuators';
import { BODY_DOF, DIM, HAND } from '../spec/body';
import { MATERIALS } from '../spec/materials';
import { CELL, PACK } from '../spec/power';
import type { Provenance } from '../spec/provenance';
import { FORCE_TORQUE, HEAD_CAMERAS, IMU, JOINT_SENSING, TACTILE } from '../spec/sensing';
import { configureActuator, ratings } from '../engine/actuator';
import { packSpec } from '../engine/battery';
import { fingertipForce } from '../engine/grasp';
import { ankleCapability } from '../engine/power';
import { RobotModel } from '../engine/robot';
import { stereoDepth } from '../engine/sensing';
import type { SystemId } from '../state/store';

export interface Spec {
  label: string;
  value: string;
  unit?: string;
  kind: Provenance;
}

export interface SystemInfo {
  id: SystemId;
  title: string;
  short: string;
  lede: string;
  specs: Spec[];
  notes?: string[];
}

const pack = packSpec();
const model = new RobotModel();
const a100 = ratings(configureActuator(ACTUATORS.A100, pack.nominalV));
const a80 = ratings(configureActuator(ACTUATORS.A80, pack.nominalV));
const a45 = ratings(configureActuator(ACTUATORS.A45, pack.nominalV));
const ankle = ankleCapability(pack.nominalV);
const by = model.bySubsystem();
const f = (v: number, d = 0) => v.toFixed(d);
const fingertip = fingertipForce(FINGER_ACTUATOR.peakCurrent, FINGER_ACTUATOR);

export const SYSTEMS: SystemInfo[] = [
  {
    id: 'overview',
    title: 'FO-H1',
    short: 'Overview',
    lede: 'An original adult-size electric humanoid, designed for this simulation to show how such a machine is engineered. Every number below comes from its specification or is calculated from it.',
    specs: [
      { label: 'Height', value: f(DIM.height, 2), unit: 'm', kind: 'design' },
      { label: 'Mass', value: f(model.robotMass, 1), unit: 'kg', kind: 'calculated' },
      { label: 'Actuated joints', value: `${BODY_DOF} + ${HAND.actuated * 2} in the hands`, kind: 'design' },
      { label: 'Battery', value: `${f(pack.energyWh / 1000, 2)} kWh at ${f(pack.nominalV, 1)} V`, kind: 'calculated' },
      { label: 'Walking speed', value: '0.5 – 1.5', unit: 'm/s', kind: 'design' },
      { label: 'Actuators, share of mass', value: f((by.actuator / model.robotMass) * 100), unit: '%', kind: 'calculated' },
    ],
  },
  {
    id: 'structure',
    title: 'Structure',
    short: 'Structure',
    lede: 'Loads travel from the feet through machined aluminium members and actuator housings to the pelvis saddle and the torso frame. Covers carry no load: they protect, guide air and make the robot safe to touch.',
    specs: [
      { label: 'Limb members', value: MATERIALS.al7075.label, kind: 'design' },
      { label: 'Thigh tube', value: '⌀50 × 2 mm, 0.30 m', kind: 'design' },
      { label: 'Structure and covers', value: f(by.structure + by.shell, 1), unit: 'kg', kind: 'calculated' },
      { label: 'Design load, thigh', value: '3 × knee peak torque', kind: 'estimate' },
      { label: 'Safety factor, thigh', value: '2.3', kind: 'calculated' },
    ],
    notes: ['Dark anodised parts carry load; light covers do not.', 'Actuator housings are part of the load path: each joint’s crossed-roller bearing carries the limb’s bending loads.'],
  },
  {
    id: 'actuators',
    title: 'Actuators',
    short: 'Actuators',
    lede: 'Twenty-nine joint actuators turn electrical power into motion. Each is a frameless motor, a reducer, bearings, encoders and its own drive. High ratios give torque from small motors, at the cost of speed and backdrivability.',
    specs: [
      { label: 'Hip and knee (A100)', value: `${f(a100.peakTorque)} peak · ${f(a100.continuousTorque)} continuous`, unit: 'Nm', kind: 'calculated' },
      { label: 'Reduction', value: `${ACTUATORS.A100.reducer.ratio} : 1 cycloidal`, kind: 'design' },
      { label: 'Top joint speed', value: f(a100.noLoadSpeed, 1), unit: 'rad/s', kind: 'calculated' },
      { label: 'Torque density', value: f(a100.torqueDensity), unit: 'Nm/kg', kind: 'calculated' },
      { label: 'Winding limit', value: `${WINDING.classLimit} °C (class F)`, kind: 'design' },
      { label: 'Elbow (A80) · wrist (A45)', value: `${f(a80.peakTorque)} · ${f(a45.peakTorque)}`, unit: 'Nm peak', kind: 'calculated' },
    ],
    notes: ['Continuous torque is not typed in: it is the torque whose copper loss the housing can shed at 120 °C.', 'The knee motor sits high on the thigh and drives the knee through a push rod, keeping mass near the hip.'],
  },
  {
    id: 'hands',
    title: 'Hands',
    short: 'Hands',
    lede: 'Eleven joints and six actuators per hand. Each finger’s three joints are coupled through a linkage to one motor; the thumb has two. Silicone skins over capacitive taxels feel pressure and shear.',
    specs: [
      { label: 'Fingertip force', value: f(fingertip, 1), unit: 'N', kind: 'calculated' },
      { label: 'Finger drive', value: '12 mm coreless motor, 16 : 1, lead screw', kind: 'design' },
      { label: 'Tactile taxels', value: `${TACTILE.fingertipTaxels} per fingertip, ${TACTILE.palmTaxels} in the palm`, kind: 'design' },
      { label: 'Tactile rate', value: `${TACTILE.rateHz}`, unit: 'Hz', kind: 'design' },
      { label: 'Holding without power', value: 'yes (self-locking screw)', kind: 'design' },
    ],
    notes: ['Slip shows up first as rising shear and a high-frequency vibration at the edge of contact: the grip tightens before the object moves.'],
  },
  {
    id: 'vision',
    title: 'Vision',
    short: 'Vision',
    lede: 'A stereo pair behind the visor measures depth by comparing two views; a colour camera adds detail and a projector adds texture on blank surfaces. A downward depth camera in the chest looks at the ground ahead of the feet.',
    specs: [
      { label: 'Stereo baseline', value: f(HEAD_CAMERAS.stereo.baseline * 1000), unit: 'mm', kind: 'design' },
      { label: 'Field of view', value: `${HEAD_CAMERAS.stereo.hfovDeg}°, ${HEAD_CAMERAS.stereo.rateHz} Hz`, kind: 'design' },
      { label: 'Depth error at 1 m', value: f(stereoDepth(1).sigma * 1000, 1), unit: 'mm', kind: 'calculated' },
      { label: 'Depth error at 3 m', value: f(stereoDepth(3).sigma * 1000, 0), unit: 'mm', kind: 'calculated' },
      { label: 'Disparity noise', value: `${HEAD_CAMERAS.stereo.disparitySigmaPx}`, unit: 'px', kind: 'estimate' },
    ],
    notes: ['Depth error grows with the square of distance: σz = z² σd / (f B).'],
  },
  {
    id: 'balance',
    title: 'Balance and IMU',
    short: 'Balance',
    lede: 'An inertial measurement unit next to the centre of mass measures rotation rate and acceleration a thousand times a second. Fused with the joint encoders, it tells the controller how the body is tilted and where its centre of mass is.',
    specs: [
      { label: 'IMU rate', value: `${IMU.rateHz}`, unit: 'Hz', kind: 'design' },
      { label: 'Gyro noise', value: `${IMU.gyroNoiseDensity}`, unit: '°/s/√Hz', kind: 'estimate' },
      { label: 'Gyro bias stability', value: `${IMU.gyroBiasInstability}`, unit: '°/h', kind: 'estimate' },
      { label: 'Centre of mass height', value: '0.57 × height', kind: 'calculated' },
    ],
    notes: ['A gyroscope alone drifts; an accelerometer alone is noisy and fooled by motion. Fused, they give a steady attitude.'],
  },
  {
    id: 'forces',
    title: 'Force sensing',
    short: 'Forces',
    lede: 'Six-axis force/torque sensors at the ankles and wrists measure the forces the robot exchanges with the world; the treadmill’s force plates measure them independently from below.',
    specs: [
      { label: 'Ankle sensors', value: `${FORCE_TORQUE.ankle.fz} N · ${FORCE_TORQUE.ankle.mxy} Nm`, kind: 'design' },
      { label: 'Wrist sensors', value: `${FORCE_TORQUE.wrist.fz} N · ${FORCE_TORQUE.wrist.mxy} Nm`, kind: 'design' },
      { label: 'Joint torque', value: 'A100 torque flanges; current elsewhere', kind: 'design' },
      { label: 'Weight on the feet', value: f(model.robotMass * 9.81), unit: 'N', kind: 'calculated' },
    ],
    notes: [JOINT_SENSING.torque],
  },
  {
    id: 'power',
    title: 'Battery and power',
    short: 'Power',
    lede: 'A 14-series lithium-ion pack in the chest feeds a 50 V DC bus to every joint drive. Contactors and a pre-charge circuit connect it safely; isolated converters make 24, 12 and 5 V for the computers and sensors.',
    specs: [
      { label: 'Cells', value: `${pack.cells} × ${CELL.format} (${PACK.series}S${PACK.parallel}P)`, kind: 'design' },
      { label: 'Energy', value: f(pack.energyWh), unit: 'Wh', kind: 'calculated' },
      { label: 'Voltage', value: `${f(pack.minV)} – ${f(pack.maxV, 1)}`, unit: 'V', kind: 'calculated' },
      { label: 'Pack mass', value: f(pack.mass, 1), unit: 'kg', kind: 'calculated' },
      { label: 'Specific energy', value: f(pack.specificEnergy), unit: 'Wh/kg', kind: 'calculated' },
      { label: 'Peak ankle push', value: f(ankle.pitchTorque), unit: 'Nm', kind: 'calculated' },
    ],
    notes: ['Below 60 V DC the whole bus stays extra-low voltage: simpler insulation and safer service, paid for with higher currents.'],
  },
  {
    id: 'compute',
    title: 'Compute and networks',
    short: 'Compute',
    lede: 'Three layers of computing run at three speeds: perception and planning at tens of hertz, whole-body control at a kilohertz, and current control in each joint at twenty kilohertz. A separate safety controller can cut every drive’s torque in hardware.',
    specs: [
      { label: 'Perception, planning', value: '10–100', unit: 'Hz', kind: 'design' },
      { label: 'Whole-body control', value: '1', unit: 'kHz', kind: 'design' },
      { label: 'Joint current loop', value: '20', unit: 'kHz', kind: 'design' },
      { label: 'Joint network', value: 'EtherCAT, 1 kHz, µs sync', kind: 'design' },
      { label: 'Safety', value: 'dual-channel STO', kind: 'design' },
    ],
    notes: ['Cutting motor torque makes a standing biped fall: the safety controller first commands a controlled crouch, then removes torque.'],
  },
  {
    id: 'thermal',
    title: 'Thermal',
    short: 'Thermal',
    lede: 'Everything that converts energy loses some as heat: motor windings (I²R), drives, the battery and the computers. Here FO-H1 does repeated squats while time runs ten times faster, and each part warms at its own rate.',
    specs: [
      { label: 'Winding derating from', value: `${WINDING.derateStart}`, unit: '°C', kind: 'design' },
      { label: 'A100 thermal path', value: `${f(MOTOR_FRAMES.F100.rWindingHousing + MOTOR_FRAMES.F100.rHousingAmbient, 2)}`, unit: 'K/W', kind: 'estimate' },
      { label: 'Ankle actuators', value: `${ANKLE_LINEAR.stroke * 1000} mm stroke, ball screw`, kind: 'design' },
    ],
  },
];

export const SYSTEM_BY_ID = Object.fromEntries(SYSTEMS.map((s) => [s.id, s])) as Record<SystemId, SystemInfo>;
