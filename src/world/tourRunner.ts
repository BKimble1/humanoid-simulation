/**
 * Plays the guided tour on the world's clock. The tour owns the scene while it runs (the app
 * store's mode is 'watch'); leaving it — at the end or at any moment — restores whatever it
 * changed and hands the scene back to the interface.
 */
import { cloneConfig, type RobotConfig } from '../engine/robot';
import { useApp, useLab, type LabParams } from '../state/store';
import { TOUR, type Chapter } from './tour';
import type { World } from './world';

export class TourRunner {
  playing = false;
  paused = false;
  index = -1;
  /** Time into the current chapter, s. */
  t = 0;
  private fired = new Set<number>();
  private savedLab: Partial<LabParams> | null = null;
  private savedConfig: RobotConfig | null = null;

  constructor(private w: World) {}

  start(from = 0) {
    const lab = useLab.getState();
    if (!this.playing) {
      this.savedLab = { task: lab.task, balanceTask: lab.balanceTask, gait: lab.gait, walking: lab.walking, carry: lab.carry };
      this.savedConfig = cloneConfig(useApp.getState().config);
    }
    this.playing = true;
    this.paused = false;
    this.enter(from);
  }

  private enter(i: number) {
    const c: Chapter | undefined = TOUR[i];
    if (!c) return this.finish();
    this.index = i;
    this.t = 0;
    this.fired.clear();
    if (c.lab) useLab.getState().set(c.lab);
    if (c.actuator) useApp.setState({ actuator: c.actuator });
    c.start?.(this.w);
    this.w.applyScene(c.scene);
    this.publish();
  }

  update(dt: number) {
    if (!this.playing || this.paused) return;
    const c = TOUR[this.index];
    if (!c) return;
    this.t += dt;
    c.at?.forEach((a, k) => {
      if (!this.fired.has(k) && this.t >= a.t) {
        this.fired.add(k);
        a.run(this.w);
      }
    });
    if (this.t >= c.duration) this.enter(this.index + 1);
    else if (Math.floor(this.t * 4) !== Math.floor((this.t - dt) * 4)) this.publish();
  }

  /** Change the design for a chapter (null: back to what the visitor had). */
  setConfig(p: Partial<RobotConfig> | null) {
    if (p === null) {
      if (this.savedConfig) useApp.getState().set({ config: cloneConfig(this.savedConfig) });
    } else useApp.getState().setConfig(p);
  }

  next() {
    if (this.playing) this.enter(this.index + 1);
  }
  prev() {
    if (this.playing) this.enter(Math.max(0, this.t > 2 ? this.index : this.index - 1));
  }
  toggle() {
    this.paused = !this.paused;
    this.publish();
  }

  /** Stop the tour and restore what it changed. `mode`: where the visitor goes next. */
  stop(mode: 'intro' | 'explore' = 'intro') {
    if (!this.playing) return;
    this.playing = false;
    this.index = -1;
    if (this.savedLab) useLab.getState().set(this.savedLab);
    if (this.savedConfig) useApp.getState().set({ config: this.savedConfig });
    this.savedLab = null;
    this.savedConfig = null;
    useApp.setState({ tour: null });
    const s = useApp.getState();
    if (s.mode === 'watch') s.go(mode === 'explore' ? { mode: 'explore', system: 'overview' } : { mode: 'intro' });
  }

  private finish() {
    this.stop('explore');
  }

  private publish() {
    useApp.setState({ tour: { index: this.index, t: this.t, paused: this.paused } });
  }
}
