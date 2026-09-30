/**
 * The robot as configured: which actuator each joint has, what every part weighs, where the
 * centre of mass is. Engineer mode edits a RobotConfig; everything downstream (balance,
 * walking energy, joint torques, runtime) reads the RobotModel built from it.
 */
import { Vector3 } from 'three';
import { ACTUATORS } from '../spec/actuators';
import { JOINTS, MASS_ITEMS, type MassItem, type SegmentId, type Subsystem } from '../spec/body';
import { DEFAULT_MATERIALS, MEMBERS } from '../spec/materials';
import { PAYLOAD } from '../spec/motion';
import { configureActuator, ratings, type ActuatorConfig, type ActuatorRatings, type RotaryReducer } from './actuator';
import { DEFAULT_PACK, packSpec, type PackConfig, type PackSpec } from './battery';
import { Kinematics, type LimbScale, SEGMENTS, UNIT_SCALE, segmentScale } from './skeleton';
import { member, type MemberKey } from './structure';

export interface LegActuatorChange {
  reducer: RotaryReducer;
  ratio: number;
  /** Motor stack length relative to the reference stack. */
  stackScale: number;
  peakCurrent: number;
}

export interface RobotConfig {
  scale: LimbScale;
  materials: Record<MemberKey, string>;
  pack: PackConfig;
  /** Payload held in both hands, kg. */
  payload: number;
  /** Extra equipment mounted in the torso, kg. */
  torsoExtra: number;
  /** Changes to the hip-pitch and knee actuators (A100 family). */
  legActuator: LegActuatorChange;
}

export const DEFAULT_CONFIG: RobotConfig = {
  scale: { ...UNIT_SCALE },
  materials: { ...DEFAULT_MATERIALS },
  pack: { ...DEFAULT_PACK },
  payload: 0,
  torsoExtra: 0,
  legActuator: { reducer: 'cycloidal', ratio: 30, stackScale: 1, peakCurrent: ACTUATORS.A100.peakCurrent },
};

export function cloneConfig(c: RobotConfig): RobotConfig {
  return JSON.parse(JSON.stringify(c));
}

export interface SegmentMass {
  mass: number;
  com: Vector3;
}

export class RobotModel {
  readonly config: RobotConfig;
  readonly pack: PackSpec;
  /** Actuator configuration of each joint by joint index (the ankle pair: null). */
  readonly actuators: (ActuatorConfig | null)[];
  readonly actuatorRatings: (ActuatorRatings | null)[];
  readonly items: MassItem[];
  readonly segments = new Map<SegmentId, SegmentMass>();
  readonly totalMass: number;
  /** Mass without the payload. */
  readonly robotMass: number;

  constructor(config: RobotConfig = DEFAULT_CONFIG) {
    this.config = cloneConfig(config);
    this.pack = packSpec(this.config.pack);
    const bus = this.pack.nominalV;
    const la = this.config.legActuator;
    const legFamily = configureActuator(ACTUATORS.A100, bus, la);
    const cache = new Map<string, ActuatorConfig>();
    this.actuators = JOINTS.map((j) => {
      if (j.actuator === 'ankle') return null;
      if (j.actuator === 'A100') return legFamily;
      if (!cache.has(j.actuator)) cache.set(j.actuator, configureActuator(ACTUATORS[j.actuator], bus));
      return cache.get(j.actuator)!;
    });
    this.actuatorRatings = this.actuators.map((a) => (a ? ratings(a) : null));

    // Mass items, with the configuration's substitutions.
    const memberDefault = { legMember: member('legMember', DEFAULT_MATERIALS.legMember), armMember: member('armMember', DEFAULT_MATERIALS.armMember) };
    const memberNow = { legMember: member('legMember', this.config.materials.legMember), armMember: member('armMember', this.config.materials.armMember) };
    this.items = MASS_ITEMS.map((it) => {
      let mass = it.mass;
      if (it.id.endsWith('_hip_pitch_act') || it.id.endsWith('_knee_act')) mass = legFamily.mass;
      if (it.material === 'legMember' || it.material === 'armMember') {
        const k = it.material as MemberKey;
        mass = it.mass - memberDefault[k].tubeMass + memberNow[k].tubeMass;
        // a longer member is heavier in proportion
        mass *= segmentScale(it.segment, this.config.scale);
      } else if (it.subsystem === 'shell' || it.subsystem === 'wiring') {
        mass *= segmentScale(it.segment, this.config.scale);
      }
      if (it.id === 'battery') mass = this.pack.mass;
      const s = segmentScale(it.segment, this.config.scale);
      return { ...it, mass, at: [it.at[0], it.at[1] * s, it.at[2]] as const };
    });
    if (this.config.torsoExtra > 0)
      this.items.push({ id: 'torso_extra', label: 'Added torso equipment', segment: 'torso', mass: this.config.torsoExtra, at: [0, 0.3, -0.12], subsystem: 'structure' });

    for (const seg of SEGMENTS) this.segments.set(seg, { mass: 0, com: new Vector3() });
    for (const it of this.items) {
      const s = this.segments.get(it.segment)!;
      s.com.multiplyScalar(s.mass).add(new Vector3(it.at[0], it.at[1], it.at[2]).multiplyScalar(it.mass));
      s.mass += it.mass;
      s.com.divideScalar(s.mass);
    }
    this.robotMass = this.items.reduce((a, it) => a + it.mass, 0);
    this.totalMass = this.robotMass + this.config.payload;
  }

  /** Mass by subsystem, kg. */
  bySubsystem(): Record<Subsystem, number> {
    const out = { structure: 0, actuator: 0, shell: 0, power: 0, compute: 0, sensor: 0, hand: 0, wiring: 0 } as Record<Subsystem, number>;
    for (const it of this.items) out[it.subsystem] += it.mass;
    return out;
  }

  /** World centre of mass of each segment (after kin.update). */
  segmentComs(kin: Kinematics): Map<SegmentId, Vector3> {
    const out = new Map<SegmentId, Vector3>();
    for (const [seg, s] of this.segments) out.set(seg, kin.point(seg, s.com));
    return out;
  }

  /**
   * Whole-body centre of mass in the world. The payload, if any, is at `payloadPos` (world);
   * by default midway between the palms.
   */
  com(kin: Kinematics, payloadPos?: Vector3, out = new Vector3()): Vector3 {
    out.set(0, 0, 0);
    const tmp = new Vector3();
    for (const [seg, s] of this.segments) out.addScaledVector(kin.point(seg, s.com, tmp), s.mass);
    if (this.config.payload > 0) {
      const p = payloadPos ?? kin.palm('L', new Vector3()).add(kin.palm('R', tmp)).multiplyScalar(0.5);
      out.addScaledVector(p, this.config.payload);
    }
    return out.divideScalar(this.totalMass);
  }

  /** Where the payload box sits for the carry posture, relative to the pelvis origin. */
  static payloadCarryOffset(): Vector3 {
    return new Vector3(0, PAYLOAD.carryHeight, PAYLOAD.carryReach);
  }
}

/** Member results for the current materials (for the interface). */
export function memberReport(config: RobotConfig) {
  return (Object.keys(MEMBERS) as MemberKey[]).map((k) => ({ key: k, spec: MEMBERS[k], result: member(k, config.materials[k]) }));
}
