/**
 * Grasp, tactile sensing and slip.
 *
 * A pinch grasp (thumb opposing the fingers) holds an object by friction at two contacts:
 *
 *   hold while         m·(g + a) ≤ 2·μs·N
 *   slide when not     the object accelerates down at (m·(g+a) − 2·μk·N)/m relative to the hand
 *
 * The tactile skins measure normal force N and shear T at each contact. Shear rises towards
 * μ·N before gross slip, and the edge of the contact slips first (partial slip, Johnson 1985),
 * which shows up as a high-frequency vibration: FO-H1's grip controller reacts to either sign
 * by estimating μ from the shear-to-normal ratio at slip and raising the grip to
 *
 *   N* = m·(g + a) / (2·μ̂) · safety factor
 *
 * at the rate the finger actuators allow. Fragile objects cap N below their crush force.
 */
import { GRAVITY } from '../spec/motion';

export interface GraspObject {
  id: string;
  label: string;
  mass: number;
  /** Static friction coefficient of its surface against the silicone skin. estimate */
  mu: number;
  /** Normal force that damages it, N (Infinity when robust). */
  crush: number;
  note: string;
}

export const OBJECTS: Record<string, GraspObject> = {
  box: { id: 'box', label: 'Parts box', mass: 2.2, mu: 0.7, crush: Infinity, note: 'Rigid polymer tote with parts, 2.2 kg.' },
  cup: { id: 'cup', label: 'Beaker', mass: 0.35, mu: 0.55, crush: 60, note: 'A laboratory beaker; liquid can be added while it is held.' },
  vial: { id: 'vial', label: 'Glass sample vial', mass: 0.05, mu: 0.4, crush: 9, note: 'Thin glass: the grip must stay well under 9 N.' },
  tool: { id: 'tool', label: 'Cordless driver', mass: 1.4, mu: 0.8, crush: Infinity, note: 'A 1.4 kg tool with a rubber grip.' },
  wet: { id: 'wet', label: 'Wet bottle', mass: 0.9, mu: 0.2, crush: 80, note: 'A wet, smooth bottle: very low friction.' },
};

/** Finger actuators' grip limits: N per contact, and how fast the grip can change (N/s). */
export const GRIP = { maxNormal: 40, rate: 55, minNormal: 0.5, safety: 1.5, fragileSafety: 1.25 };

export type GraspPhase = 'free' | 'closing' | 'holding' | 'slipping' | 'dropped';

export interface GraspSample {
  t: number;
  normal: number;
  shear: number;
  required: number;
  slipVel: number;
  vibration: number;
}

export class GraspSim {
  obj: GraspObject;
  mass: number;
  mu: number;
  t = 0;
  phase: GraspPhase = 'free';
  /** Normal force at each contact, N. */
  normal = 0;
  normalCmd = 0;
  /** Shear at each contact (half the load when stuck), N. */
  shear = 0;
  /** Downward slip of the object in the hand, m, and its speed. */
  slip = 0;
  slipVel = 0;
  /** Estimated friction coefficient the controller uses. */
  muHat = 0.5;
  /** High-frequency tactile vibration energy (arbitrary units, 0–1). */
  vibration = 0;
  slipDetected = false;
  lastDetection = -10;
  detections = 0;
  crushed = false;
  /** Hand's vertical acceleration, m/s² (lifting). */
  handAcc = 0;
  /** Share of the object's weight the hand carries (0 while it still rests on the table, rising
   * to 1 as the lift takes it off). The grip controller follows the load as it transfers. */
  support = 1;
  history: GraspSample[] = [];
  private lastSample = -1;
  private rng = 1;

  constructor(obj: GraspObject) {
    this.obj = obj;
    this.mass = obj.mass;
    this.mu = obj.mu;
  }

  private noise(): number {
    // deterministic LCG for repeatable tactile noise
    this.rng = (this.rng * 1664525 + 1013904223) % 4294967296;
    return this.rng / 4294967296 - 0.5;
  }

  /** Load the grasp must carry, N. */
  get load(): number {
    return this.support * this.mass * (GRAVITY + this.handAcc);
  }

  /** Normal force the controller aims for at its current friction estimate. */
  target(): number {
    const sf = this.obj.crush < 50 ? GRIP.fragileSafety : GRIP.safety;
    const need = (this.load / (2 * this.muHat)) * sf;
    const cap = Number.isFinite(this.obj.crush) ? this.obj.crush * 0.8 : GRIP.maxNormal;
    return Math.max(GRIP.minNormal, Math.min(GRIP.maxNormal, cap, need));
  }

  close() {
    this.phase = 'closing';
    this.muHat = 0.5;
  }

  release() {
    this.phase = 'free';
    this.normalCmd = 0;
  }

  step(dt: number) {
    const h = 0.001;
    const n = Math.max(1, Math.round(dt / h));
    for (let i = 0; i < n; i++) this.tick(h);
  }

  private tick(h: number) {
    this.t += h;
    if (this.phase === 'free' || this.phase === 'dropped') {
      this.normalCmd = 0;
    } else {
      this.normalCmd = this.target();
    }
    // finger actuators: rate-limited force
    const dN = Math.max(-GRIP.rate * 2 * h, Math.min(GRIP.rate * h, this.normalCmd - this.normal));
    this.normal = Math.max(0, this.normal + dN);
    if (this.phase === 'closing' && this.normal >= this.normalCmd * 0.98) this.phase = 'holding';
    if (Number.isFinite(this.obj.crush) && this.normal > this.obj.crush) this.crushed = true;

    const muS = this.mu;
    const muK = this.mu * 0.8;
    const holding = this.phase === 'holding' || this.phase === 'slipping';
    const capacity = 2 * muS * this.normal;
    const load = this.load;
    if (!holding) {
      this.shear = 0;
      this.slipVel = 0;
    } else if (this.phase === 'holding' && load <= capacity) {
      this.shear = load / 2;
      this.slipVel = 0;
    } else {
      // gross slip: kinetic friction decelerates the object relative to the hand
      this.phase = 'slipping';
      const acc = (load - 2 * muK * this.normal) / this.mass;
      this.slipVel = Math.max(0, this.slipVel + acc * h);
      this.shear = muK * this.normal;
      this.slip += this.slipVel * h;
      if (this.slipVel === 0 && load <= capacity) this.phase = 'holding';
      if (this.slip > 0.03) {
        this.phase = 'dropped';
        this.normal = 0;
      }
    }
    // tactile signals: shear ratio and vibration (partial slip above ~85 % of μ, gross slip)
    const ratio = this.normal > 0.05 ? this.shear / this.normal : 0;
    const partial = Math.max(0, (ratio - 0.85 * muS) / (0.15 * muS));
    const target = this.phase === 'slipping' ? 0.6 + 0.4 * Math.min(1, this.slipVel / 0.05) : Math.min(0.5, partial * 0.5);
    this.vibration += (target - this.vibration) * Math.min(1, h * 60);
    this.vibration = Math.max(0, this.vibration + this.noise() * 0.004);
    // detection → re-estimate μ from the observed ratio and raise the grip
    const detect = holding && (this.vibration > 0.18 || this.phase === 'slipping');
    if (detect && this.t - this.lastDetection > 0.05) {
      this.lastDetection = this.t;
      this.detections++;
      this.muHat = Math.max(0.1, Math.min(this.muHat, ratio * 0.95));
    }
    this.slipDetected = detect;
    if (this.t - this.lastSample >= 0.01) {
      this.lastSample = this.t;
      this.history.push({ t: this.t, normal: this.normal, shear: this.shear, required: load / (2 * muS), slipVel: this.slipVel, vibration: this.vibration });
      if (this.history.length > 600) this.history.splice(0, this.history.length - 600);
    }
  }

  /** Grip force per contact the object needs at minimum with its true friction, N. */
  get minimumNormal(): number {
    return this.load / (2 * this.mu);
  }

  /** The same for the object's full weight at rest in the hand, N. */
  get holdingNormal(): number {
    return (this.mass * GRAVITY) / (2 * this.mu);
  }

  /** The grasp cannot hold the object even at the finger actuators' limit. */
  get beyondLimit(): boolean {
    const cap = Number.isFinite(this.obj.crush) ? Math.min(this.obj.crush, GRIP.maxNormal) : GRIP.maxNormal;
    return this.holdingNormal > cap;
  }
}

/** Fingertip normal force a finger actuator can produce at a current, N (see spec). */
export function fingertipForce(currentA: number, spec: { kt: number; gearhead: number; gearheadEfficiency: number; leadscrewLead: number; leadscrewEfficiency: number; linkageAdvantage: number }): number {
  const tau = spec.kt * currentA * spec.gearhead * spec.gearheadEfficiency;
  const nut = (2 * Math.PI * spec.leadscrewEfficiency * tau) / spec.leadscrewLead;
  return nut * spec.linkageAdvantage;
}
