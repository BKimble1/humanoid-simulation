/**
 * Failures and limits: each scenario puts FO-H1 (or its test stand) into a situation just
 * past one of its limits, using the same models as everywhere else, and restores what it
 * changed when the visitor leaves it.
 */
import { useApp, useLab, type LabParams } from '../state/store';
import type { World } from './world';

export type LimitId = 'payload' | 'thermal' | 'battery' | 'torque' | 'contact' | 'reach' | 'grip' | 'current';

export interface LimitInfo {
  id: LimitId;
  title: string;
  /** The limit's name as the robot's diagnostics would report it. */
  code: string;
  what: string;
}

export const LIMITS: LimitInfo[] = [
  { id: 'payload', title: 'Excess payload', code: 'KNEE ACTUATOR LIMIT', what: 'A 30 kg box, 50 % over the rated payload.' },
  { id: 'thermal', title: 'Overheating', code: 'THERMAL DERATING', what: 'Repeated squats with 20 kg, time sped up 40×.' },
  { id: 'battery', title: 'Low battery', code: 'LOW BATTERY', what: 'Fast walking at 8 % charge.' },
  { id: 'torque', title: 'Torque saturation', code: 'TORQUE SATURATION', what: 'An 8:1 reducer asked to lift 20 kg to a straight leg.' },
  { id: 'current', title: 'Excess current', code: 'CURRENT LIMIT', what: 'A fast lift of 20 kg: the move asks for more current than the drive gives.' },
  { id: 'contact', title: 'Loss of contact', code: 'BALANCE LOST', what: 'A 650 N shove: no step can catch it.' },
  { id: 'reach', title: 'Unreachable target', code: 'IK UNREACHABLE', what: 'A point 95 cm in front of the chest.' },
  { id: 'grip', title: 'Insufficient grip', code: 'GRASP SLIP', what: 'A full, wet 2 kg bottle in a pinch grasp.' },
];

interface Saved {
  payload: number;
  lab: Partial<LabParams>;
  soc: number;
}

export class Limits {
  active: LimitId | null = null;
  private saved: Saved | null = null;

  constructor(private w: World) {}

  run(id: LimitId) {
    if (this.active) this.restore();
    const app = useApp.getState();
    const lab = useLab.getState();
    this.saved = {
      payload: app.config.payload,
      lab: { jointTarget: lab.jointTarget, jointSpeed: lab.jointSpeed, jointRatio: lab.jointRatio, jointPayload: lab.jointPayload, jointReducer: lab.jointReducer, balanceTask: lab.balanceTask, ikMode: lab.ikMode, ikSide: lab.ikSide, task: lab.task, gait: lab.gait, walking: lab.walking, carry: lab.carry },
      soc: this.w.energy.pack.soc,
    };
    this.active = id;
    const w = this.w;
    switch (id) {
      case 'payload':
        app.setConfig({ payload: 30 });
        break;
      case 'thermal':
        app.setConfig({ payload: 20 });
        break;
      case 'battery':
        w.energy.pack.soc = 0.08;
        lab.set({ gait: 'fast', walking: true, carry: false });
        break;
      case 'torque':
        lab.set({ jointRatio: 8, jointReducer: 'planetary', jointPayload: 20, jointSpeed: 30, jointTarget: 90 });
        break;
      case 'current':
        lab.set({ jointRatio: 30, jointReducer: 'cycloidal', jointPayload: 20, jointSpeed: 600, jointTarget: 100 });
        break;
      case 'contact':
        lab.set({ balanceTask: 'stand' });
        w.balance.queuePush(650, 'front');
        break;
      case 'reach':
        lab.set({ ikMode: 'ik', ikSide: 'L' });
        w.reach.target.set(0.3, 1.25, 0.95);
        break;
      case 'grip':
        lab.set({ task: 'wet' });
        w.manip.setTask('wet');
        w.manip.reset();
        w.manip.sim.mass = 2.0;
        w.manip.pick();
        break;
    }
    useApp.getState().set({ limit: id });
  }

  /** Scenario-specific follow-ups that need the robot to have got somewhere first. */
  update() {
    if (this.active === 'torque') {
      // from hanging, try to straighten the leg
      const rig = this.w.props.rig.rig;
      const lab = useLab.getState();
      if (lab.jointTarget === 90 && Math.abs(rig.q - Math.PI / 2) < 0.02 && Math.abs(rig.qd) < 0.05) lab.set({ jointTarget: 0 });
    }
    if (this.active === 'current') {
      const rig = this.w.props.rig.rig;
      // once at the bottom, command the fast lift
      const lab = useLab.getState();
      if (lab.jointTarget === 100 && Math.abs(rig.q - (100 * Math.PI) / 180) < 0.02 && Math.abs(rig.qd) < 0.05) lab.set({ jointTarget: 0 });
    }
    if (this.active === 'grip' && this.w.manip.stage === 'rest' && this.w.manip.sim.mass !== 2.0) this.w.manip.sim.mass = 2.0;
  }

  restore() {
    const s = this.saved;
    if (!s) return;
    const app = useApp.getState();
    if (app.config.payload !== s.payload) app.setConfig({ payload: s.payload });
    useLab.getState().set(s.lab);
    this.w.energy.pack.soc = s.soc;
    if (this.active === 'grip') this.w.manip.reset();
    this.saved = null;
    this.active = null;
    useApp.getState().set({ limit: null });
  }
}
