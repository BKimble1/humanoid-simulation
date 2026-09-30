/**
 * Standing: FO-H1 at rest, alive. The balance controller keeps the whole-body COM over the
 * feet but never perfectly still: small sway (a few millimetres at 0.2–0.4 Hz), actuator
 * settling (tenths of a degree), and the head's gaze moving smoothly between points of
 * interest. Presets move the arms for presentations (a hand raised to be looked at).
 * Everything goes through the COM-constrained posture solver, so the drawn COM is real.
 */
import { Quaternion, Vector2, Vector3 } from 'three';
import { DIM, type JointId, type Side } from '../../spec/body';
import { solveArm } from '../../engine/ik';
import type { RobotModel } from '../../engine/robot';
import { DEG, Kinematics, Pose } from '../../engine/skeleton';
import { carryArms, flatFoot, solvePosture } from '../../engine/wholebody';
import { handPoses, OPEN_HAND } from '../../scene/robot/hand';
import type { FootPose, Held, PoseSource } from '../pose';

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

/** Smooth pseudo-random signal: a sum of sines with incommensurate frequencies. */
function wander(t: number, f: number, seed: number): number {
  return (Math.sin(t * f * 6.283 + seed) * 0.6 + Math.sin(t * f * 2.71 * 6.283 + seed * 1.7) * 0.3 + Math.sin(t * f * 5.13 * 6.283 + seed * 2.3) * 0.1);
}

export class IdleSource implements PoseSource {
  id = 'idle';
  pose = new Pose();
  feet: Record<Side, FootPose>;
  preset: IdlePreset = 'rest';
  /** World point the head looks at (null: straight ahead with small glances). */
  gaze: Vector3 | null = null;
  /** Stance centre on the floor (x, z) and heading. */
  stance = new Vector2(0, 0);
  heading = 0;
  private t = 0;
  private kin: Kinematics;
  private neck = { yaw: 0, pitch: 0, vy: 0, vp: 0 };
  /** Amplitude of the living motion (0 frozen … 1 normal). */
  life = 1;
  /** Arm target for the showHand preset (world), set by the scene. */
  handTarget = new Vector3(0.3, 1.3, 0.3);
  private armPose = new Pose();
  held: Held | null = null;

  constructor(
    private model: () => RobotModel,
    kin: Kinematics,
  ) {
    this.kin = kin;
    this.feet = this.stanceFeet();
  }

  private stanceFeet(): Record<Side, FootPose> {
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const w = DIM.hipHalfWidth;
    const mk = (side: Side) => {
      const sx = side === 'L' ? w : -w;
      const f = flatFoot(this.stance.x + sx * c, this.stance.y - sx * s, this.heading);
      return { ankle: f.ankle, quat: f.quat };
    };
    return { L: mk('L'), R: mk('R') };
  }

  enter(from: Pose) {
    // keep standing where the feet are (after walking, the robot may be a little off centre)
    this.kin.update(from);
    const l = this.kin.point('L_foot', [0, 0, 0]);
    const r = this.kin.point('R_foot', [0, 0, 0]);
    const mid = l.clone().add(r).multiplyScalar(0.5);
    if (Math.abs(l.y - DIM.ankleHeight) < 0.02 && Math.abs(r.y - DIM.ankleHeight) < 0.02 && l.distanceTo(r) > 0.12 && l.distanceTo(r) < 0.26) {
      this.stance.set(mid.x, mid.z);
      this.heading = Math.atan2(l.z - r.z, l.x - r.x) * -1;
      if (Math.abs(this.heading) < 0.03) this.heading = 0;
    }
    this.feet = this.stanceFeet();
    this.armPose.copy(from);
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    const L = this.life;
    const model = this.model();
    const upper: Partial<Record<JointId, number>> = { ...REST_UPPER };
    // actuator settling and small arm shifts
    upper.L_shoulder_pitch! += L * 0.8 * wander(t, 0.11, 1);
    upper.R_shoulder_pitch! += L * 0.8 * wander(t, 0.1, 2);
    upper.L_elbow! += L * 1.2 * wander(t, 0.13, 3);
    upper.R_elbow! += L * 1.2 * wander(t, 0.12, 4);
    upper.waist_yaw! += L * 1.0 * wander(t, 0.05, 5);
    const hp = { L: handPoses.L, R: handPoses.R };
    hp.L.fingers = [0.14 + 0.03 * L * wander(t, 0.2, 6), 0.14, 0.16, 0.18];
    hp.R.fingers = [0.14 + 0.03 * L * wander(t, 0.21, 7), 0.14, 0.16, 0.18];
    hp.L.thumbFlex = hp.R.thumbFlex = OPEN_HAND.thumbFlex;
    hp.L.thumbOpp = hp.R.thumbOpp = OPEN_HAND.thumbOpp;
    if (this.preset === 'hero') {
      upper.L_elbow = 20;
      upper.R_elbow = 20;
    } else if (this.preset === 'ready') {
      upper.L_elbow = 38;
      upper.R_elbow = 38;
      upper.L_shoulder_pitch = 12;
      upper.R_shoulder_pitch = 12;
    } else if (this.preset === 'clearArms') {
      // arms forward and out, hands clear of the hips and thighs (actuator views)
      upper.L_shoulder_pitch = 24;
      upper.R_shoulder_pitch = 24;
      upper.L_shoulder_roll = 20;
      upper.R_shoulder_roll = 20;
      upper.L_elbow = 58;
      upper.R_elbow = 58;
      upper.L_arm_yaw = 10;
      upper.R_arm_yaw = 10;
    } else if (this.preset === 'armsOut') {
      upper.L_shoulder_roll = 38;
      upper.R_shoulder_roll = 38;
      upper.L_elbow = 24;
      upper.R_elbow = 24;
    }
    // carrying the Engineer payload: a box held in both hands, everywhere the robot stands
    const carrying = model.config.payload > 0;
    if (carrying) {
      Object.assign(upper, carryArms());
      upper.L_elbow! += L * 0.8 * wander(t, 0.13, 3);
      upper.R_elbow! += L * 0.8 * wander(t, 0.12, 4);
      hp.L.fingers = [0.5, 0.5, 0.52, 0.54];
      hp.R.fingers = [0.5, 0.5, 0.52, 0.54];
    }
    // stance and COM sway
    const c = Math.cos(this.heading);
    const sn = Math.sin(this.heading);
    const swayX = L * (0.0035 * wander(t, 0.31, 8) + 0.0012 * wander(t, 0.9, 9));
    const swayZ = L * (0.0045 * wander(t, 0.23, 10) + 0.0012 * wander(t, 0.8, 11));
    const com = new Vector2(this.stance.x + swayX * c + (0.035 + swayZ) * sn, this.stance.y - swayX * sn + (0.035 + swayZ) * c);
    const legLen = DIM.thigh * this.kin.scale.thigh + DIM.shin * this.kin.scale.shin;
    const h = DIM.ankleHeight + legLen * Math.cos(12 * DEG) - 0.004 + L * 0.0015 * wander(t, 0.17, 12);
    this.feet = this.stanceFeet();
    solvePosture(model, this.kin, this.pose, {
      com,
      pelvisHeight: h,
      pelvisYaw: this.heading,
      pelvisPitch: 1.5 * DEG,
      feet: { L: this.feet.L, R: this.feet.R },
      upper,
      iterations: 3,
    });
    if (carrying) {
      this.kin.update(this.pose);
      this.held = { pos: this.kin.palm('L').add(this.kin.palm('R')).multiplyScalar(0.5), mass: model.config.payload, hands: 'both' };
    } else this.held = null;
    // presented hand: the left arm reaches to a point in front of the chest, palm up
    if (this.preset === 'showHand' && !carrying) {
      this.pose.setDeg({ L_wrist_yaw: -70 });
      solveArm(this.pose, 'L', this.handTarget, this.kin, { iterations: 20 });
      hp.L.fingers = [0.1 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.9)), 0.12 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.9 - 0.4)), 0.14 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.9 - 0.8)), 0.16 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.9 - 1.2))];
      hp.L.thumbFlex = 0.2 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.9 - 0.2));
      hp.L.thumbOpp = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.9 - 0.2));
    }
    this.aimHead(dt);
  }

  /** Point the head at the gaze target with a critically damped spring (no snapping). */
  private aimHead(dt: number) {
    const t = this.t;
    let yaw = 0.06 * this.life * wander(t, 0.07, 13);
    let pitch = 0.05 + 0.03 * this.life * wander(t, 0.06, 14);
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

export { Quaternion };
