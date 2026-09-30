/**
 * Every place the visitor can be, as data: the camera shot, the scene channels, how the robot
 * stands or moves, and which subsystems are in focus. The world applies a scene by moving
 * towards it from wherever it is (camera and channels are velocity- and value-continuous), so
 * any sequence of clicks transitions cleanly.
 */
import { Vector3 } from 'three';
import type { Shot } from '../scene/camera/director';
import type { ChannelId } from '../scene/seq/channels';
import type { VisualGroup } from '../scene/robot/rig';
import type { IdlePreset } from './sources/idle';
import type { World } from './world';

export type PoseKind = 'idle' | 'walk' | 'balance' | 'reach' | 'manip' | 'exercise';

export interface SceneDef {
  shot: (w: World) => Shot;
  channels: Partial<Record<ChannelId, number>>;
  pose: PoseKind;
  idle?: IdlePreset;
  /** Subsystems kept solid when `isolate` is up; the rest ghost. */
  focus?: VisualGroup[];
  /** Head gaze: 'camera', 'cart', or none. */
  gaze?: 'camera' | 'cart' | 'ahead';
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const ORBIT = { el: [-0.15, 0.95] as [number, number], dist: [0.55, 1.7] as [number, number] };

export const SCENES: Record<string, SceneDef> = {
  intro: {
    shot: () => ({ id: 'intro', target: V(0, 0.98, 0), az: 0.62, el: 0.05, dist: 4.6, fov: 27, ox: -0.2, drift: 0.022, sway: 0.03, orbit: false }),
    channels: { intro: 1 },
    pose: 'idle',
    idle: 'hero',
    gaze: 'camera',
  },
  'explore.overview': {
    shot: () => ({ id: 'explore', target: V(0, 0.95, 0), az: 0.42, el: 0.1, dist: 4.1, fov: 30, ox: 0.12, orbit: ORBIT }),
    channels: { labels: 1 },
    pose: 'idle',
    idle: 'rest',
    gaze: 'camera',
  },
  'explore.structure': {
    shot: () => ({ id: 'structure', target: V(0, 0.98, 0), az: 0.78, el: 0.1, dist: 3.4, fov: 30, ox: 0.12, orbit: ORBIT }),
    channels: { xray: 1, labels: 1, loads: 0 },
    pose: 'idle',
    idle: 'rest',
    focus: ['structure'],
  },
  'explore.actuators': {
    shot: (w) => ({ id: 'actuators', target: () => w.actuatorAnchor(), az: 0.78, el: 0.1, dist: 1.35, fov: 30, ox: 0.1, orbit: { el: [-0.1, 0.8], dist: [0.6, 1.6] } }),
    channels: { xray: 1, isolate: 0.55, labels: 1 },
    pose: 'idle',
    idle: 'clearArms',
    focus: ['actuator'],
  },
  'explore.actuators.open': {
    shot: (w) => ({ id: 'actuatorOpen', target: () => w.assemblyCentre(), az: 0.98, el: 0.2, dist: 1.12, fov: 30, ox: 0.1, orbit: { el: [-0.2, 0.9], dist: [0.55, 1.5] } }),
    channels: { xray: 1, isolate: 1, actuatorOut: 1, explode: 1, labels: 1 },
    pose: 'idle',
    idle: 'clearArms',
    focus: [],
  },
  'explore.hands': {
    shot: (w) => ({ id: 'hands', target: () => w.anchor('palmL').add(V(-0.02, 0.02, 0)), az: 0.95, el: 0.2, dist: 0.7, fov: 30, ox: 0.08, orbit: { el: [-0.1, 0.9], dist: [0.45, 1.6] } }),
    channels: { labels: 1, forces: 0.6 },
    pose: 'idle',
    idle: 'showHand',
    gaze: 'ahead',
  },
  'explore.vision': {
    shot: (w) => ({ id: 'vision', target: () => w.anchor('head').add(V(-0.08, -0.32, 0.42)), az: -2.5, el: 0.28, dist: 1.7, fov: 34, ox: 0.1, orbit: { el: [0, 0.8], dist: [0.7, 1.6] } }),
    channels: { cart: 1, vision: 1, labels: 1 },
    pose: 'idle',
    idle: 'rest',
    gaze: 'cart',
  },
  'explore.balance': {
    shot: (w) => ({ id: 'balanceSys', target: () => w.anchor('imu').add(V(0, -0.05, 0)), az: 0.7, el: 0.14, dist: 2.3, fov: 30, orbit: ORBIT }),
    channels: { balanceViz: 1, xray: 0.6, isolate: 0.3, labels: 1 },
    pose: 'idle',
    idle: 'rest',
    focus: ['sensor', 'structure'],
  },
  'explore.forces': {
    shot: () => ({ id: 'forces', target: V(0, 0.55, 0.05), az: 0.95, el: 0.16, dist: 2.7, fov: 30, orbit: ORBIT }),
    channels: { forces: 1, labels: 1 },
    pose: 'idle',
    idle: 'armsOut',
  },
  'explore.power': {
    shot: (w) => ({ id: 'power', target: () => w.anchor('battery').add(V(0, 0.0, 0.0)), az: 0.42, el: 0.16, dist: 1.35, fov: 30, orbit: { el: [-0.1, 0.8], dist: [0.6, 1.6] } }),
    channels: { chestOpen: 1, batteryOpen: 1, powerFlow: 1, xray: 1, isolate: 0.8, labels: 1 },
    pose: 'idle',
    idle: 'rest',
    focus: ['power'],
  },
  'explore.compute': {
    shot: (w) => ({ id: 'compute', target: () => w.anchor('backpack').add(V(0, -0.08, 0.05)), az: 2.62, el: 0.2, dist: 1.5, fov: 30, orbit: ORBIT }),
    channels: { dataFlow: 1, xray: 1, isolate: 0.75, labels: 1 },
    pose: 'idle',
    idle: 'rest',
    focus: ['compute', 'sensor', 'wiring'],
  },
  'explore.thermal': {
    shot: () => ({ id: 'thermal', target: V(0, 0.9, 0), az: 0.55, el: 0.1, dist: 3.3, fov: 30, orbit: ORBIT }),
    channels: { thermal: 1, labels: 1 },
    pose: 'exercise',
  },
  engineer: {
    shot: () => ({ id: 'engineer', target: V(0, 0.95, 0), az: 0.62, el: 0.12, dist: 3.6, fov: 30, orbit: ORBIT }),
    channels: { loads: 1, balanceViz: 0.8 },
    pose: 'idle',
    idle: 'rest',
  },
  'sim.hub': {
    shot: () => ({ id: 'simHub', target: V(0.2, 0.95, 0), az: 0.5, el: 0.12, dist: 4.4, fov: 30, orbit: ORBIT }),
    channels: {},
    pose: 'idle',
    idle: 'rest',
    gaze: 'camera',
  },
  'sim.joint': {
    shot: (w) => ({ id: 'joint', target: () => w.rigTarget(), az: 0.95, el: 0.18, dist: 2.1, fov: 30, ox: 0.1, orbit: { el: [-0.1, 0.9], dist: [0.8, 2.6] } }),
    channels: { rigLight: 1 },
    pose: 'idle',
    idle: 'rest',
  },
  'sim.kinematics': {
    shot: () => ({ id: 'kin', target: V(0.05, 1.12, 0.22), az: 0.86, el: 0.2, dist: 2.3, fov: 30, orbit: ORBIT }),
    channels: { ik: 1 },
    pose: 'reach',
  },
  'sim.balance': {
    shot: () => ({ id: 'balance', target: V(0, 0.75, 0.05), az: 0.9, el: 0.14, dist: 3.4, fov: 30, orbit: ORBIT }),
    channels: { balanceViz: 1, forces: 1 },
    pose: 'balance',
  },
  'sim.walk': {
    shot: (w) => ({ id: 'walk', target: () => w.walkTarget(), az: 1.3, el: 0.06, dist: 3.7, fov: 30, orbit: ORBIT }),
    channels: { balanceViz: 1, forces: 1 },
    pose: 'walk',
    gaze: 'ahead',
  },
  'sim.manipulation': {
    shot: () => ({ id: 'manip', target: V(-0.12, 1.0, 0.3), az: -1.12, el: 0.2, dist: 2.1, fov: 30, ox: 0.1, orbit: ORBIT }),
    channels: { cart: 1, forces: 0.8 },
    pose: 'manip',
  },
  'sim.wholebody': {
    shot: (w) => ({ id: 'whole', target: () => w.walkTarget().add(V(0, 0.05, 0)), az: 0.75, el: 0.1, dist: 4.1, fov: 30, orbit: ORBIT }),
    channels: { loop: 1, dataFlow: 0.7, balanceViz: 0.8, forces: 0.8, ik: 1 },
    pose: 'walk',
    gaze: 'ahead',
  },
  'sim.limits.payload': {
    shot: () => ({ id: 'limPayload', target: V(0, 0.85, 0.05), az: 0.75, el: 0.1, dist: 3.1, fov: 30, orbit: ORBIT }),
    channels: { loads: 1, balanceViz: 0.7 },
    pose: 'idle',
    idle: 'rest',
  },
  'sim.limits.thermal': {
    shot: () => ({ id: 'limThermal', target: V(0, 0.8, 0), az: 0.55, el: 0.1, dist: 3.2, fov: 30, orbit: ORBIT }),
    channels: { thermal: 1 },
    pose: 'exercise',
  },
  'sim.limits.battery': {
    shot: (w) => ({ id: 'limBattery', target: () => w.walkTarget(), az: 1.2, el: 0.08, dist: 3.8, fov: 30, orbit: ORBIT }),
    channels: { powerFlow: 0.8, xray: 0.35 },
    pose: 'walk',
    gaze: 'ahead',
  },
  'sim.limits.torque': {
    shot: (w) => ({ id: 'limTorque', target: () => w.rigTarget(), az: 0.95, el: 0.18, dist: 2.1, fov: 30, ox: 0.1, orbit: { el: [-0.1, 0.9], dist: [0.8, 2.6] } }),
    channels: { rigLight: 1 },
    pose: 'idle',
    idle: 'rest',
  },
  'sim.limits.current': {
    shot: (w) => ({ id: 'limCurrent', target: () => w.rigTarget(), az: 0.8, el: 0.16, dist: 2.1, fov: 30, ox: 0.1, orbit: { el: [-0.1, 0.9], dist: [0.8, 2.6] } }),
    channels: { rigLight: 1 },
    pose: 'idle',
    idle: 'rest',
  },
  'sim.limits.contact': {
    shot: () => ({ id: 'limContact', target: V(0, 0.75, 0.25), az: 1.25, el: 0.14, dist: 3.8, fov: 30, orbit: ORBIT }),
    channels: { balanceViz: 1, forces: 1 },
    pose: 'balance',
  },
  'sim.limits.reach': {
    shot: () => ({ id: 'limReach', target: V(0.12, 1.12, 0.4), az: 1.05, el: 0.2, dist: 2.5, fov: 30, orbit: ORBIT }),
    channels: { ik: 1 },
    pose: 'reach',
  },
  'sim.limits.grip': {
    shot: () => ({ id: 'limGrip', target: V(-0.18, 1.0, 0.34), az: -1.05, el: 0.2, dist: 2.0, fov: 30, ox: 0.1, orbit: ORBIT }),
    channels: { cart: 1, forces: 0.8 },
    pose: 'manip',
  },
  'sim.limits': {
    shot: () => ({ id: 'limits', target: V(0, 0.9, 0), az: 0.6, el: 0.12, dist: 3.4, fov: 30, orbit: ORBIT }),
    channels: { loads: 1, balanceViz: 0.8 },
    pose: 'idle',
    idle: 'rest',
  },
};
