/**
 * Which callouts each scene shows. Short names; a number only when it says something. Values
 * are read from the specification and the live models, never typed in.
 */
import { Vector3 } from 'three';
import { ANKLE_LINEAR } from '../spec/actuators';
import { MEMBERS } from '../spec/materials';
import { HAND, JOINTS } from '../spec/body';
import { CELL } from '../spec/power';
import { FORCE_TORQUE, HEAD_CAMERAS, IMU, TACTILE } from '../spec/sensing';
import { useApp } from '../state/store';
import type { World } from './world';

export interface LabelDef {
  id: string;
  title: string;
  value?: (w: World) => string;
  at: (w: World, out: Vector3) => Vector3;
  /** Force a side (−1 left, 1 right); default: the side of the robot the anchor is on. */
  side?: number;
  dx?: number;
  dy?: number;
  /** Shown on small screens too. */
  key?: boolean;
}

const A = (name: string) => (w: World, out: Vector3) => out.copy(w.anchor(name));
const f0 = (v: number) => v.toFixed(0);

function L(id: string, title: string, anchor: string | ((w: World, out: Vector3) => Vector3), extra: Partial<LabelDef> = {}): LabelDef {
  return { id, title, at: typeof anchor === 'string' ? A(anchor) : anchor, ...extra };
}

const kneeJ = JOINTS.findIndex((j) => j.id === 'L_knee');

export function labelsFor(w: World): LabelDef[] {
  const s = useApp.getState();
  const pack = w.model.pack;
  switch (w.sceneId) {
    case 'explore.overview':
      return [
        L('cameras', 'Stereo cameras', 'cameras', { value: () => `${HEAD_CAMERAS.stereo.baseline * 1000} mm baseline`, key: true }),
        L('battery', 'Battery', 'battery', { value: () => `${(pack.energyWh / 1000).toFixed(2)} kWh`, key: true }),
        L('hip', 'Hip actuators', 'hipPitchActR', { value: () => `${f0(w.model.actuatorRatings[JOINTS.findIndex((j) => j.id === 'R_hip_pitch')]!.peakTorque)} Nm peak` }),
        L('knee', 'Knee actuator', 'kneeActL', { value: () => 'drives the knee by a push rod', key: true }),
        L('ankle', 'Ankle: two linear actuators', 'ankleActL'),
        L('hand', 'Hand', 'palmR', { value: () => `${HAND.joints} joints · ${HAND.actuated} motors` }),
      ];
    case 'explore.structure':
      return [
        L('pelvis', 'Pelvis frame', 'pelvis', { value: () => 'machined 7075 aluminium' }),
        L('torso', 'Torso frame', 'torso', { value: () => 'carries battery and computers' }),
        L('thigh', 'Thigh tube', (w, o) => o.copy(w.anchor('hipL')).lerp(w.anchor('kneeL'), 0.55), { value: () => `Ø${MEMBERS.legMember.outerD * 1000} mm · ${memberSf(w, 'legMember')}`, key: true }),
        L('rod', 'Knee push rod', 'kneeRodL'),
        L('forearm', 'Forearm', (w, o) => o.copy(w.anchor('elbowR')).lerp(w.anchor('wristR'), 0.5), { value: () => memberSf(w, 'armMember') }),
      ];
    case 'explore.actuators':
      return [
        L('knee', 'Knee · A100', 'kneeActL', { value: () => `${f0(w.model.actuatorRatings[kneeJ]!.peakTorque)} Nm peak`, key: true }),
        L('hipP', 'Hip pitch · A100', 'hipPitchActL'),
        L('hipR', 'Hip roll · A100', 'hipRollActL'),
        L('elbow', 'Elbow · A80', 'elbowActL', { value: () => `${f0(w.model.actuatorRatings[JOINTS.findIndex((j) => j.id === 'L_elbow')]!.peakTorque)} Nm peak` }),
        L('ankle', 'Ankle linear pair', 'ankleActL', { value: () => `ball screw, ${ANKLE_LINEAR.lead * 1000} mm lead` }),
      ];
    case 'explore.actuators.open': {
      const a = w.assemblies[s.actuator];
      const p = a?.asm.parts.find((x) => x.id === s.part);
      if (!a || !p) return [];
      return [
        L(`part-${p.id}`, p.label, (_w, o) => o.set(...p.anchor).applyMatrix4(p.group.matrixWorld), { key: true, dx: 70, dy: -40 }),
      ];
    }
    case 'explore.hands':
      return [
        L('tips', 'Fingertip tactile skin', 'fingertipL', { value: () => `${TACTILE.fingertipTaxels} taxels · normal + shear`, key: true }),
        L('wristFT', 'Wrist force/torque sensor', 'ftWristL', { value: () => `±${FORCE_TORQUE.wrist.fz} N` }),
        L('palm', 'Finger motors in the palm', 'palmL', { value: () => `${HAND.actuated} per hand` }),
      ];
    case 'explore.vision':
      return [
        L('stereo', 'Stereo pair', 'cameras', { value: () => `${HEAD_CAMERAS.stereo.width}×${HEAD_CAMERAS.stereo.height} · ${HEAD_CAMERAS.stereo.rateHz} Hz`, key: true }),
        L('chest', 'Chest depth camera', 'chestCam', { value: () => 'looks at the ground ahead' }),
      ];
    case 'explore.balance':
      return [
        L('imu', 'IMU', 'imu', { value: () => `${IMU.rateHz} Hz · next to the COM`, key: true }),
        L('com', 'Centre of mass', (w, o) => o.copy(w.body.com), { value: (w) => `${(w.body.com.y * 100).toFixed(0)} cm high`, dx: 80 }),
        L('support', 'Support polygon', (w, o) => o.set(w.body.com.x, 0.004, w.body.com.z + 0.13), { value: (w) => `margin ${(w.body.margin * 1000).toFixed(0)} mm`, dx: 90 }),
      ];
    case 'explore.forces':
      return [
        L('ftL', 'Ankle force/torque sensor', 'ftL', { value: (w) => `${f0(w.body.grf?.L.force.length() ?? 0)} N`, key: true }),
        L('ftR', 'Ankle force/torque sensor', 'ftR', { value: (w) => `${f0(w.body.grf?.R.force.length() ?? 0)} N` }),
        L('wrist', 'Wrist force/torque sensor', 'ftWristL'),
      ];
    case 'explore.power':
      return [
        L('cells', `${pack.series}S${pack.parallel}P cells`, 'cells', { value: () => `${pack.cells} × ${CELL.capacityAh} Ah`, key: true }),
        L('bms', 'Battery management', 'bms', { value: (w) => `${w.energy.summary.batteryVoltage.toFixed(1)} V` }),
        L('contactors', 'Contactors and fuse', 'contactors'),
        L('dcdc', `DC/DC ${pack.nominalV.toFixed(0)} → 24 / 12 V`, 'dcdc', { value: (w) => `${f0(w.energy.summary.lv)} W` }),
      ];
    case 'explore.compute':
      return [
        L('pc', 'Perception computer', 'perceptionPC', { value: () => '10–30 Hz', key: true }),
        L('rt', 'Real-time controller', 'rtController', { value: () => '1 kHz' }),
        L('safety', 'Safety controller', 'safety', { value: () => 'hard-wired STO' }),
        L('ecat', 'EtherCAT hub', 'ethercat', { value: () => '4 segments' }),
      ];
    case 'explore.thermal': {
      const hot = w.energy.hottest();
      if (hot.joint < 0) return [];
      return [L('hot', 'Hottest winding', (w, o) => o.copy(w.kin.jointPos[w.energy.hottest().joint]), { value: (w) => `${JOINTS[w.energy.hottest().joint].label} · ${w.energy.hottest().Tw.toFixed(0)} °C`, key: true })];
    }
    default:
      return [];
  }
}

function memberSf(w: World, key: 'legMember' | 'armMember'): string {
  const r = w.designMembers().find((m) => m.key === key);
  return r ? `safety factor ${r.result.safetyFactor.toFixed(1)}` : '';
}
