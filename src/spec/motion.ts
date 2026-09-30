/**
 * FO-H1's locomotion and task parameters. design (chosen within the range of published
 * humanoid and human gait data; see ENGINEERING.md)
 */

export const GRAVITY = 9.81;

export interface GaitSpec {
  id: 'slow' | 'normal' | 'fast';
  label: string;
  speed: number;
  stepLength: number;
  /** Time of one step (one foot's stance to the other's), s. */
  stepTime: number;
  /** Fraction of each step with both feet on the ground. */
  doubleSupport: number;
  /** Swing-foot clearance, m. */
  clearance: number;
  /** Knee bend held in stance to keep the COM height constant, deg. */
  stanceKnee: number;
}

export const GAITS: Record<GaitSpec['id'], GaitSpec> = {
  slow: { id: 'slow', label: 'Slow', speed: 0.5, stepLength: 0.3, stepTime: 0.6, doubleSupport: 0.25, clearance: 0.05, stanceKnee: 20 },
  normal: { id: 'normal', label: 'Normal', speed: 1.0, stepLength: 0.48, stepTime: 0.48, doubleSupport: 0.2, clearance: 0.055, stanceKnee: 24 },
  fast: { id: 'fast', label: 'Fast', speed: 1.5, stepLength: 0.63, stepTime: 0.42, doubleSupport: 0.15, clearance: 0.06, stanceKnee: 28 },
};

export const LOCOMOTION = {
  /** Height of the COM used by the linear inverted pendulum while walking, m. */
  comHeight: 0.93,
  /** Lateral distance between the feet's centre lines, m. */
  stepWidth: 0.18,
  /** Longest step the stepping strategy may take, m. */
  maxStep: 0.62,
  /** Minimum time to lift, place and load a recovery step, s. */
  minStepTime: 0.32,
  /** How close to the foot edge the controller lets the centre of pressure go (margin), m. */
  copMargin: 0.012,
  /** Peak hip moment available for the hip (flywheel) strategy, Nm (actuator-limited). */
  hipStrategyTorque: 110,
  /** Duration of a hip-strategy torque burst, s. */
  hipStrategyTime: 0.25,
};

/** Rated payload: two-handed, box held at hip height with forearms 30° below horizontal. */
export const PAYLOAD = {
  rated: 20,
  max: 30,
  /** Box centre ahead of the pelvis origin, m, and height above it, m (carry posture). */
  carryReach: 0.36,
  carryHeight: 0.18,
};

/** Human reference values used for comparison in the interface. estimate */
export const HUMAN_REFERENCE = {
  walkingSpeed: 1.3,
  costOfTransport: 0.2,
  comHeightFraction: 0.55,
};
