/**
 * FO-H1's body: its kinematic tree, joint limits, actuator assignment and mass budget.
 *
 * Coordinates: metres, Y up, the robot faces +Z, its left side is +X. The zero pose is standing
 * straight with the arms hanging at the sides. Each joint rotates its child about `axis`
 * (in the parent segment's frame) by the joint angle; axes are chosen so that a positive angle
 * is the anatomical flexion / abduction / external rotation on both sides (the right side's
 * axes are mirrored).
 *
 * Proportions follow human segment ratios (Winter, Biomechanics and Motor Control of Human
 * Movement, table 4.1) for a 1.72 m standing height, adjusted where actuators set a size.
 * Masses are a component-by-component budget: every actuator, structure, shell, battery and
 * computer is listed with its segment and position, and the total mass and centre of mass are
 * calculated from this list (engine/mass.ts), never typed in.
 */
import { ACTUATORS, ANKLE_LINEAR, FINGER_ACTUATOR } from './actuators';

export type Side = 'L' | 'R';
export type Vec3 = readonly [number, number, number];

export type JointId =
  | 'waist_yaw'
  | 'neck_yaw'
  | 'neck_pitch'
  | `${Side}_hip_yaw`
  | `${Side}_hip_roll`
  | `${Side}_hip_pitch`
  | `${Side}_knee`
  | `${Side}_ankle_pitch`
  | `${Side}_ankle_roll`
  | `${Side}_shoulder_pitch`
  | `${Side}_shoulder_roll`
  | `${Side}_arm_yaw`
  | `${Side}_elbow`
  | `${Side}_wrist_yaw`
  | `${Side}_wrist_pitch`
  | `${Side}_wrist_roll`;

export type SegmentId =
  | 'pelvis'
  | 'torso'
  | 'neck'
  | 'head'
  | `${Side}_hip_yaw_link`
  | `${Side}_hip_roll_link`
  | `${Side}_thigh`
  | `${Side}_shin`
  | `${Side}_ankle_link`
  | `${Side}_foot`
  | `${Side}_shoulder_link`
  | `${Side}_shoulder_roll_link`
  | `${Side}_upper_arm`
  | `${Side}_forearm`
  | `${Side}_wrist_link`
  | `${Side}_wrist_cross`
  | `${Side}_hand`;

export interface JointSpec {
  id: JointId;
  label: string;
  parent: SegmentId;
  child: SegmentId;
  /** Joint origin in the parent segment's frame at the zero pose, m. */
  origin: Vec3;
  /** Unit rotation axis in the parent's frame. */
  axis: Vec3;
  /** Range of motion, degrees. design */
  min: number;
  max: number;
  /** Actuator family id, or 'ankle' for the parallel linear pair. design */
  actuator: keyof typeof ACTUATORS | 'ankle';
  /** Peak joint velocity the controller allows, rad/s (below the actuator's no-load speed). design */
  maxVelocity: number;
  group: 'leg' | 'arm' | 'torso' | 'neck';
}

/** Principal body dimensions, m. design (from human proportions at H = 1.72 m) */
export const DIM = {
  height: 1.72,
  hipHalfWidth: 0.09,
  thigh: 0.42,
  shin: 0.4,
  /** Ankle pitch axis to sole. */
  ankleHeight: 0.085,
  footLength: 0.25,
  /** Heel and toe relative to the ankle axis, along +Z. */
  heel: -0.07,
  toe: 0.18,
  footWidth: 0.105,
  /** Pelvis (hip joint line) to the waist yaw joint (top of the pelvis saddle). */
  waistHeight: 0.17,
  /** Waist to shoulder joint line. */
  shoulderHeight: 0.335,
  shoulderHalfWidth: 0.195,
  /** Waist to neck yaw. */
  neckHeight: 0.41,
  neckLength: 0.045,
  upperArm: 0.29,
  forearm: 0.25,
  /** Wrist pitch axis to palm centre and to the tip of the middle finger. */
  palm: 0.075,
  hand: 0.185,
} as const;

/** Wrist yaw joint below the elbow, m (clear of the elbow actuator). */
export const WRIST_YAW_Y = 0.115;

/** Knee actuator axis below the hip on the thigh, m (drives the knee through a push rod). */
export const KNEE_DRIVE_Y = 0.125;
/** Crank radius of the knee's parallel linkage (both cranks), m. */
export const KNEE_CRANK = 0.045;

/** Standing hip-joint height at the zero pose. */
export const HIP_HEIGHT = DIM.thigh + DIM.shin + DIM.ankleHeight;

const S = (side: Side) => (side === 'L' ? 1 : -1);

function legJoints(side: Side): JointSpec[] {
  const s = S(side);
  return [
    { id: `${side}_hip_yaw`, label: 'Hip yaw', parent: 'pelvis', child: `${side}_hip_yaw_link`, origin: [s * DIM.hipHalfWidth, 0, 0], axis: [0, s, 0], min: -30, max: 45, actuator: 'A80', maxVelocity: 6, group: 'leg' },
    { id: `${side}_hip_roll`, label: 'Hip roll', parent: `${side}_hip_yaw_link`, child: `${side}_hip_roll_link`, origin: [0, 0, 0], axis: [0, 0, s], min: -25, max: 40, actuator: 'A100', maxVelocity: 7, group: 'leg' },
    { id: `${side}_hip_pitch`, label: 'Hip pitch', parent: `${side}_hip_roll_link`, child: `${side}_thigh`, origin: [0, 0, 0], axis: [-1, 0, 0], min: -30, max: 120, actuator: 'A100', maxVelocity: 10, group: 'leg' },
    { id: `${side}_knee`, label: 'Knee', parent: `${side}_thigh`, child: `${side}_shin`, origin: [0, -DIM.thigh, 0], axis: [1, 0, 0], min: 0, max: 140, actuator: 'A100', maxVelocity: 10, group: 'leg' },
    { id: `${side}_ankle_pitch`, label: 'Ankle pitch', parent: `${side}_shin`, child: `${side}_ankle_link`, origin: [0, -DIM.shin, 0], axis: [-1, 0, 0], min: -45, max: 30, actuator: 'ankle', maxVelocity: 7, group: 'leg' },
    { id: `${side}_ankle_roll`, label: 'Ankle roll', parent: `${side}_ankle_link`, child: `${side}_foot`, origin: [0, 0, 0], axis: [0, 0, s], min: -20, max: 20, actuator: 'ankle', maxVelocity: 6, group: 'leg' },
  ];
}

function armJoints(side: Side): JointSpec[] {
  const s = S(side);
  return [
    { id: `${side}_shoulder_pitch`, label: 'Shoulder pitch', parent: 'torso', child: `${side}_shoulder_link`, origin: [s * DIM.shoulderHalfWidth, DIM.shoulderHeight, -0.01], axis: [-1, 0, 0], min: -60, max: 180, actuator: 'A80', maxVelocity: 8, group: 'arm' },
    { id: `${side}_shoulder_roll`, label: 'Shoulder roll', parent: `${side}_shoulder_link`, child: `${side}_shoulder_roll_link`, origin: [0, 0, 0], axis: [0, 0, s], min: -15, max: 165, actuator: 'A60', maxVelocity: 8, group: 'arm' },
    { id: `${side}_arm_yaw`, label: 'Upper-arm yaw', parent: `${side}_shoulder_roll_link`, child: `${side}_upper_arm`, origin: [0, 0, 0], axis: [0, s, 0], min: -90, max: 90, actuator: 'A60', maxVelocity: 9, group: 'arm' },
    { id: `${side}_elbow`, label: 'Elbow', parent: `${side}_upper_arm`, child: `${side}_forearm`, origin: [0, -DIM.upperArm, 0], axis: [-1, 0, 0], min: 0, max: 145, actuator: 'A80', maxVelocity: 9, group: 'arm' },
    { id: `${side}_wrist_yaw`, label: 'Wrist yaw', parent: `${side}_forearm`, child: `${side}_wrist_link`, origin: [0, -WRIST_YAW_Y, 0], axis: [0, s, 0], min: -90, max: 90, actuator: 'A45', maxVelocity: 5, group: 'arm' },
    { id: `${side}_wrist_pitch`, label: 'Wrist pitch', parent: `${side}_wrist_link`, child: `${side}_wrist_cross`, origin: [0, -(DIM.forearm - WRIST_YAW_Y), 0], axis: [-1, 0, 0], min: -70, max: 70, actuator: 'A45', maxVelocity: 5, group: 'arm' },
    { id: `${side}_wrist_roll`, label: 'Wrist roll', parent: `${side}_wrist_cross`, child: `${side}_hand`, origin: [0, 0, 0], axis: [0, 0, s], min: -35, max: 35, actuator: 'A45', maxVelocity: 5, group: 'arm' },
  ];
}

export const JOINTS: JointSpec[] = [
  ...legJoints('L'),
  ...legJoints('R'),
  { id: 'waist_yaw', label: 'Waist yaw', parent: 'pelvis', child: 'torso', origin: [0, DIM.waistHeight, 0], axis: [0, 1, 0], min: -60, max: 60, actuator: 'A80', maxVelocity: 5, group: 'torso' },
  { id: 'neck_yaw', label: 'Neck yaw', parent: 'torso', child: 'neck', origin: [0, DIM.neckHeight, -0.012], axis: [0, 1, 0], min: -80, max: 80, actuator: 'A45', maxVelocity: 5, group: 'neck' },
  { id: 'neck_pitch', label: 'Neck pitch', parent: 'neck', child: 'head', origin: [0, DIM.neckLength, 0], axis: [1, 0, 0], min: -35, max: 45, actuator: 'A45', maxVelocity: 5, group: 'neck' },
  ...armJoints('L'),
  ...armJoints('R'),
];

export const JOINT_BY_ID: Record<JointId, JointSpec> = Object.fromEntries(JOINTS.map((j) => [j.id, j])) as Record<JointId, JointSpec>;

/** Body degrees of freedom (hands excluded): 12 legs + 1 waist + 2 neck + 14 arms. */
export const BODY_DOF = JOINTS.length;

/** Each hand: 11 joints, 6 actuated (thumb flexion and rotation, one per finger). design */
export const HAND = {
  joints: 11,
  actuated: 6,
  fingers: ['thumb', 'index', 'middle', 'ring', 'little'] as const,
  /** Phalanx lengths, m (proximal, middle, distal); the thumb has two. design */
  phalanges: {
    thumb: [0.043, 0.034],
    index: [0.043, 0.026, 0.021],
    middle: [0.047, 0.029, 0.022],
    ring: [0.044, 0.027, 0.021],
    little: [0.036, 0.021, 0.019],
  } as Record<string, number[]>,
  /** Max fingertip normal force per finger, N (thumb opposing): calculated in engine/grasp.ts
   * from FINGER_ACTUATOR; these are the values used for layout checks. */
  fingertipForce: 15,
  tactileTaxelsPerFingertip: 16,
  tactileTaxelsPalm: 48,
};

// ─────────────────────────── mass budget ───────────────────────────

export type Subsystem = 'structure' | 'actuator' | 'shell' | 'power' | 'compute' | 'sensor' | 'hand' | 'wiring';

export interface MassItem {
  id: string;
  label: string;
  segment: SegmentId;
  mass: number;
  /** Centre of mass in the segment frame at the zero pose, m. */
  at: Vec3;
  subsystem: Subsystem;
  /** Structural material key (spec/materials.ts), where the item is a structural member. */
  material?: string;
}

const A = ACTUATORS;

function legMass(side: Side): MassItem[] {
  const s = S(side);
  const p = side;
  return [
    { id: `${p}_hip_yaw_act`, label: 'Hip yaw actuator', segment: 'pelvis', mass: A.A80.mass, at: [s * DIM.hipHalfWidth, 0.105, 0], subsystem: 'actuator' },
    { id: `${p}_hip_roll_act`, label: 'Hip roll actuator', segment: `${p}_hip_yaw_link`, mass: A.A100.mass, at: [0, 0, -0.108], subsystem: 'actuator' },
    { id: `${p}_hip_yaw_bracket`, label: 'Hip yaw bracket', segment: `${p}_hip_yaw_link`, mass: 0.26, at: [0, 0.05, -0.08], subsystem: 'structure' },
    { id: `${p}_hip_pitch_act`, label: 'Hip pitch actuator', segment: `${p}_hip_roll_link`, mass: A.A100.mass, at: [s * 0.055, 0, 0], subsystem: 'actuator' },
    { id: `${p}_hip_roll_bracket`, label: 'Hip roll clevis', segment: `${p}_hip_roll_link`, mass: 0.22, at: [s * 0.03, 0, -0.05], subsystem: 'structure' },
    { id: `${p}_thigh_member`, label: 'Thigh structural member', segment: `${p}_thigh`, mass: 0.95, at: [0, -0.2, 0], subsystem: 'structure', material: 'legMember' },
    { id: `${p}_thigh_shell`, label: 'Thigh covers', segment: `${p}_thigh`, mass: 0.45, at: [0, -0.18, 0.012], subsystem: 'shell' },
    // The knee actuator sits high on the thigh and drives the knee through a parallel push-rod
    // linkage (1:1): its 2.1 kg is 0.3 m closer to the hip, which cuts the swinging leg's
    // inertia about the hip by ~0.3 kg·m².
    { id: `${p}_knee_act`, label: 'Knee actuator', segment: `${p}_thigh`, mass: A.A100.mass, at: [s * 0.071, -KNEE_DRIVE_Y, 0], subsystem: 'actuator' },
    { id: `${p}_knee_linkage`, label: 'Knee push rod and cranks', segment: `${p}_thigh`, mass: 0.16, at: [s * 0.02, -0.27, -0.045], subsystem: 'structure' },
    { id: `${p}_thigh_harness`, label: 'Thigh harness', segment: `${p}_thigh`, mass: 0.1, at: [0, -0.2, -0.03], subsystem: 'wiring' },
    { id: `${p}_shin_member`, label: 'Shin structural member', segment: `${p}_shin`, mass: 0.7, at: [0, -0.2, 0], subsystem: 'structure', material: 'legMember' },
    { id: `${p}_shin_shell`, label: 'Shin covers', segment: `${p}_shin`, mass: 0.3, at: [0, -0.17, 0.02], subsystem: 'shell' },
    { id: `${p}_ankle_act_in`, label: 'Ankle actuator (inner)', segment: `${p}_shin`, mass: ANKLE_LINEAR.mass, at: [-s * 0.034, -0.13, -0.052], subsystem: 'actuator' },
    { id: `${p}_ankle_act_out`, label: 'Ankle actuator (outer)', segment: `${p}_shin`, mass: ANKLE_LINEAR.mass, at: [s * 0.034, -0.13, -0.052], subsystem: 'actuator' },
    { id: `${p}_ankle_rods`, label: 'Ankle push rods', segment: `${p}_shin`, mass: 0.1, at: [0, -0.31, -0.05], subsystem: 'structure' },
    { id: `${p}_ankle_cross`, label: 'Ankle cross (universal joint)', segment: `${p}_ankle_link`, mass: 0.1, at: [0, 0, 0], subsystem: 'structure' },
    { id: `${p}_ft_ankle`, label: 'Ankle force/torque sensor', segment: `${p}_foot`, mass: 0.25, at: [0, -0.035, 0], subsystem: 'sensor' },
    { id: `${p}_foot_plate`, label: 'Foot plate, sole and toe', segment: `${p}_foot`, mass: 0.75, at: [0, -0.066, 0.045], subsystem: 'structure' },
  ];
}

function armMass(side: Side): MassItem[] {
  const s = S(side);
  const p = side;
  return [
    { id: `${p}_shoulder_pitch_act`, label: 'Shoulder pitch actuator', segment: 'torso', mass: A.A80.mass, at: [s * (DIM.shoulderHalfWidth - 0.045), DIM.shoulderHeight, -0.01], subsystem: 'actuator' },
    { id: `${p}_shoulder_roll_act`, label: 'Shoulder roll actuator', segment: `${p}_shoulder_link`, mass: A.A60.mass, at: [0, 0, -0.085], subsystem: 'actuator' },
    { id: `${p}_shoulder_bracket`, label: 'Shoulder bracket', segment: `${p}_shoulder_link`, mass: 0.15, at: [s * 0.02, 0, 0], subsystem: 'structure' },
    { id: `${p}_arm_yaw_act`, label: 'Upper-arm yaw actuator', segment: `${p}_shoulder_roll_link`, mass: A.A60.mass, at: [0, -0.089, 0], subsystem: 'actuator' },
    { id: `${p}_arm_yaw_bracket`, label: 'Shoulder roll clevis', segment: `${p}_shoulder_roll_link`, mass: 0.1, at: [0, -0.02, 0], subsystem: 'structure' },
    { id: `${p}_upper_arm_member`, label: 'Upper-arm structure', segment: `${p}_upper_arm`, mass: 0.35, at: [0, -0.16, 0], subsystem: 'structure', material: 'armMember' },
    { id: `${p}_upper_arm_shell`, label: 'Upper-arm covers', segment: `${p}_upper_arm`, mass: 0.2, at: [0, -0.15, 0.005], subsystem: 'shell' },
    { id: `${p}_elbow_act`, label: 'Elbow actuator', segment: `${p}_upper_arm`, mass: A.A80.mass, at: [0, -DIM.upperArm + 0.01, 0], subsystem: 'actuator' },
    { id: `${p}_forearm_member`, label: 'Forearm structure', segment: `${p}_forearm`, mass: 0.25, at: [0, -0.1, 0], subsystem: 'structure', material: 'armMember' },
    { id: `${p}_forearm_shell`, label: 'Forearm covers', segment: `${p}_forearm`, mass: 0.15, at: [0, -0.11, 0.004], subsystem: 'shell' },
    { id: `${p}_wrist_yaw_act`, label: 'Wrist yaw actuator', segment: `${p}_forearm`, mass: A.A45.mass, at: [0, -0.084, 0], subsystem: 'actuator' },
    { id: `${p}_wrist_pitch_act`, label: 'Wrist pitch actuator', segment: `${p}_wrist_link`, mass: A.A45.mass, at: [0, -0.035, 0], subsystem: 'actuator' },
    { id: `${p}_wrist_roll_act`, label: 'Wrist roll actuator', segment: `${p}_wrist_link`, mass: A.A45.mass, at: [0, -0.1, 0], subsystem: 'actuator' },
    { id: `${p}_ft_wrist`, label: 'Wrist force/torque sensor', segment: `${p}_hand`, mass: 0.18, at: [0, -0.012, 0], subsystem: 'sensor' },
    { id: `${p}_palm`, label: 'Palm frame and covers', segment: `${p}_hand`, mass: 0.26, at: [0, -0.07, 0.006], subsystem: 'hand' },
    { id: `${p}_finger_acts`, label: 'Finger actuators (6)', segment: `${p}_hand`, mass: 6 * FINGER_ACTUATOR.mass, at: [0, -0.065, -0.004], subsystem: 'hand' },
    { id: `${p}_fingers`, label: 'Fingers and linkages', segment: `${p}_hand`, mass: 0.18, at: [0, -0.14, 0.01], subsystem: 'hand' },
    { id: `${p}_tactile`, label: 'Tactile skins and hand controller', segment: `${p}_hand`, mass: 0.06, at: [0, -0.09, 0.012], subsystem: 'sensor' },
  ];
}

export const MASS_ITEMS: MassItem[] = [
  { id: 'pelvis_frame', label: 'Pelvis frame', segment: 'pelvis', mass: 1.9, at: [0, 0.115, -0.01], subsystem: 'structure' },
  { id: 'pelvis_shell', label: 'Pelvis covers', segment: 'pelvis', mass: 0.55, at: [0, 0.1, 0.03], subsystem: 'shell' },
  { id: 'imu_main', label: 'Primary IMU and pelvis hub', segment: 'pelvis', mass: 0.25, at: [0, 0.11, -0.03], subsystem: 'sensor' },
  { id: 'waist_act', label: 'Waist yaw actuator', segment: 'torso', mass: A.A80.mass, at: [0, 0.037, 0], subsystem: 'actuator' },
  ...legMass('L'),
  ...legMass('R'),
  { id: 'torso_frame', label: 'Torso frame and ribs', segment: 'torso', mass: 3.2, at: [0, 0.17, -0.03], subsystem: 'structure' },
  { id: 'torso_shell', label: 'Chest and back covers', segment: 'torso', mass: 1.4, at: [0, 0.2, 0.01], subsystem: 'shell' },
  { id: 'battery', label: 'Battery pack', segment: 'torso', mass: 11.5, at: [0, 0.155, 0.012], subsystem: 'power' },
  { id: 'perception_pc', label: 'Perception and planning computer', segment: 'torso', mass: 1.1, at: [0, 0.27, -0.125], subsystem: 'compute' },
  { id: 'rt_controller', label: 'Real-time controller and safety MCU', segment: 'torso', mass: 0.45, at: [0, 0.19, -0.12], subsystem: 'compute' },
  { id: 'power_dist', label: 'Power distribution (contactors, DC/DC, fuses)', segment: 'torso', mass: 0.9, at: [0, 0.085, -0.055], subsystem: 'power' },
  { id: 'harness', label: 'Main wiring harness', segment: 'torso', mass: 0.8, at: [0, 0.19, -0.03], subsystem: 'wiring' },
  { id: 'chest_depth', label: 'Chest depth camera', segment: 'torso', mass: 0.15, at: [0, 0.3, 0.115], subsystem: 'sensor' },
  { id: 'fans', label: 'Cooling fans and ducts', segment: 'torso', mass: 0.25, at: [0, 0.3, -0.14], subsystem: 'compute' },
  { id: 'neck_yaw_act', label: 'Neck yaw actuator', segment: 'torso', mass: A.A45.mass, at: [0, DIM.neckHeight - 0.03, -0.012], subsystem: 'actuator' },
  ...armMass('L'),
  ...armMass('R'),
  { id: 'neck_pitch_act', label: 'Neck pitch actuator', segment: 'neck', mass: A.A45.mass, at: [0, DIM.neckLength, 0], subsystem: 'actuator' },
  { id: 'head_frame', label: 'Head frame and covers', segment: 'head', mass: 0.8, at: [0, 0.1, 0.01], subsystem: 'shell' },
  { id: 'head_sensors', label: 'Stereo pair, RGB camera, projector', segment: 'head', mass: 0.45, at: [0, 0.095, 0.075], subsystem: 'sensor' },
  { id: 'head_electronics', label: 'Head IMU and camera bridge', segment: 'head', mass: 0.15, at: [0, 0.12, -0.02], subsystem: 'compute' },
];

/** Segments that belong to each limb chain (used for limb-length scaling in Engineer mode). */
export const SEGMENT_CHAIN: Record<string, SegmentId[]> = {
  L_leg: ['L_hip_yaw_link', 'L_hip_roll_link', 'L_thigh', 'L_shin', 'L_ankle_link', 'L_foot'],
  R_leg: ['R_hip_yaw_link', 'R_hip_roll_link', 'R_thigh', 'R_shin', 'R_ankle_link', 'R_foot'],
  L_arm: ['L_shoulder_link', 'L_shoulder_roll_link', 'L_upper_arm', 'L_forearm', 'L_wrist_link', 'L_wrist_cross', 'L_hand'],
  R_arm: ['R_shoulder_link', 'R_shoulder_roll_link', 'R_upper_arm', 'R_forearm', 'R_wrist_link', 'R_wrist_cross', 'R_hand'],
};
