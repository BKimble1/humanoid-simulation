/**
 * FO-H1's sensors, computers and networks. Design values are chosen to be typical of current
 * robotics-grade components; performance numbers are estimates (see ENGINEERING.md). No
 * specific vendor's product is implied.
 */

export const HEAD_CAMERAS = {
  stereo: {
    /** Baseline between the two global-shutter cameras, m. design */
    baseline: 0.08,
    width: 1280,
    height: 800,
    hfovDeg: 87,
    rateHz: 30,
    /** Sub-pixel disparity matching noise (1σ), px. estimate */
    disparitySigmaPx: 0.1,
    rangeMin: 0.3,
    rangeMax: 6,
  },
  rgb: { width: 1920, height: 1200, hfovDeg: 100, rateHz: 30 },
  projector: 'Infrared dot-pattern projector, adds texture for stereo matching on blank surfaces',
};

export const CHEST_DEPTH = {
  kind: 'Time-of-flight',
  width: 640,
  height: 480,
  hfovDeg: 70,
  rateHz: 30,
  rangeMin: 0.2,
  rangeMax: 4,
  purpose: 'Looks down and ahead at the ground for footstep placement',
};

export const IMU = {
  location: 'Pelvis, next to the whole-body centre of mass (secondary IMU in the head)',
  rateHz: 1000,
  /** Gyro angle random walk, deg/s/√Hz. estimate (industrial MEMS) */
  gyroNoiseDensity: 0.004,
  /** Gyro in-run bias instability, deg/h. estimate */
  gyroBiasInstability: 2,
  /** Accelerometer noise density, g/√Hz. estimate */
  accelNoiseDensity: 70e-6,
  accelRangeG: 16,
  gyroRangeDps: 2000,
};

export const FORCE_TORQUE = {
  ankle: { fz: 2500, fxy: 1200, mxy: 150, resolutionN: 0.5, rateHz: 1000 },
  wrist: { fz: 500, fxy: 300, mxy: 30, resolutionN: 0.1, rateHz: 1000 },
  principle: 'Strain gauges on a machined flexure, six-axis, temperature compensated',
};

export const JOINT_SENSING = {
  motorEncoderBits: 16,
  outputEncoderBits: 19,
  currentSensing: 'Phase current shunts, 20 kHz',
  windingSensor: 'NTC thermistor potted in the end winding',
  torque: 'Strain-gauge output flange on the A100 (hips and knees); elsewhere torque is estimated from current and the difference between the two encoders',
};

export const TACTILE = {
  fingertipTaxels: 16,
  palmTaxels: 48,
  principle: 'Capacitive three-axis taxels under a silicone skin: normal and shear force at each taxel',
  rateHz: 1000,
  normalRangeN: [0.05, 20] as [number, number],
  /** Micro-slip is visible as rising shear ratio and a 50–400 Hz vibration burst. estimate */
  slipBandHz: [50, 400] as [number, number],
};

export interface ComputeNode {
  id: string;
  label: string;
  role: string;
  rate: string;
  location: string;
}

export const COMPUTE: ComputeNode[] = [
  { id: 'perception', label: 'Perception and planning computer', role: 'Stereo depth, object detection and segmentation, mapping, task planning', rate: '10–30 Hz', location: 'Upper back' },
  { id: 'planner', label: 'Locomotion planner', role: 'Footstep plan and centroidal model-predictive control', rate: '100 Hz', location: 'Real-time controller' },
  { id: 'rt', label: 'Real-time controller', role: 'State estimation and whole-body control (a quadratic program over joint torques and contact forces)', rate: '1 kHz', location: 'Upper back, isolated from the perception computer' },
  { id: 'drives', label: 'Joint drives (29)', role: 'Field-oriented current control, joint impedance and velocity loops, encoder and temperature reading', rate: '20 kHz current · 5 kHz impedance', location: 'On each actuator' },
  { id: 'safety', label: 'Safety controller', role: 'Dual-channel monitoring: emergency stop, watchdogs, safe torque off to every drive, battery contactors', rate: '1 kHz, hard-wired', location: 'Lower torso, beside power distribution' },
];

export const NETWORKS = [
  { id: 'ethercat', label: 'EtherCAT', detail: '100 Mbit/s, four segments (legs, arms and torso), 1 kHz cycle with distributed clocks: every drive samples within about a microsecond of the others', kind: 'deterministic' },
  { id: 'canfd', label: 'CAN FD', detail: '5 Mbit/s from the wrist hub to the six finger drivers and tactile skins of each hand', kind: 'deterministic' },
  { id: 'camera', label: 'Camera links', detail: 'Serialised camera links (MIPI CSI-2 over coax) from the head and chest cameras to the perception computer', kind: 'bulk' },
  { id: 'ethernet', label: 'Ethernet', detail: '2.5 Gbit/s between the perception computer and the real-time controller (plans and object poses down, robot state up)', kind: 'bulk' },
  { id: 'sto', label: 'Safe torque off', detail: 'Two hard-wired channels from the safety controller to every drive: cuts gate drive regardless of software', kind: 'safety' },
] as const;
