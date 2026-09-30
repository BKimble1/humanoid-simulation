import { describe, expect, it } from 'vitest';
import { FINGER_ACTUATOR } from '../spec/actuators';
import { GRIP, GraspSim, OBJECTS, fingertipForce } from './grasp';
import { DEFAULT_RIG, JointRig } from './jointLab';
import { ImuSim, stereoDepth } from './sensing';

const DEG = Math.PI / 180;

describe('joint test rig', () => {
  it('moves the knee to a commanded angle and holds it', () => {
    const rig = new JointRig({ ...DEFAULT_RIG, payload: 5 });
    rig.step(0.5);
    rig.moveTo(20);
    for (let i = 0; i < 300; i++) rig.step(0.01);
    expect(Math.abs(rig.q / DEG - 20)).toBeLessThan(0.5);
    expect(Math.abs(rig.qd)).toBeLessThan(0.02);
    // holding against gravity: output torque = −gravity torque
    expect(rig.tauOut).toBeCloseTo(-rig.gravity(rig.q), 3);
  });

  it('draws more current for a heavier payload, as τ = Kt·I·N·η predicts', () => {
    const light = new JointRig({ ...DEFAULT_RIG, payload: 0 });
    const heavy = new JointRig({ ...DEFAULT_RIG, payload: 10 });
    for (const r of [light, heavy]) {
      r.moveTo(0);
      for (let i = 0; i < 400; i++) r.step(0.01);
    }
    expect(Math.abs(heavy.current)).toBeGreaterThan(Math.abs(light.current) * 2);
    // at rest the reducer's stiction lets the holding current sit anywhere between the
    // forward-driven and back-driven values: τ/(N·η·Kt) at most, τ·η_b/(N·Kt) at least
    const tau = Math.abs(heavy.gravity(heavy.q));
    const a = heavy.act;
    expect(Math.abs(heavy.current)).toBeLessThanOrEqual((tau / (a.ratio * a.eta * a.motor.kt)) * 1.05);
    expect(Math.abs(heavy.current)).toBeGreaterThanOrEqual(((tau * a.etaBack) / (a.ratio * a.motor.kt)) * 0.95);
  });

  it('moves faster with a lower gear ratio but holds less', () => {
    const fast = new JointRig({ ...DEFAULT_RIG, ratio: 12, payload: 0, speed: 1000 });
    const slow = new JointRig({ ...DEFAULT_RIG, ratio: 60, payload: 0, speed: 1000 });
    let peakFast = 0;
    let peakSlow = 0;
    for (const [r, set] of [
      [fast, (v: number) => (peakFast = Math.max(peakFast, v))],
      [slow, (v: number) => (peakSlow = Math.max(peakSlow, v))],
    ] as const) {
      r.moveTo(0);
      for (let i = 0; i < 200; i++) {
        r.step(0.005);
        set(Math.abs(r.qd));
      }
    }
    expect(peakFast).toBeGreaterThan(peakSlow);
  });

  it('saturates the current when asked for more than the actuator has', () => {
    const rig = new JointRig({ ...DEFAULT_RIG, payload: 30, speed: 600, ratio: 10 });
    rig.moveTo(0);
    let limited = false;
    for (let i = 0; i < 200; i++) {
      rig.step(0.01);
      limited ||= rig.currentLimited || rig.voltageLimited;
    }
    expect(limited).toBe(true);
  });

  it('heats the winding when holding a heavy load and derates', () => {
    const rig = new JointRig({ ...DEFAULT_RIG, payload: 20 });
    rig.moveTo(0);
    for (let i = 0; i < 200; i++) rig.step(0.01);
    const T0 = rig.thermal.Tw;
    for (let i = 0; i < 600; i++) rig.step(0.01, 1000); // 6 s at 1000× = 6000 s of heating
    expect(rig.thermal.Tw).toBeGreaterThan(T0 + 40);
    expect(rig.thermal.currentLimit(rig.act.peakCurrent)).toBeLessThan(rig.act.peakCurrent);
  });
});

describe('grasp and slip', () => {
  it('holds a box with a margin', () => {
    const g = new GraspSim(OBJECTS.box);
    g.close();
    g.step(1.5);
    expect(g.phase).toBe('holding');
    expect(2 * g.mu * g.normal).toBeGreaterThan(g.load);
  });

  it('detects slip when friction drops, raises the grip and stops the slide', () => {
    const g = new GraspSim(OBJECTS.cup);
    g.close();
    g.step(1);
    const before = g.normal;
    g.mu = 0.22; // the surface gets wet
    g.step(2);
    expect(g.detections).toBeGreaterThan(0);
    expect(g.normal).toBeGreaterThan(before);
    expect(g.phase).toBe('holding');
    expect(g.slip).toBeGreaterThan(0.0005);
    expect(g.slip).toBeLessThan(0.03);
  });

  it('keeps a fragile vial under its crush force', () => {
    const g = new GraspSim(OBJECTS.vial);
    g.close();
    g.step(2);
    expect(g.crushed).toBe(false);
    expect(g.normal).toBeLessThan(OBJECTS.vial.crush);
  });

  it('drops an object that needs more grip than the fingers have', () => {
    const g = new GraspSim({ ...OBJECTS.wet, mass: 3 });
    expect(g.beyondLimit).toBe(true);
    g.close();
    g.step(3);
    expect(g.phase).toBe('dropped');
  });

  it('gives a fingertip force in the range of dexterous robot hands', () => {
    const f = fingertipForce(FINGER_ACTUATOR.peakCurrent, FINGER_ACTUATOR);
    expect(f).toBeGreaterThan(10);
    expect(f).toBeLessThan(25);
    expect(GRIP.maxNormal).toBeGreaterThan(f);
  });
});

describe('sensors', () => {
  it('fuses gyro and accelerometer into a drift-free, low-noise attitude', () => {
    const imu = new ImuSim();
    const truth = { pitch: 5 * DEG, roll: 0 };
    imu.reset(truth);
    for (let i = 0; i < 6000; i++) imu.step(0.01, truth, { pitch: 0, roll: 0 });
    expect(Math.abs(imu.gyroOnly.pitch - truth.pitch)).toBeGreaterThan(0.1 * DEG); // drifted
    // residual = gyro bias × filter time constant (0.12 °/s × 0.5 s = 0.06°)
    expect(Math.abs(imu.fused.pitch - truth.pitch)).toBeLessThan(0.1 * DEG);
  });

  it('makes stereo depth error grow with the square of distance', () => {
    const a = stereoDepth(1);
    const b = stereoDepth(4);
    expect(b.sigma / a.sigma).toBeCloseTo(16, 6);
    expect(a.sigma).toBeLessThan(0.005);
  });
});
