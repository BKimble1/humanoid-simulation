/**
 * Whole-system checks: the design analysis against the rated payload, the walking duty cycle
 * through the actuator model, the grasp controller catching a slip, and a walk that starts and
 * stops without torque spikes.
 */
import { describe, expect, it } from 'vitest';
import { ACTUATORS } from '../spec/actuators';
import { GAITS, PAYLOAD } from '../spec/motion';
import { operate } from './actuator';
import { analyzeDesign } from './design';
import { recordStride, sampleStride } from './dutyCycle';
import { GRIP, GraspSim, OBJECTS } from './grasp';
import { DEFAULT_CONFIG, RobotModel } from './robot';
import { JOINT_INDEX } from './skeleton';

describe('design analysis', () => {
  it('the rated payload is within every limit; 30 kg is not', () => {
    const rated = analyzeDesign({ ...DEFAULT_CONFIG, payload: PAYLOAD.rated });
    expect(rated.findings.filter((f) => f.severity === 'limit')).toEqual([]);
    const over = analyzeDesign({ ...DEFAULT_CONFIG, payload: PAYLOAD.max });
    expect(over.findings.filter((f) => f.severity === 'limit').length).toBeGreaterThan(1);
  });
  it('walking costs what electric humanoids cost', () => {
    const r = analyzeDesign(DEFAULT_CONFIG);
    expect(r.walk.costOfTransport).toBeGreaterThan(0.35);
    expect(r.walk.costOfTransport).toBeLessThan(1.5);
    expect(r.runtime.walking).toBeGreaterThan(2);
    expect(r.runtime.standing).toBeGreaterThan(r.runtime.walking);
    expect(r.comHeightFraction).toBeGreaterThan(0.53);
    expect(r.comHeightFraction).toBeLessThan(0.6);
  });
  it('a smaller motor stack trips the knee', () => {
    const r = analyzeDesign({ ...DEFAULT_CONFIG, payload: 20, legActuator: { ...DEFAULT_CONFIG.legActuator, stackScale: 0.6 } });
    expect(r.findings.some((f) => f.severity === 'limit')).toBe(true);
  });
});

describe('walking duty cycle through the knee actuator', () => {
  const model = new RobotModel();
  const cycle = recordStride(model, GAITS.normal);
  const k = JOINT_INDEX.L_knee;
  it('one stride, periodic', () => {
    expect(cycle.n * cycle.dt).toBeCloseTo(2 * GAITS.normal.stepTime, 5);
    const a = sampleStride(cycle, k, 0);
    const b = sampleStride(cycle, k, cycle.n * cycle.dt);
    expect(b.tau).toBeCloseTo(a.tau, 6);
  });
  it('motor speed is output speed times the ratio; torque stays within the peak', () => {
    const cfg = model.actuators[k]!;
    let peak = 0;
    for (let i = 0; i < cycle.n; i++) {
      const s = sampleStride(cycle, k, i * cycle.dt);
      const op = operate(cfg, s.tau, s.qd, 60);
      expect(op.omegaMotor).toBeCloseTo(s.qd * cfg.ratio, 6);
      peak = Math.max(peak, Math.abs(s.tau));
    }
    expect(peak).toBeGreaterThan(40);
    expect(peak).toBeLessThan(ACTUATORS.A100.peakCurrent * cfg.motor.kt * cfg.ratio);
  });
});

describe('grasp', () => {
  function lift(obj: typeof OBJECTS.box, mass = obj.mass) {
    const g = new GraspSim({ ...obj, mass });
    g.support = 0;
    g.close();
    for (let t = 0; t < 1; t += 0.01) g.step(0.01);
    // the weight transfers over 0.55 s as the hand rises
    for (let t = 0; t < 3; t += 0.01) {
      g.support = Math.min(1, t / 0.55);
      g.step(0.01);
    }
    return g;
  }
  it('a wet bottle slips, the slip is detected and the grip holds it', () => {
    const g = lift(OBJECTS.wet);
    expect(g.detections).toBeGreaterThan(0);
    expect(g.phase).toBe('holding');
    expect(g.slip).toBeLessThan(0.03);
    expect(g.normal).toBeGreaterThan(g.minimumNormal);
  });
  it('a full 2 kg wet bottle needs more grip than the fingers have, and is dropped', () => {
    const g = lift(OBJECTS.wet, 2);
    expect(g.holdingNormal).toBeGreaterThan(GRIP.maxNormal);
    expect(g.phase).toBe('dropped');
  });
  it('a glass vial is never squeezed near its crush force', () => {
    const g = lift(OBJECTS.vial);
    expect(g.phase).toBe('holding');
    expect(g.crushed).toBe(false);
    expect(g.normal).toBeLessThan(OBJECTS.vial.crush * 0.8 + 1e-9);
  });
});

describe('walking from standing and back', () => {
  it('starting and stopping never ask the knees for more than a steady stride does (+40 %)', async () => {
    const { GaitGenerator } = await import('./gait');
    const { MotionDynamics } = await import('./motionDynamics');
    const { Kinematics, Pose } = await import('./skeleton');
    const { poseFromGait } = await import('./wholebody');
    const { footPolygon } = await import('./balance');
    const { LOCOMOTION } = await import('../spec/motion');
    const model = new RobotModel();
    const gen = new GaitGenerator(undefined, LOCOMOTION.comHeight - 0.015);
    const kin = new Kinematics();
    const md = new MotionDynamics(model);
    const pose = new Pose();
    const k = [JOINT_INDEX.L_knee, JOINT_INDEX.R_knee];
    const peaks = { start: 0, steady: 0, stop: 0 };
    gen.walk(GAITS.normal);
    for (let i = 0; i < 900; i++) {
      if (i === 500) gen.stop();
      gen.tick();
      const f = gen.frame;
      const res = poseFromGait(model, kin, pose, f);
      const contacts = (['L', 'R'] as const).map((s) => ({ side: s, ankle: f.feet[s].ankle.clone(), polygon: f.feet[s].contact === 'air' ? [] : footPolygon(f.feet[s].step.x, f.feet[s].step.z, f.feet[s].step.yaw) }));
      const r = md.update(res.pose, gen.dt, contacts, null);
      if (i < 3) continue;
      const t = Math.max(...k.map((j) => Math.abs(r.tau[j])));
      if (i < 250) peaks.start = Math.max(peaks.start, t);
      else if (i < 500) peaks.steady = Math.max(peaks.steady, t);
      else peaks.stop = Math.max(peaks.stop, t);
    }
    expect(peaks.steady).toBeGreaterThan(60);
    expect(peaks.start).toBeLessThan(peaks.steady * 1.4);
    expect(peaks.stop).toBeLessThan(peaks.steady * 1.4);
  });
});
