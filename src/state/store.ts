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
  /** Phones: the panel sheet is collapsed to its title. */
  sheetMin: boolean;
  sound: boolean;
  info: boolean;
  /** Loading: 0 … 1, and whether the world is ready. */
  progress: number;
  ready: boolean;
  /** Failures and limits: the scenario running (set by the world). */
  limit: import('../world/limits').LimitId | null;
  /** Guided tour position (set by the world while it plays). */
  tour: { index: number; t: number; paused: boolean } | null;
  /** Readouts published by the world (numbers for the panels), ~10 Hz. */
  readouts: Record<string, number | string | boolean>;
  go: (p: Partial<Pick<AppState, 'mode' | 'system' | 'lab' | 'actuator' | 'exploded' | 'part'>>) => void;
  setConfig: (c: Partial<RobotConfig> | ((c: RobotConfig) => RobotConfig)) => void;
  resetConfig: () => void;
  set: (p: Partial<AppState>) => void;
}

const MODES: Mode[] = ['intro', 'explore', 'engineer', 'simulate', 'watch'];
const SYSTEM_IDS: SystemId[] = ['overview', 'structure', 'actuators', 'hands', 'vision', 'balance', 'forces', 'power', 'compute', 'thermal'];
const LAB_IDS: LabId[] = ['hub', 'joint', 'kinematics', 'balance', 'walk', 'manipulation', 'wholebody', 'limits'];

/** A place to start from the address (?mode=simulate&lab=walk): links from FAB / ONE and tests. */
function fromUrl(): Partial<AppState> {
  if (typeof window === 'undefined') return {};
  const q = new URLSearchParams(window.location.search);
  const out: Partial<AppState> = {};
  const m = q.get('mode') as Mode | null;
  if (m && MODES.includes(m) && m !== 'watch') out.mode = m;
  const sys = q.get('system') as SystemId | null;
  if (sys && SYSTEM_IDS.includes(sys)) (out.system = sys), (out.mode ??= 'explore');
  const lab = q.get('lab') as LabId | null;
  if (lab && LAB_IDS.includes(lab)) (out.lab = lab), (out.mode ??= 'simulate');
  return out;
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
  sheetMin: false,
  sound: false,
  info: false,
  progress: 0,
  ready: false,
  readouts: {},
  limit: null,
  tour: null,
  go: (p) => set({ ...(p.system && p.system !== get().system ? { exploded: false, part: null } : {}), ...p }),
  setConfig: (c) => set({ config: typeof c === 'function' ? c(cloneConfig(get().config)) : { ...get().config, ...c } }),
  resetConfig: () => set({ config: cloneConfig(DEFAULT_CONFIG) }),
  set: (p) => set(p),
  ...fromUrl(),
}));

/**
 * The address follows where the visitor is (?mode=explore&system=power, ?mode=simulate&lab=walk),
 * so a refresh or a shared link returns there. Replaced, not pushed: Back leaves the simulation,
 * as it does for a single page. Test and quality options in the address are kept.
 */
export function syncAddress() {
  if (typeof window === 'undefined') return () => {};
  const write = (s: AppState) => {
    const q = new URLSearchParams(window.location.search);
    for (const k of ['mode', 'system', 'lab']) q.delete(k);
    if (s.mode === 'explore') (q.set('mode', 'explore'), q.set('system', s.system));
    else if (s.mode === 'simulate') (q.set('mode', 'simulate'), q.set('lab', s.lab));
    else if (s.mode === 'engineer') q.set('mode', 'engineer');
    const qs = q.toString();
    const url = `${window.location.pathname}${qs ? '?' + qs : ''}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', url);
  };
  // a link that implies a place (?system=power) is written out in full (?mode=explore&system=power)
  write(useApp.getState());
  return useApp.subscribe((s, prev) => {
    if (s.mode !== prev.mode || s.system !== prev.system || s.lab !== prev.lab) write(s);
  });
}

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
  task: 'box' | 'vial' | 'tool' | 'cup' | 'wet' | 'shelf';
  // whole-body view
  wholeMotion: 'walk' | 'balance' | 'reach';
}

/** The labs' settings as a first visit finds them. */
export const LAB_DEFAULTS: Readonly<LabParams> = {
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
};

export const useLab = create<LabParams & { set: (p: Partial<LabParams>) => void }>((set) => ({
  ...LAB_DEFAULTS,
  set: (p) => set(p),
}));

