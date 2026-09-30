/**
 * The robot's physical state every frame, whatever is moving it: centre of mass (from every
 * mass item), which parts of the soles touch the ground (from their geometry), the support
 * polygon, the ground reaction on each foot, joint torques and joint speeds (reduced-order
 * inverse dynamics), the capture point, and the power and heat that follow.
 *
 * While walking, the gait's own 100 Hz dynamics are used (cleaner accelerations); otherwise
 * accelerations come from successive rendered poses, low-pass filtered.
 */
import { Vector2, Vector3 } from 'three';
import { DIM, type Side } from '../../spec/body';
import { GRAVITY, LOCOMOTION } from '../../spec/motion';
import { convexHull, signedDistance, type P2 } from '../../engine/balance';
import { MotionDynamics, type DynamicsResult, type FootContact } from '../../engine/motionDynamics';
import { NJ } from '../../engine/skeleton';
import type { Feature, World } from '../world';

export class BodyState implements Feature {
  com = new Vector3();
  comVel = new Vector3();
  private prevCom: Vector3 | null = null;
  support: P2[] = [];
  contacts: Record<Side, P2[]> = { L: [], R: [] };
  capture = new Vector3();
  margin = 0;
  tau = new Float64Array(NJ);
  qd = new Float64Array(NJ);
  grf: DynamicsResult['grf'] | null = null;
  zmp = new Vector3();
  private md: MotionDynamics | null = null;
  private modelRef: unknown = null;
  /** Payload position (world) when carrying, set by sources. */
  payload: Vector3 | null = null;
  /** Energy stepping scale (thermal demos speed heating up). */
  thermalScale = 1;

  update(w: World, dt: number) {
    if (dt <= 0) return;
    const kin = w.kin;
    kin.update(w.driver.out);
    const c = w.model.com(kin, this.payload ?? undefined);
    this.com.copy(c);
    if (this.prevCom) {
      const v = c.clone().sub(this.prevCom).divideScalar(dt);
      this.comVel.lerp(v, Math.min(1, dt * 12));
    }
    this.prevCom = c.clone();
    // contacts from the soles' geometry: corners within 3 mm of the floor touch it
    const feet: FootContact[] = [];
    for (const s of ['L', 'R'] as Side[]) {
      const corners = kin.soleCorners(s);
      const down = corners.filter((p) => p.y < 0.0035).map((p) => new Vector2(p.x, p.z));
      this.contacts[s] = down.length >= 2 ? convexHull(down) : [];
      feet.push({ side: s, ankle: kin.point(`${s}_foot`, [0, 0, 0]), polygon: down.length >= 2 ? down : [] });
    }
    this.support = convexHull([...this.contacts.L, ...this.contacts.R]);
    const omega = Math.sqrt(GRAVITY / LOCOMOTION.comHeight);
    this.capture.set(c.x + this.comVel.x / omega, 0, c.z + this.comVel.z / omega);
    this.margin = this.support.length >= 3 ? signedDistance(this.support, new Vector2(this.capture.x, this.capture.z)) : -0.1;
    // dynamics: walking uses the gait's own; everything else is computed from the frames
    const walking = w.driver.source === w.walk && !w.driver.blending && w.walk.last;
    if (walking) {
      const r = w.walk.last!;
      this.tau.set(r.tau);
      this.qd.set(r.qd);
      // forces are in the belt frame: shift the centres of pressure to the world
      const off = w.walk.worldOffset();
      this.grf = {
        L: { force: r.grf.L.force.clone(), cop: r.grf.L.cop.clone().add(off), load: r.grf.L.load },
        R: { force: r.grf.R.force.clone(), cop: r.grf.R.cop.clone().add(off), load: r.grf.R.load },
      };
      this.zmp.copy(r.zmp).add(off);
      return;
    }
    if (!this.md || this.modelRef !== w.model) {
      this.md = new MotionDynamics(w.model);
      this.modelRef = w.model;
    }
    const r = this.md.update(w.driver.out, Math.max(1 / 240, dt), feet, this.payload);
    // smooth the finite-difference noise of rendered frames
    const k = Math.min(1, dt * 10);
    for (let i = 0; i < NJ; i++) {
      this.tau[i] += (r.tau[i] - this.tau[i]) * k;
      this.qd[i] += (r.qd[i] - this.qd[i]) * k;
    }
    this.grf = {
      L: { force: r.grf.L.force.clone(), cop: r.grf.L.cop.clone(), load: r.grf.L.load },
      R: { force: r.grf.R.force.clone(), cop: r.grf.R.cop.clone(), load: r.grf.R.load },
    };
    this.zmp.copy(r.zmp);
    w.energy.step(dt, this.tau, this.qd, this.thermalScale);
    void DIM;
  }
}
