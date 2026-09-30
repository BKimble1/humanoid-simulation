/**
 * Plays the guided tour on the world's presentation clock. The tour owns the scene while it
 * runs (the app store's mode is 'watch').
 *
 * Every chapter starts from a known baseline — the default design and lab settings, the
 * charge and temperatures the tour started with, nothing held, no push under way — plus the
 * chapter's own changes, so a chapter plays the same whichever way the visitor reached it
 * (in order, jumping back after the 30 kg chapter, restarting it). The robot is never
 * teleported: its pose blends from what is shown, and anything it is in the middle of (a
 * step, an object in the hand) is finished before the chapter's demonstration begins; the
 * chapter's timed actions wait for that. Timed actions fire once per visit.
 *
 * Pause freezes the demonstration (World.presentationPaused). Moving to another chapter
 * while paused sets the chapter up and lets its framing settle, then holds it. Leaving —
 * at the end or at any moment — restores the visitor's design, lab settings, actuator choice,
 * charge and temperatures, and hands the scene back to the interface.
 */
import { DEFAULT_CONFIG, cloneConfig, type RobotConfig } from '../engine/robot';
import type { EnergySnapshot } from '../engine/power';
import { LAB_DEFAULTS, useApp, useLab, type LabParams } from '../state/store';
import { TOUR, type Chapter } from './tour';
import type { World } from './world';

interface Saved {
  lab: LabParams;
  config: RobotConfig;
  actuator: 'knee' | 'hip' | 'elbow';
  energy: EnergySnapshot;
}

/** Time a chapter change made while paused is given to settle its framing, s. */
const SETTLE = 2.4;

export class TourRunner {
  playing = false;
  paused = false;
  index = -1;
  /** Time into the current chapter, s (presentation clock). */
  t = 0;
  /** Chapters entered since the tour started (tests: a visit is set up exactly once). */
  visits = 0;
  private settle = 0;
  private fired = new Set<number>();
  private saved: Saved | null = null;
  private baseline: EnergySnapshot | null = null;

  constructor(private w: World) {}

  get chapters(): readonly Chapter[] {
    return TOUR;
  }

  /** The demonstration is held still (paused, and any chapter change has settled). */
  get holdsPresentation(): boolean {
    return this.playing && this.paused && this.settle <= 0;
  }

  start(from = 0) {
    if (!this.playing) {
      const lab = useLab.getState();
      const app = useApp.getState();
      const { set: _set, ...labParams } = lab;
      void _set;
      this.saved = { lab: { ...labParams }, config: cloneConfig(app.config), actuator: app.actuator, energy: this.w.energy.snapshot() };
      // the tour's own starting point: the charge and temperatures of a rested robot
      const e = this.w.energy.snapshot();
      e.soc = Math.max(e.soc, 0.92);
      this.baseline = e;
      this.visits = 0;
    }
    this.playing = true;
    this.paused = false;
    this.enter(from);
  }

  /** Go to a chapter (from any other, in any state). */
  jump(i: number) {
    if (!this.playing) return;
    this.enter(Math.max(0, Math.min(TOUR.length - 1, i)));
  }

  private enter(i: number) {
    const c: Chapter | undefined = TOUR[i];
    if (!c) return this.finish();
    this.index = i;
    this.t = 0;
    this.fired.clear();
    this.visits++;
    // the baseline, then the chapter's own state
    const app = useApp.getState();
    const config = cloneConfig(DEFAULT_CONFIG);
    if (c.config) Object.assign(config, c.config);
    if (JSON.stringify(config) !== JSON.stringify(app.config)) app.set({ config });
    useApp.setState({ actuator: c.actuator ?? 'knee', part: null });
    useLab.getState().set({ ...LAB_DEFAULTS, ...c.lab });
    this.w.prepareChapter(this.baseline);
    c.start?.(this.w);
    this.w.applyScene(c.scene);
    if (this.paused) this.settle = SETTLE;
    this.publish();
  }

  /** `pdt`: presentation clock (0 while paused); `dt`: real clock. */
  update(pdt: number, dt = pdt) {
    if (!this.playing) return;
    if (this.paused) {
      if (this.settle > 0) this.settle = Math.max(0, this.settle - dt);
      return;
    }
    const c = TOUR[this.index];
    if (!c || pdt <= 0) return;
    this.t += pdt;
    c.at?.forEach((a, k) => {
      if (!this.fired.has(k) && this.t >= a.t) {
        this.fired.add(k);
        this.w.telemetry.mark('tour-action', `${c.id}#${k}`);
        a.run(this.w);
      }
    });
    if (this.t >= c.duration) this.enter(this.index + 1);
    else if (Math.floor(this.t * 4) !== Math.floor((this.t - pdt) * 4)) this.publish();
  }

  next() {
    if (this.playing) this.enter(this.index + 1);
  }
  prev() {
    if (this.playing) this.enter(Math.max(0, this.t > 2 ? this.index : this.index - 1));
  }
  toggle() {
    this.paused = !this.paused;
    this.settle = 0;
    this.publish();
  }

  /** Stop the tour and restore what it changed. `mode`: where the visitor goes next. */
  stop(mode: 'intro' | 'explore' = 'intro') {
    if (!this.playing) return;
    this.playing = false;
    this.paused = false;
    this.settle = 0;
    this.index = -1;
    const s = this.saved;
    if (s) {
      useLab.getState().set(s.lab);
      useApp.getState().set({ config: s.config, actuator: s.actuator, part: null });
      this.w.prepareChapter(s.energy);
    }
    this.saved = null;
    useApp.setState({ tour: null });
    const st = useApp.getState();
    if (st.mode === 'watch') st.go(mode === 'explore' ? { mode: 'explore', system: 'overview' } : { mode: 'intro' });
  }

  private finish() {
    this.stop('explore');
  }

  private publish() {
    useApp.setState({ tour: { index: this.index, t: this.t, paused: this.paused } });
  }
}
