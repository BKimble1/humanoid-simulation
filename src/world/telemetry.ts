/**
 * Developer telemetry: per-frame measurements of what the visitor sees, for continuity tests
 * and the V2 evidence. Off unless a test or probe turns it on (window.__fabTelemetry, test
 * hooks only); it only observes.
 *
 * Per frame: the joint speeds and accelerations of the displayed pose, how fast the hand pose
 * changes, the pelvis speed, the camera's speed, acceleration and clearance from the robot's
 * collision proxies, how far a planted sole slides relative to what supports it (the floor, or
 * the treadmill belt), how fast held objects move and how far they are from the hand holding
 * them, the scene and transition identity, and the real frame interval. Intentional
 * discontinuities (a restore after a demonstrated fall, a reset) are recorded as events so
 * tests exempt exactly those frames, not blanket thresholds.
 */
import { Vector3 } from 'three';
import type { Side } from '../spec/body';
import { NJ, JOINT_IDS } from '../engine/skeleton';
import { RobotProxies, clearance } from './proxies';
import { time } from '../scene/time';
import type { World } from './world';

export interface Sample {
  /** Frame index since start, clock time (s) and the frame's dt (s). */
  i: number;
  t: number;
  dt: number;
  /** Real interval since the previous frame (ms, real-time playback only; 0 in virtual time). */
  frameMs: number;
  scene: string;
  shot: string;
  transition: number;
  source: string;
  blending: boolean;
  /** Largest joint speed (rad/s) and acceleration (rad/s²) of the displayed pose, and which joint. */
  jv: number;
  ja: number;
  jvJoint: string;
  /** Largest rate of change of a hand pose scalar (finger flexion, thumb, spread; 1/s). */
  hv: number;
  /** Pelvis speed (m/s). */
  pv: number;
  /** Camera speed (m/s), acceleration (m/s²), clearance from the robot proxies (m) and which proxy. */
  cv: number;
  ca: number;
  cc: number;
  ccId: string;
  /** Planted sole slip relative to its support (m/s), per side (0 when not planted). */
  slipL: number;
  slipR: number;
  /** Lowest sole corner (m; negative: below the floor). */
  soleMin: number;
  /** Fastest held or prop object (m/s) and its distance from its holding hand (m; -1: not held). */
  ov: number;
  attach: number;
  /** Channel values of interest. */
  explode: number;
  actuatorOut: number;
  /** Which exploded assemblies are visible. */
  assemblies: string;
  paused: boolean;
}

export interface TelemetryEvent {
  i: number;
  t: number;
  kind: string;
  detail?: string;
}

export class Telemetry {
  enabled = false;
  samples: Sample[] = [];
  events: TelemetryEvent[] = [];
  max = 30000;
  private i = 0;
  private proxies = new RobotProxies();
  private prevQ = new Float64Array(NJ);
  private prevV = new Float64Array(NJ);
  private prevHands: number[] = [];
  private prevPelvis = new Vector3();
  private prevCam = new Vector3();
  private prevCamV = new Vector3();
  private prevCorners: Record<Side, Vector3[]> | null = null;
  private prevBelt = 0;
  private prevObjs = new Map<string, Vector3>();
  private primed = 0;
  private lastShot = '';
  private transition = 0;
  private lastReal = 0;

  start() {
    this.enabled = true;
    this.samples = [];
    this.events = [];
    this.primed = 0;
    this.prevCorners = null;
    this.prevObjs.clear();
    this.lastReal = 0;
  }

  stop() {
    this.enabled = false;
  }

  mark(kind: string, detail?: string) {
    if (this.enabled) this.events.push({ i: this.i, t: time.now, kind, detail });
  }

  record(w: World, dt: number) {
    if (!this.enabled || dt <= 0) return;
    this.i++;
    const out = w.driver.out;
    const kin = w.kin;
    kin.update(out);
    // joints
    let jv = 0;
    let ja = 0;
    let jvJoint = '';
    for (let k = 0; k < NJ; k++) {
      const v = (out.q[k] - this.prevQ[k]) / dt;
      const a = (v - this.prevV[k]) / dt;
      if (this.primed > 0 && Math.abs(v) > jv) {
        jv = Math.abs(v);
        jvJoint = JOINT_IDS[k];
      }
      if (this.primed > 1) ja = Math.max(ja, Math.abs(a));
      this.prevV[k] = v;
      this.prevQ[k] = out.q[k];
    }
    // hands
    const hs = w.displayedHandScalars();
    let hv = 0;
    if (this.primed > 0 && this.prevHands.length === hs.length) for (let k = 0; k < hs.length; k++) hv = Math.max(hv, Math.abs(hs[k] - this.prevHands[k]) / dt);
    this.prevHands = hs;
    const pv = this.primed > 0 ? out.pelvisPos.distanceTo(this.prevPelvis) / dt : 0;
    this.prevPelvis.copy(out.pelvisPos);
    // camera
    const cam = w.stage.camera.position;
    const camV = new Vector3().subVectors(cam, this.prevCam).divideScalar(dt);
    const cv = this.primed > 0 ? camV.length() : 0;
    const ca = this.primed > 1 ? camV.clone().sub(this.prevCamV).length() / dt : 0;
    this.prevCam.copy(cam);
    this.prevCamV.copy(camV);
    this.proxies.update(kin);
    const cl = clearance(this.proxies.capsules, cam);
    // feet: corners on the floor in both frames must not move relative to the support
    const belt = w.walk.beltNow;
    const beltDz = -(belt - this.prevBelt);
    this.prevBelt = belt;
    const corners = { L: kin.soleCorners('L'), R: kin.soleCorners('R') };
    const slip = { L: 0, R: 0 };
    let soleMin = Infinity;
    for (const s of ['L', 'R'] as Side[]) {
      for (let k = 0; k < 4; k++) {
        const p = corners[s][k];
        soleMin = Math.min(soleMin, p.y);
        const q = this.prevCorners?.[s][k];
        if (!q || p.y > 0.004 || q.y > 0.004) continue;
        const onBelt = Math.abs(p.x) < 0.45; // the treadmill belt spans the robot's stance
        const dz = p.z - q.z - (onBelt ? beltDz : 0);
        const dx = p.x - q.x;
        slip[s] = Math.max(slip[s], Math.hypot(dx, dz) / dt);
      }
    }
    this.prevCorners = corners;
    // objects: every movable prop the world tracks, and the attachment of a held one
    const objs = w.trackedObjects();
    let ov = 0;
    for (const [id, p] of objs) {
      const q = this.prevObjs.get(id);
      if (q && this.primed > 0) ov = Math.max(ov, p.distanceTo(q) / dt);
      if (q) q.copy(p);
      else this.prevObjs.set(id, p.clone());
    }
    const attach = w.holdAttachmentError();
    // transitions
    const shot = w.director.shot?.id ?? '';
    const tid = w.director.transitionId;
    if (tid !== this.transition || shot !== this.lastShot) {
      this.transition = tid;
      this.lastShot = shot;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const frameMs = time.virtual || !this.lastReal ? 0 : now - this.lastReal;
    this.lastReal = now;
    const s: Sample = {
      i: this.i,
      t: time.now,
      dt,
      frameMs,
      scene: w.sceneId,
      shot,
      transition: tid,
      source: w.driver.source?.id ?? '',
      blending: w.driver.blending,
      jv,
      ja,
      jvJoint,
      hv,
      pv,
      cv,
      ca,
      cc: cl.d,
      ccId: cl.id,
      slipL: slip.L,
      slipR: slip.R,
      soleMin,
      ov,
      attach,
      explode: w.ch.get('explode'),
      actuatorOut: w.ch.get('actuatorOut'),
      assemblies: w.visibleAssemblies().join(','),
      paused: w.presentationPaused,
    };
    this.samples.push(s);
    if (this.samples.length > this.max) this.samples.shift();
    this.primed++;
  }
}
