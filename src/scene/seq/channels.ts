/**
 * Scene channels: every animated property of the scene that is not the camera or the robot's
 * pose is a named number (a shell's opacity, how far the chest cover has opened, how exploded
 * the knee actuator is, the thermal view's strength…). A scene state is a set of channel
 * targets; `to(targets)` plans the move from the current values:
 *
 *   - channels that close (go down) move first, highest stage first;
 *   - channels that open (go up) follow, lowest stage first;
 *   - each stage starts when the previous one is mostly done (they overlap a little);
 *   - every channel starts from its current value, so asking for a new state halfway
 *     through a move reverses or redirects it smoothly, whatever the order of clicks.
 *
 * Stages encode the choreography once, for every transition: covers ghost before a cover
 * opens, a cover opens before an actuator slides out, the actuator slides out before it
 * explodes — and closing runs the same order backwards. No timeouts anywhere: the channels
 * advance with the frame clock.
 */

export interface ChannelSpec {
  /** Order of opening (low first); closing runs in reverse. */
  stage: number;
  /** Time for a full 0 → 1 move, s. */
  duration: number;
  initial?: number;
}

export const CHANNELS = {
  /** Covers become an x-ray ghost (0 solid … 1 ghost). */
  xray: { stage: 0, duration: 0.9 },
  /** Everything but the selected subsystem dims (isolation). */
  isolate: { stage: 0, duration: 0.8 },
  /** Chest and abdomen covers swing open (Power). */
  chestOpen: { stage: 1, duration: 1.3 },
  /** Battery front cover lifts away, cells revealed. */
  batteryOpen: { stage: 2, duration: 1.0 },
  /** The selected actuator slides out of the limb along its axis. */
  actuatorOut: { stage: 2, duration: 1.2 },
  /** The actuator's parts separate along the axis. */
  explode: { stage: 3, duration: 1.8 },
  /** Thermal view mix. */
  thermal: { stage: 0, duration: 1.1 },
  /** Engineering overlays fade (vectors, polygons, paths). */
  overlay: { stage: 3, duration: 0.7 },
  /** In-scene labels fade. */
  labels: { stage: 4, duration: 0.5 },
  /** Power-flow animation strength. */
  powerFlow: { stage: 3, duration: 0.8 },
  /** Data-flow (network) animation strength. */
  dataFlow: { stage: 3, duration: 0.8 },
  /** The autonomous cart for manipulation and vision (0 parked off-cell … 1 docked). */
  cart: { stage: 1, duration: 2.6 },
  /** The joint test rig's work light. */
  rigLight: { stage: 0, duration: 1.2 },
  /** Intro title card (the robot is the subject; the title sits over it). */
  intro: { stage: 0, duration: 1.4 },
  /** Vision: the robot's camera view and its overlays. */
  vision: { stage: 3, duration: 0.9 },
  /** Balance overlays (COM, support polygon, capture point). */
  balanceViz: { stage: 3, duration: 0.7 },
  /** Force vectors at feet, wrists and fingertips. */
  forces: { stage: 3, duration: 0.7 },
  /** Joint load rings (torque as a share of the actuator's limit). */
  loads: { stage: 3, duration: 0.7 },
  /** IK target, workspace and kinematic chain. */
  ik: { stage: 3, duration: 0.7 },
  /** Closed-loop diagram for the whole-body view. */
  loop: { stage: 3, duration: 0.8 },
} satisfies Record<string, ChannelSpec>;

export type ChannelId = keyof typeof CHANNELS;

interface Tween {
  from: number;
  /** Speed at the start (per second) and where the braking left the value when it waits. */
  v0: number;
  to: number;
  delay: number;
  dur: number;
  t: number;
}

/** Braking time for a channel that is moving when it has to wait for its stage, s. */
const BRAKE = 0.28;

/**
 * Quintic from p0 (speed v0) to p1 at rest, u ∈ [0, 1], T the duration: position.
 * With v0 = 0 it is the usual smootherstep.
 */
function hermite5(p0: number, v0T: number, p1: number, u: number): number {
  const d = p1 - p0;
  const a3 = 10 * d - 6 * v0T;
  const a4 = -15 * d + 8 * v0T;
  const a5 = 6 * d - 3 * v0T;
  return p0 + v0T * u + a3 * u * u * u + a4 * u * u * u * u + a5 * u * u * u * u * u;
}

export class Channels {
  values = {} as Record<ChannelId, number>;
  /** Rate of change of each channel in the last update (per second). */
  rates = {} as Record<ChannelId, number>;
  private tweens = new Map<ChannelId, Tween>();
  /** Multiplier for all durations (reduced motion shortens them). */
  speed = 1;

  constructor() {
    for (const k of Object.keys(CHANNELS) as ChannelId[]) {
      this.values[k] = (CHANNELS[k] as ChannelSpec).initial ?? 0;
      this.rates[k] = 0;
    }
  }

  get(id: ChannelId): number {
    return this.values[id];
  }

  /** True while any channel is moving. */
  get busy(): boolean {
    return this.tweens.size > 0;
  }

  /** Where a channel is heading (its value if it is not moving). */
  target(id: ChannelId): number {
    return this.tweens.get(id)?.to ?? this.values[id];
  }

  /** Move to a scene state. Channels not mentioned return to 0 unless `keep` lists them. */
  to(targets: Partial<Record<ChannelId, number>>, opts: { keep?: ChannelId[]; overlap?: number } = {}) {
    const full = {} as Record<ChannelId, number>;
    for (const k of Object.keys(CHANNELS) as ChannelId[]) {
      if (k in targets) full[k] = targets[k]!;
      else if (opts.keep?.includes(k)) full[k] = this.target(k);
      else full[k] = 0;
    }
    this.plan(full, opts.overlap ?? 0.72);
  }

  /** Move only the channels named (the others carry on as they are); `pace` scales durations. */
  toSome(targets: Partial<Record<ChannelId, number>>, overlap = 0.72, pace = 1) {
    this.plan(targets as Record<ChannelId, number>, overlap, pace);
  }

  private plan(full: Partial<Record<ChannelId, number>>, overlap: number, pace = 1) {
    const closing: ChannelId[] = [];
    const opening: ChannelId[] = [];
    for (const k of Object.keys(full) as ChannelId[]) {
      const cur = this.values[k];
      const want = full[k]!;
      if (Math.abs(want - cur) < 1e-4 && Math.abs(this.rates[k]) < 1e-3) {
        this.tweens.delete(k);
        this.values[k] = want;
        this.rates[k] = 0;
        continue;
      }
      // asked again for where it is already heading: let the move run on (no restart)
      const tw = this.tweens.get(k);
      if (tw && Math.abs(tw.to - want) < 1e-4) continue;
      (want < cur ? closing : opening).push(k);
    }
    let t = 0;
    const plan = (ids: ChannelId[], order: 1 | -1) => {
      const stages = [...new Set(ids.map((k) => CHANNELS[k].stage))].sort((a, b) => (a - b) * order);
      for (const st of stages) {
        let longest = 0;
        for (const k of ids.filter((i) => CHANNELS[i].stage === st)) {
          const want = full[k]!;
          const d = Math.abs(want - this.values[k]);
          const dur = Math.max(0.25, CHANNELS[k].duration * Math.sqrt(d)) * this.speed * pace;
          this.tweens.set(k, { from: this.values[k], v0: this.rates[k], to: want, delay: t, dur, t: 0 });
          longest = Math.max(longest, dur);
        }
        t += longest * overlap;
      }
    };
    plan(closing, -1);
    plan(opening, 1);
  }

  /** Set a channel immediately (no animation). */
  set(id: ChannelId, v: number) {
    this.tweens.delete(id);
    this.values[id] = v;
    this.rates[id] = 0;
  }

  update(dt: number) {
    if (dt <= 0) return;
    for (const k of Object.keys(this.rates) as ChannelId[]) if (!this.tweens.has(k)) this.rates[k] = 0;
    for (const [k, tw] of this.tweens) {
      const before = this.values[k];
      tw.t += dt;
      let v: number;
      if (tw.t < tw.delay) {
        // waiting for its stage: a moving channel brakes to a stop, a still one holds
        const tb = Math.min(BRAKE, tw.delay);
        const x = Math.min(tw.t, tb);
        v = tw.from + tw.v0 * (x - (x * x) / (2 * tb));
      } else {
        // the move starts from where the braking left it (at rest) or, without a wait, from
        // the current value and speed
        const waited = tw.delay > 0;
        const tb = Math.min(BRAKE, tw.delay);
        const start = waited ? tw.from + (tw.v0 * tb) / 2 : tw.from;
        const v0T = waited ? 0 : tw.v0 * tw.dur;
        const u = Math.min(1, (tw.t - tw.delay) / tw.dur);
        v = hermite5(start, v0T, tw.to, u);
        if (u >= 1) this.tweens.delete(k);
      }
      this.values[k] = Math.min(1, Math.max(0, v));
      this.rates[k] = (this.values[k] - before) / dt;
    }
  }
}
