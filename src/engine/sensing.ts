/**
 * Sensor models: the IMU and its attitude estimate, and stereo depth uncertainty.
 *
 * IMU: gyro = ω + b + n_g, accelerometer = Rᵀ(a − g) + n_a, with white noise from the noise
 * densities in spec/sensing.ts (σ = density·√rate) and a constant gyro bias. Three attitude
 * estimates are formed from the same samples so their failure modes can be compared:
 *   accelerometer only   tilt from the gravity direction: no drift, but noisy and fooled by
 *                        acceleration
 *   gyro only            integrated rate: smooth, but the bias makes it drift
 *   complementary filter gyro at high frequency, accelerometer at low frequency (the classic
 *                        fusion; FO-H1's real estimator would be a Kalman filter that also
 *                        fuses leg kinematics)
 *
 * Stereo: depth from disparity z = f·B/d, so a disparity error σ_d gives σ_z = z²·σ_d/(f·B):
 * error grows with the square of distance.
 */
import { HEAD_CAMERAS, IMU } from '../spec/sensing';

const DEG = Math.PI / 180;

/** Seeded Gaussian noise (Box–Muller on a small LCG), for repeatable signals. */
export class Noise {
  private s: number;
  private spare: number | null = null;
  constructor(seed = 7) {
    this.s = seed >>> 0;
  }
  uniform(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return (this.s + 0.5) / 4294967296;
  }
  gauss(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    const u = this.uniform();
    const v = this.uniform();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }
}

export interface Attitude {
  /** Pitch and roll, rad. */
  pitch: number;
  roll: number;
}

/**
 * A planar (pitch and roll) IMU and three estimators, stepped at the IMU rate. True attitude
 * and angular rates come from the simulated body.
 */
export class ImuSim {
  readonly rate = IMU.rateHz;
  readonly gyroSigma = IMU.gyroNoiseDensity * DEG * Math.sqrt(IMU.rateHz);
  readonly accelSigma = IMU.accelNoiseDensity * 9.81 * Math.sqrt(IMU.rateHz);
  /** Gyro bias used for the demonstration (turn-on bias of an industrial MEMS gyro), rad/s. */
  bias = { pitch: 0.12 * DEG, roll: -0.08 * DEG };
  noise = new Noise(11);
  accelOnly: Attitude = { pitch: 0, roll: 0 };
  gyroOnly: Attitude = { pitch: 0, roll: 0 };
  fused: Attitude = { pitch: 0, roll: 0 };
  /** Complementary filter crossover time constant, s. */
  tau = 0.5;
  gyro = { pitch: 0, roll: 0 };
  accel = { x: 0, y: 0, z: 0 };
  private acc = 0;

  /** Advance by dt with the true attitude, its rates and the body's horizontal acceleration. */
  step(dt: number, truth: Attitude, rate: Attitude, linAcc: { x: number; z: number } = { x: 0, z: 0 }) {
    this.acc += dt;
    const h = 1 / this.rate;
    while (this.acc >= h) {
      this.acc -= h;
      const gp = rate.pitch + this.bias.pitch + this.gyroSigma * this.noise.gauss();
      const gr = rate.roll + this.bias.roll + this.gyroSigma * this.noise.gauss();
      this.gyro = { pitch: gp, roll: gr };
      // specific force in the body frame (small-angle, planar): gravity plus acceleration
      const g = 9.81;
      const ax = -g * Math.sin(truth.pitch) + linAcc.z * Math.cos(truth.pitch) + this.accelSigma * this.noise.gauss();
      const ay = g * Math.sin(truth.roll) * Math.cos(truth.pitch) + linAcc.x + this.accelSigma * this.noise.gauss();
      const az = g * Math.cos(truth.roll) * Math.cos(truth.pitch) + this.accelSigma * this.noise.gauss();
      this.accel = { x: ax, y: ay, z: az };
      const aPitch = Math.atan2(-ax, Math.hypot(ay, az));
      const aRoll = Math.atan2(ay, az);
      this.accelOnly = { pitch: aPitch, roll: aRoll };
      this.gyroOnly = { pitch: this.gyroOnly.pitch + gp * h, roll: this.gyroOnly.roll + gr * h };
      const k = this.tau / (this.tau + h);
      this.fused = {
        pitch: k * (this.fused.pitch + gp * h) + (1 - k) * aPitch,
        roll: k * (this.fused.roll + gr * h) + (1 - k) * aRoll,
      };
    }
  }

  reset(a: Attitude = { pitch: 0, roll: 0 }) {
    this.accelOnly = { ...a };
    this.gyroOnly = { ...a };
    this.fused = { ...a };
  }
}

/** Focal length of the stereo cameras in pixels. */
export function stereoFocalPx(): number {
  const c = HEAD_CAMERAS.stereo;
  return c.width / 2 / Math.tan((c.hfovDeg * DEG) / 2);
}

/** Disparity (px) and depth uncertainty (m, 1σ) at a distance z (m). */
export function stereoDepth(z: number): { disparity: number; sigma: number } {
  const c = HEAD_CAMERAS.stereo;
  const f = stereoFocalPx();
  return { disparity: (f * c.baseline) / z, sigma: (z * z * c.disparitySigmaPx) / (f * c.baseline) };
}
