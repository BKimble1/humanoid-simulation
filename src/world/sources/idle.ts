/**
 * Standing: FO-H1 at rest, alive. The balance controller keeps the whole-body COM over the
 * feet but never perfectly still: small sway (a few millimetres at 0.2–0.4 Hz) that comes and
 * goes, with quiet spells; actuator settling (tenths of a degree); and the head's gaze moving
 * smoothly between points of interest. Close inspection presets quieten it further, so the
 * mechanics can be read. Presets move the arms for presentations (a hand raised to be looked
 * at); each preset is a posture identity, so changing it blends like a change of source.
 * Everything goes through the COM-constrained posture solver, so the drawn COM is real.
 */
import { Quaternion, Vector2, Vector3 } from 'three';
import { DIM, type JointId, type Side } from '../../spec/body';
import { solveArm } from '../../engine/ik';
import type { RobotModel } from '../../engine/robot';
import { DEG, Kinematics, Pose } from '../../engine/skeleton';
import { carryArms, solvePosture } from '../../engine/wholebody';
import { bothHands, relax } from '../handPose';
import type { DisplayState, FootPose, Held, PoseSource } from '../pose';
import { StanceKeeper, homeStance, newFeet, type StanceFoot } from '../stance';

export type IdlePreset = 'rest' | 'hero' | 'showHand' | 'lookCart' | 'ready' | 'armsOut' | 'clearArms';

const REST_UPPER: Partial<Record<JointId, number>> = {
  L_shoulder_pitch: 5,
  R_shoulder_pitch: 5,
  L_shoulder_roll: 7,
  R_shoulder_roll: 7,
  L_arm_yaw: -8,
  R_arm_yaw: -8,
  L_elbow: 16,
  R_elbow: 16,
  L_wrist_yaw: 0,
  R_wrist_yaw: 0,
  L_wrist_pitch: 0,
  R_wrist_pitch: 0,
  L_wrist_roll: 0,
  R_wrist_roll: 0,
  waist_yaw: 0,
};

/** Left palm facing forward (+Z) with the fingers up: a half turn about (1, 0, −1)/√2 from the
 * hand's rest frame. */
const PALM_FORWARD = new Quaternion(Math.SQRT1_2, 0, -Math.SQRT1_2, 0);

/** Presets for close inspection: the living motion is quietened. */
const INSPECTION: Partial<Record<IdlePreset, number>> = { clearArms: 0.35, showHand: 0.45 };

/** Smooth pseudo-random signal: a sum of sines with incommensurate frequencies. */
function wander(t: number, f: number, seed: number): number {
  return Math.sin(t * f * 6.283 + seed) * 0.6 + Math.sin(t * f * 2.71 * 6.283 + seed * 1.7) * 0.3 + Math.sin(t * f * 5.13 * 6.283 + seed * 2.3) * 0.1;
}

/** 0 … 1 envelope with quiet spells: the sway comes and goes over tens of seconds. */
function envelope(t: number): number {
  const x = 0.5 + 0.5 * Math.sin(t * 0.13 + 0.7) * Math.cos(t * 0.047 + 1.9);
  return 0.25 + 0.75 * x * x * (3 - 2 * x);
}

export class IdleSource implements PoseSource {
  id = 'idle';
  pose = new Pose();
  feet: Record<Side, FootPose> = newFeet();
  hands = bothHands();
  preset: IdlePreset = 'rest';
  /** World point the head looks at (null: straight ahead with small glances). */
  gaze: Vector3 | null = null;
  /** Amplitude of the living motion (0 frozen … 1 normal). */
  life = 1;
  /** Arm target for the showHand preset (world), set by the scene. */
  handTarget = new Vector3(0.3, 1.38, 0.38);
  held: Held | null = null;
  private t = 0;
  private kin: Kinematics;
  private neck = { yaw: 0, pitch: 0, vy: 0, vp: 0 };
  private stance = new StanceKeeper();
  private lifeNow = 1;
  private carrying = false;

  constructor(
    private model: () => RobotModel,
    kin: Kinematics,
  ) {
    this.kin = kin;
  }

  get posture(): string {
    return `${this.preset}${this.carrying ? '+carry' : ''}`;
  }

  enter(from: DisplayState) {
    // keep standing where the feet are when they make a stance; otherwise step into one
    const L = from.feet.L.ankle;
    const R = from.feet.R.ankle;
    const w = Math.hypot(L.x - R.x, L.z - R.z);
    const heading = Math.atan2(-(L.z - R.z), L.x - R.x);
    const good = w > 0.14 && w < 0.24 && Math.abs(heading) < 0.35;
    const midX = (L.x + R.x) / 2;
    const midZ = (L.z + R.z) / 2;
    const home: Record<Side, StanceFoot> | null = good ? null : homeStance(midX, midZ, Math.abs(heading) < 0.35 ? heading : 0);
    this.kin.update(from.pose);
    const com = this.model().com(this.kin);
    this.stance.begin(from.feet, home, new Vector2(com.x, com.z));
    this.pose.copy(from.pose);
  }

  releasable(): boolean {
    return !this.stance.lifted;
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    const model = this.model();
    this.carrying = model.config.payload > 0;
    // living motion: quieter in close inspection, and never all at once
    const lifeT = this.life * (INSPECTION[this.preset] ?? 1);
    this.lifeNow += (lifeT - this.lifeNow) * (1 - Math.exp(-dt * 1.5));
    const L = this.lifeNow * envelope(t);
    const upper: Partial<Record<JointId, number>> = { ...REST_UPPER };
    upper.L_shoulder_pitch! += L * 0.7 * wander(t, 0.11, 1);
    upper.R_shoulder_pitch! += L * 0.7 * wander(t, 0.1, 2);
    upper.L_elbow! += L * 1.0 * wander(t, 0.13, 3);
    upper.R_elbow! += L * 1.0 * wander(t, 0.12, 4);
    upper.waist_yaw! += L * 0.8 * wander(t, 0.05, 5);
    relax(this.hands.L);
    relax(this.hands.R);
    this.hands.L.fingers[0] += 0.03 * L * wander(t, 0.2, 6);
    this.hands.R.fingers[0] += 0.03 * L * wander(t, 0.21, 7);
    if (this.preset === 'hero') {
      upper.L_elbow! += 4;
      upper.R_elbow! += 4;
    } else if (this.preset === 'ready') {
      upper.L_elbow = 38;
      upper.R_elbow = 38;
      upper.L_shoulder_pitch = 12;
      upper.R_shoulder_pitch = 12;
    } else if (this.preset === 'clearArms') {
      // arms a little back and out, hands behind the thighs: nothing between a camera at the
      // front-left and the hip, knee and elbow actuators (actuator views)
      upper.L_shoulder_pitch = -14;
      upper.R_shoulder_pitch = -14;
      upper.L_shoulder_roll = 17;
      upper.R_shoulder_roll = 17;
      upper.L_elbow = 34;
      upper.R_elbow = 34;
      upper.L_arm_yaw = -6;
      upper.R_arm_yaw = -6;
    } else if (this.preset === 'armsOut') {
      upper.L_shoulder_roll = 38;
      upper.R_shoulder_roll = 38;
      upper.L_elbow = 24;
      upper.R_elbow = 24;
    }
    // carrying the Engineer payload: a box held in both hands, everywhere the robot stands
    if (this.carrying) {
      Object.assign(upper, carryArms());
      upper.L_elbow! += L * 0.6 * wander(t, 0.13, 3);
      upper.R_elbow! += L * 0.6 * wander(t, 0.12, 4);
      for (const h of [this.hands.L, this.hands.R]) {
        h.fingers = [0.5, 0.5, 0.52, 0.54];
        h.thumbFlex = 0.3;
        h.thumbOpp = 0.45;
      }
    }
    // stance and COM sway (the stance keeper steps the feet into place first, if needed)
    const f = this.stance.feet;
    const midX = (f.L.x + f.R.x) / 2;
    const midZ = (f.L.z + f.R.z) / 2;
    const heading = Math.atan2(-(f.L.z - f.R.z), f.L.x - f.R.x);
    const c = Math.cos(heading);
    const sn = Math.sin(heading);
    const swayX = L * (0.003 * wander(t, 0.31, 8) + 0.001 * wander(t, 0.9, 9));
    const swayZ = L * (0.0038 * wander(t, 0.23, 10) + 0.001 * wander(t, 0.8, 11));
    const nominal = new Vector2(midX + swayX * c + (0.035 + swayZ) * sn, midZ - swayX * sn + (0.035 + swayZ) * c);
    this.stance.update(dt, nominal);
    const com = this.stance.com ?? nominal;
    const legLen = DIM.thigh * this.kin.scale.thigh + DIM.shin * this.kin.scale.shin;
    const h = DIM.ankleHeight + legLen * Math.cos(12 * DEG) - 0.004 + L * 0.0012 * wander(t, 0.17, 12);
    this.stance.footPoses(this.feet);
    solvePosture(model, this.kin, this.pose, {
      com,
      pelvisHeight: h,
      pelvisYaw: heading,
      pelvisPitch: 1.5 * DEG,
      feet: { L: this.feet.L, R: this.feet.R },
      upper,
      iterations: 3,
      // while stepping from a wide stance a leg must not be pulled straight
      limitReach: true,
    });
    if (this.carrying) {
      this.kin.update(this.pose);
      this.held = { pos: this.kin.palm('L').add(this.kin.palm('R')).multiplyScalar(0.5), mass: model.config.payload, hands: 'both' };
    } else this.held = null;
    // presented hand: the left arm reaches to a point in front of the chest, palm up; the
    // fingers close and open slowly, one after another
    if (this.preset === 'showHand' && !this.carrying) {
      // the palm towards the viewer, fingers up: the fingers curl towards the camera
      solveArm(this.pose, 'L', this.handTarget, this.kin, { iterations: 28, orientation: PALM_FORWARD });
      const hp = this.hands.L;
      const wave = (k: number) => 0.5 - 0.5 * Math.cos(Math.max(0, t - 1.2) * 0.9 - k * 0.4);
      hp.fingers = [0.1 + 0.55 * wave(0), 0.12 + 0.55 * wave(1), 0.14 + 0.55 * wave(2), 0.16 + 0.55 * wave(3)];
      hp.thumbFlex = 0.1 + 0.45 * wave(0.5);
      hp.thumbOpp = 0.2 + 0.45 * wave(0.5);
    }
    this.aimHead(dt);
  }

  /** Point the head at the gaze target with a critically damped spring (no snapping). */
  private aimHead(dt: number) {
    const t = this.t;
    let yaw = 0.05 * this.lifeNow * wander(t, 0.07, 13);
    let pitch = 0.05 + 0.025 * this.lifeNow * wander(t, 0.06, 14);
    if (this.gaze) {
      this.kin.update(this.pose);
      const head = this.kin.point('neck', [0, DIM.neckLength, 0]);
      const torso = this.kin.frames.get('torso')!;
      const inv = torso.clone().invert();
      const d = this.gaze.clone().applyMatrix4(inv).sub(head.clone().applyMatrix4(inv));
      yaw = Math.atan2(d.x, d.z);
      pitch = -Math.atan2(d.y, Math.hypot(d.x, d.z)) + 0.02;
      yaw = Math.max(-1.1, Math.min(1.1, yaw));
      pitch = Math.max(-0.5, Math.min(0.6, pitch));
    }
    const w = 5.5;
    const n = this.neck;
    n.vy += (w * w * (yaw - n.yaw) - 2 * w * n.vy) * dt;
    n.vp += (w * w * (pitch - n.pitch) - 2 * w * n.vp) * dt;
    n.yaw += n.vy * dt;
    n.pitch += n.vp * dt;
    this.pose.set('neck_yaw', n.yaw);
    this.pose.set('neck_pitch', n.pitch);
  }
}
