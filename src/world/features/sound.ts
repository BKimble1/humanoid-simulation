/**
 * Sound (off until the visitor turns it on): a quiet room tone for the lab, and the actuators'
 * sound — the whine of the motors' PWM and gear mesh, whose pitch follows the fastest motor
 * and whose level follows the electrical power the joints draw. Synthesised with Web Audio,
 * nothing downloaded. The pitch and level are driven by the simulation; the timbre is a
 * visual-style approximation of what such a machine sounds like.
 */
import { useApp } from '../../state/store';
import type { Feature, World } from '../world';

export class Sound implements Feature {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private motor: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private room: GainNode | null = null;
  private on = false;
  private level = 0;

  private start() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;
    // room tone: brown noise, low-passed
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const room = ctx.createGain();
    room.gain.value = 0.05;
    noise.connect(lp).connect(room).connect(master);
    noise.start();
    this.room = room;
    // motors: two detuned partials through a band-pass (PWM and gear mesh)
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(master);
    osc.start();
    osc2.start();
    this.motor = { osc, osc2, gain, filter };
  }

  update(w: World, dt: number) {
    const want = useApp.getState().sound;
    if (want && !this.ctx) this.start();
    if (!this.ctx || !this.master || !this.motor) return;
    if (want !== this.on) {
      this.on = want;
      if (want) void this.ctx.resume();
      this.master.gain.setTargetAtTime(want ? 0.9 : 0, this.ctx.currentTime, 0.25);
    }
    if (!want) return;
    // the fastest motor sets the pitch; the joints' electrical power sets the level
    let wMax = 0;
    for (const j of w.energy.joints) if (j.op) wMax = Math.max(wMax, Math.abs(j.op.omegaMotor));
    const rig = w.props.rig.rig;
    if (w.sceneId.startsWith('sim.joint') || w.sceneId.startsWith('sim.limits.t') || w.sceneId.startsWith('sim.limits.c')) wMax = Math.max(wMax, Math.abs(rig.qd * rig.act.ratio));
    const opened = w.actuatorLive.op && (w.ch.get('explode') > 0.5 || w.ch.get('actuatorOut') > 0.5) ? Math.abs(w.actuatorLive.op.omegaMotor) / 8 : 0;
    wMax = Math.max(wMax, opened);
    const p = Math.max(0, w.energy.summary.jointsElec);
    const target = Math.min(1, p / 600 + wMax / 900);
    this.level += (target - this.level) * Math.min(1, dt * 6);
    const t = this.ctx.currentTime;
    const f = 70 + wMax * 0.9;
    this.motor.osc.frequency.setTargetAtTime(f, t, 0.05);
    this.motor.osc2.frequency.setTargetAtTime(f * 3.01, t, 0.05);
    this.motor.filter.frequency.setTargetAtTime(400 + f * 2, t, 0.05);
    this.motor.gain.gain.setTargetAtTime(0.06 * this.level, t, 0.08);
    this.room?.gain.setTargetAtTime(0.045, t, 0.5);
  }

  dispose() {
    void this.ctx?.close();
  }
}
