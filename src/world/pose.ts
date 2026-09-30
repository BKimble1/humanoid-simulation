/**
 * Pose sources and the pose driver.
 *
 * Everything that moves the robot is a PoseSource: standing idle, walking, balancing, reaching,
 * manipulating. Each produces a full pose every frame, plus where its feet are (ankle poses in
 * the world) and whether they are planted. The driver owns the robot's pose: when the source
 * changes it cross-fades from the pose last shown to the new source over a fixed time, blending
 * the pelvis and the feet in task space and re-solving the legs, so a foot that is planted in
 * both poses stays planted during the blend (joint-space blending would drag it).
 */
import { Quaternion, Vector3 } from 'three';
import { DIM, type Side } from '../spec/body';
import { solveLeg } from '../engine/ik';
import { Pose, type LimbScale, JOINT_INDEX, NJ } from '../engine/skeleton';

export interface FootPose {
  ankle: Vector3;
  quat: Quaternion;
}

/** Something the robot holds: where it is (world), its mass, and which hands carry it. */
export interface Held {
  pos: Vector3;
  mass: number;
  hands: 'both' | 'L' | 'R';
}

export interface PoseSource {
  id: string;
  pose: Pose;
  feet: Record<Side, FootPose>;
  /** What the robot holds now (null: nothing). */
  held?: Held | null;
  /** Heating and discharge speed-up for demonstrations of long duty cycles (1: real time). */
  thermalScale?: number;
  /** Advance the source by dt seconds. */
  update(dt: number): void;
  /** Called when the source becomes the driver's target (reset state as needed). */
  enter?(from: Pose): void;
  /** Called when the driver leaves the source. */
  exit?(): void;
  /** Numbers for the panels. */
  readouts?(r: Record<string, number | string | boolean>): void;
}

const LEG_JOINTS = new Set(['hip_yaw', 'hip_roll', 'hip_pitch', 'knee', 'ankle_pitch', 'ankle_roll'].flatMap((j) => [`L_${j}`, `R_${j}`]).map((id) => JOINT_INDEX[id as keyof typeof JOINT_INDEX]));

export function footPosesFrom(pose: Pose, kin: { update(p: Pose): unknown; frames: Map<string, import('three').Matrix4> }): Record<Side, FootPose> {
  kin.update(pose);
  const out = {} as Record<Side, FootPose>;
  for (const s of ['L', 'R'] as Side[]) {
    const m = kin.frames.get(`${s}_foot`)!;
    const ankle = new Vector3().setFromMatrixPosition(m);
    const quat = new Quaternion().setFromRotationMatrix(m);
    out[s] = { ankle, quat };
  }
  return out;
}

const smooth = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);

export class PoseDriver {
  out = new Pose();
  source: PoseSource | null = null;
  private snapshot = new Pose();
  private snapFeet: Record<Side, FootPose> = { L: { ankle: new Vector3(DIM.hipHalfWidth, DIM.ankleHeight, 0), quat: new Quaternion() }, R: { ankle: new Vector3(-DIM.hipHalfWidth, DIM.ankleHeight, 0), quat: new Quaternion() } };
  private blend = 1;
  private blendDur = 0.9;
  feet: Record<Side, FootPose> = { L: { ankle: new Vector3(), quat: new Quaternion() }, R: { ankle: new Vector3(), quat: new Quaternion() } };
  scale: LimbScale;

  constructor(scale: LimbScale) {
    this.scale = scale;
  }

  /** Switch to a new source, blending from what is shown now. */
  use(src: PoseSource, duration = 0.9) {
    if (src === this.source) return;
    this.source?.exit?.();
    this.snapshot.copy(this.out);
    this.snapFeet = { L: { ankle: this.feet.L.ankle.clone(), quat: this.feet.L.quat.clone() }, R: { ankle: this.feet.R.ankle.clone(), quat: this.feet.R.quat.clone() } };
    this.source = src;
    src.enter?.(this.out);
    this.blend = this.source ? 0 : 1;
    this.blendDur = duration;
  }

  get blending(): boolean {
    return this.blend < 1;
  }

  update(dt: number) {
    const src = this.source;
    if (!src) return;
    src.update(dt);
    if (this.blend >= 1) {
      this.out.copy(src.pose);
      this.feet.L.ankle.copy(src.feet.L.ankle);
      this.feet.L.quat.copy(src.feet.L.quat);
      this.feet.R.ankle.copy(src.feet.R.ankle);
      this.feet.R.quat.copy(src.feet.R.quat);
      return;
    }
    this.blend = Math.min(1, this.blend + dt / this.blendDur);
    const w = smooth(this.blend);
    const o = this.out;
    for (let i = 0; i < NJ; i++) if (!LEG_JOINTS.has(i)) o.q[i] = this.snapshot.q[i] + (src.pose.q[i] - this.snapshot.q[i]) * w;
    o.pelvisPos.lerpVectors(this.snapshot.pelvisPos, src.pose.pelvisPos, w);
    o.pelvisQuat.slerpQuaternions(this.snapshot.pelvisQuat, src.pose.pelvisQuat, w);
    for (const s of ['L', 'R'] as Side[]) {
      const f = this.feet[s];
      const a = this.snapFeet[s];
      const b = src.feet[s];
      // a foot that moves between the two poses travels in a small arc (lifted), never sliding
      const travel = a.ankle.distanceTo(b.ankle);
      f.ankle.lerpVectors(a.ankle, b.ankle, w);
      if (travel > 0.01) f.ankle.y += Math.min(0.05, travel * 0.5) * Math.sin(Math.PI * w);
      f.quat.slerpQuaternions(a.quat, b.quat, w);
      solveLeg(o, s, f.ankle, f.quat, this.scale);
    }
  }
}
