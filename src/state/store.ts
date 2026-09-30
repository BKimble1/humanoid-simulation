/**
 * Application state: where the visitor is and what they have set. The 3D world subscribes to
 * it and reacts; it never holds per-frame values (those stay in the world and reach the
 * interface through `readouts`, published about ten times a second).
 */
import { create } from 'zustand';
import { DEFAULT_CONFIG, cloneConfig, type RobotConfig } from '../engine/robot';

export type Mode = 'intro' | 'explore' | 'engineer' | 'simulate' | 'watch';

export type SystemId = 'overview' | 'structure' | 'actuators' | 'hands' | 'vision' | 'balance' | 'forces' | 'power' | 'compute' | 'thermal';

export type LabId = 'hub' | 'joint' | 'kinematics' | 'balance' | 'walk' | 'manipulation' | 'wholebody' | 'limits';

export type ActuatorView = 'knee' | 'hip' | 'elbow';

export interface AppState {
  mode: Mode;
  system: SystemId;
  /** Explore → Actuators: which one, and whether it is opened up. */
  actuator: ActuatorView;
  exploded: boolean;
  /** Selected part inside an exploded actuator. */
  part: string | null;
  lab: LabId;
  /** Engineer mode's configuration (applied to the robot everywhere). */
  config: RobotConfig;
  engineerTab: 'actuator' | 'geometry' | 'battery' | 'materials' | 'payload';
  overlays: boolean;
  sound: boolean;
  info: boolean;
  /** Loading: 0 … 1, and whether the world is ready. */
  progress: number;
  ready: boolean;
  /** Readouts published by the world (numbers for the panels), ~10 Hz. */
  readouts: Record<string, number | string | boolean>;
  go: (p: Partial<Pick<AppState, 'mode' | 'system' | 'lab' | 'actuator' | 'exploded' | 'part'>>) => void;
  setConfig: (c: Partial<RobotConfig> | ((c: RobotConfig) => RobotConfig)) => void;
  resetConfig: () => void;
  set: (p: Partial<AppState>) => void;
}

export const useApp = create<AppState>((set, get) => ({
  mode: 'intro',
  system: 'overview',
  actuator: 'knee',
  exploded: false,
  part: null,
  lab: 'hub',
  config: cloneConfig(DEFAULT_CONFIG),
  engineerTab: 'actuator',
  overlays: true,
  sound: false,
  info: false,
  progress: 0,
  ready: false,
  readouts: {},
  go: (p) => set({ ...(p.system && p.system !== get().system ? { exploded: false, part: null } : {}), ...p }),
  setConfig: (c) => set({ config: typeof c === 'function' ? c(cloneConfig(get().config)) : { ...get().config, ...c } }),
  resetConfig: () => set({ config: cloneConfig(DEFAULT_CONFIG) }),
  set: (p) => set(p),
}));

/** Lab parameters, kept apart so dragging a slider re-renders only its panel. */
export interface LabParams {
  // joint lab
  jointTarget: number;
  jointSpeed: number;
  jointRatio: number;
  jointPayload: number;
  jointReducer: 'planetary' | 'cycloidal' | 'harmonic';
  // walking
  gait: 'slow' | 'normal' | 'fast';
  walking: boolean;
  carry: boolean;
  // balance
  balanceTask: 'stand' | 'squat' | 'lean' | 'shift' | 'oneFoot' | 'lift';
  pushForce: number;
  pushDir: 'front' | 'back' | 'left' | 'right';
  // kinematics
  ikMode: 'ik' | 'fk';
  ikSide: 'L' | 'R';
  showWorkspace: boolean;
  // manipulation
  task: 'box' | 'vial' | 'tool' | 'cup' | 'shelf';
  // whole-body view
  wholeMotion: 'walk' | 'balance' | 'reach';
}

export const useLab = create<LabParams & { set: (p: Partial<LabParams>) => void }>((set) => ({
  jointTarget: 20,
  jointSpeed: 180,
  jointRatio: 30,
  jointPayload: 5,
  jointReducer: 'cycloidal',
  gait: 'normal',
  walking: false,
  carry: false,
  balanceTask: 'stand',
  pushForce: 220,
  pushDir: 'front',
  ikMode: 'ik',
  ikSide: 'L',
  showWorkspace: true,
  task: 'box',
  wholeMotion: 'walk',
  set: (p) => set(p),
}));
