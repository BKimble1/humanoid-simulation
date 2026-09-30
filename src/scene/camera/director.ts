/**
 * The camera director: the only code that moves the camera.
 *
 * A camera state is an orbit about a target: azimuth, elevation, distance, field of view. A
 * shot names a destination state (its target may follow an anchor on the robot), how long to
 * get there, how the camera may drift while it holds, and how far the visitor may orbit.
 *
 * Transitions are velocity-continuous: each parameter follows a quintic from the camera's
 * state *and velocity* at the moment the transition starts to the destination at rest, with
 * zero acceleration at the end. A new shot requested mid-move therefore starts from where the
 * camera actually is and how it is moving: no snap, no stop-and-go, whatever the visitor clicks.
 * Azimuth takes the shorter way round. The path is an orbit about a moving target, so it
 * stays at a distance from the robot; a keep-out check pushes the camera out of the robot's
 * volumes and above the floor if a shot or the visitor ever asks for it.
 */
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

export interface CamState {
  target: Vector3;
  az: number;
  el: number;
  dist: number;
  fov: number;
  /** Lens shift as a fraction of the view (x: + moves the subject left on screen), so the
   * subject sits beside the interface instead of under it. */
  ox: number;
  oy: number;
}

export interface Shot {
  id: string;
  /** Destination target (world), or a function evaluated every frame (following an anchor). */
  target: Vector3 | (() => Vector3);
  az: number;
  el: number;
  dist: number;
  fov?: number;
  /** Lens shift (see CamState). */
  ox?: number;
  oy?: number;
  /** On a phone held upright, when the default framing crops the subject: distance factor and
   * extra vertical lens shift. */
  phone?: { dist?: number; oy?: number };
  /** Transition time, s (default from how far the camera travels). */
  duration?: number;
  /** Slow orbit while holding, rad/s, and a gentle elevation sway amplitude, rad. */
  drift?: number;
  sway?: number;
  /** What the visitor may do while the shot holds. */
  orbit?: { az?: [number, number] | null; el?: [number, number]; dist?: [number, number] } | false;
}

export interface KeepOut {
  /** Capsule from a to b with radius r (world). */
  a: Vector3;
  b: Vector3;
  r: number;
}

const TAU = Math.PI * 2;

function quintic(p0: number, v0: number, p1: number, u: number): number {
  const d = p1 - p0;
  const a3 = 10 * d - 6 * v0;
  const a4 = -15 * d + 8 * v0;
  const a5 = 6 * d - 3 * v0;
  return p0 + v0 * u + a3 * u * u * u + a4 * u * u * u * u + a5 * u * u * u * u * u;
}

function wrap(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function positionOf(s: CamState, out = new Vector3()): Vector3 {
  const c = Math.cos(s.el);
  return out.set(s.target.x + s.dist * c * Math.sin(s.az), s.target.y + s.dist * Math.sin(s.el), s.target.z + s.dist * c * Math.cos(s.az));
}

export class Director {
  camera: PerspectiveCamera;
  /** The state the camera shows now. */
  cur: CamState = { target: new Vector3(0, 1, 0), az: 0.4, el: 0.12, dist: 4, fov: 30, ox: 0, oy: 0 };
  /** Rate of change of each parameter (per second), for velocity-continuous transitions. */
  private vel = { t: new Vector3(), az: 0, el: 0, dist: 0, fov: 0, ox: 0, oy: 0 };
  private prev: CamState | null = null;
  shot: Shot | null = null;
  private from: CamState | null = null;
  private fromVel = { t: new Vector3(), az: 0, el: 0, dist: 0, fov: 0, ox: 0, oy: 0 };
  private dur = 1;
  private t = 0;
  /** The visitor's orbit offsets on top of the shot. */
  user = { az: 0, el: 0, zoom: 1 };
  private userVel = { az: 0, el: 0 };
  private driftPhase = 0;
  keepOut: KeepOut[] = [];
  /** A transition is running. */
  moving = false;
  /** Time scale for reduced motion (transitions become short cross-moves). */
  reducedMotion = false;
  floor = 0.12;
  /** Viewport size (for the lens shift) and a compact layout flag (phones: no side shift). */
  viewW = 1280;
  viewH = 800;
  compact = false;

  /** The shot's horizontal lens shift for the current layout. */
  private lensX(s: Shot): number {
    return this.compact ? 0 : (s.ox ?? 0);
  }

  /** Vertical lens shift: on phones the panel is a bottom sheet, so the subject sits higher and
   * a little further away. */
  private lensY(s: Shot): number {
    if (!this.compact) return s.oy ?? 0;
    return this.viewH > this.viewW ? (s.oy ?? 0) - 0.12 + (s.phone?.oy ?? 0) : (s.oy ?? 0) - 0.05;
  }

  private distOf(s: Shot): number {
    if (!this.compact) return s.dist;
    // portrait: the whole robot has to fit above the sheet
    const portrait = this.viewH > this.viewW;
    return s.dist * (portrait ? (s.phone?.dist ?? (s.dist > 2.2 ? 1.72 : 1.35)) : 1.12);
  }
  ceiling = 4.2;
  private dragging = false;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
  }

  private targetOf(s: Shot): Vector3 {
    return typeof s.target === 'function' ? s.target() : s.target;
  }

  /** Start a shot from wherever the camera is, carrying its current motion. */
  go(shot: Shot, opts: { duration?: number; keepUser?: boolean; instant?: boolean } = {}) {
    const dest = this.targetOf(shot);
    // include the visitor's offsets in the starting state, then clear them
    const start = this.effective();
    this.from = { target: start.target.clone(), az: start.az, el: start.el, dist: start.dist, fov: start.fov, ox: start.ox, oy: start.oy };
    this.fromVel = { t: this.vel.t.clone(), az: this.vel.az, el: this.vel.el, dist: this.vel.dist, fov: this.vel.fov, ox: this.vel.ox, oy: this.vel.oy };
    if (!opts.keepUser) {
      this.user = { az: 0, el: 0, zoom: 1 };
      this.userVel = { az: 0, el: 0 };
    }
    this.cur = { ...this.from, target: this.from.target.clone() };
    this.shot = shot;
    this.driftPhase = 0;
    this.t = 0;
    // duration from the size of the move (angular, distance ratio, target travel)
    const dAz = Math.abs(wrap(shot.az - this.from.az));
    const dEl = Math.abs(shot.el - this.from.el);
    const dD = Math.abs(Math.log(shot.dist / Math.max(0.05, this.from.dist)));
    const dT = dest.distanceTo(this.from.target);
    const auto = 1.1 + 0.55 * dAz + 0.9 * dEl + 0.7 * dD + 0.45 * dT;
    this.dur = opts.instant ? 0 : (opts.duration ?? shot.duration ?? Math.min(3.2, Math.max(1.2, auto)));
    if (this.reducedMotion && !opts.instant) this.dur = Math.min(this.dur, 0.6);
    this.moving = this.dur > 0;
    if (!this.moving) this.snapToShot();
  }

  private snapToShot() {
    const s = this.shot!;
    this.cur = { target: this.targetOf(s).clone(), az: s.az, el: s.el, dist: this.distOf(s), fov: s.fov ?? 30, ox: this.lensX(s), oy: this.lensY(s) };
  }

  /** The state including the visitor's orbit offsets. */
  effective(): CamState {
    return { target: this.cur.target.clone(), az: this.cur.az + this.user.az, el: this.cur.el + this.user.el, dist: this.cur.dist * this.user.zoom, fov: this.cur.fov, ox: this.cur.ox, oy: this.cur.oy };
  }

  update(dt: number) {
    const s = this.shot;
    if (!s) return;
    const prevEff = this.prev;
    if (this.moving && this.from) {
      this.t += dt;
      const u = Math.min(1, this.t / this.dur);
      const T = this.dur;
      const dest = this.targetOf(s);
      const f = this.from;
      const v = this.fromVel;
      // shortest way round in azimuth
      const azDest = f.az + wrap(s.az - f.az);
      this.cur.az = quintic(f.az, v.az * T, azDest, u);
      this.cur.el = quintic(f.el, v.el * T, s.el, u);
      this.cur.dist = Math.exp(quintic(Math.log(f.dist), (v.dist / Math.max(0.05, f.dist)) * T, Math.log(this.distOf(s)), u));
      this.cur.fov = quintic(f.fov, v.fov * T, s.fov ?? 30, u);
      this.cur.ox = quintic(f.ox, v.ox * T, this.lensX(s), u);
      this.cur.oy = quintic(f.oy, v.oy * T, this.lensY(s), u);
      this.cur.target.set(quintic(f.target.x, v.t.x * T, dest.x, u), quintic(f.target.y, v.t.y * T, dest.y, u), quintic(f.target.z, v.t.z * T, dest.z, u));
      if (u >= 1) {
        this.moving = false;
        this.cur.az = wrap(this.cur.az);
      }
    } else {
      // holding: follow the target, drift slowly
      const dest = this.targetOf(s);
      this.cur.target.copy(dest);
      this.driftPhase += dt;
      if (s.drift) this.cur.az = wrap(this.cur.az + s.drift * dt);
      else this.cur.az = s.az + (this.cur.az - s.az) * Math.exp(-dt * 2);
      const sway = s.sway ? s.sway * Math.sin(this.driftPhase * 0.21) * Math.min(1, this.driftPhase / 4) : 0;
      this.cur.el = s.el + sway;
      this.cur.dist += (this.distOf(s) - this.cur.dist) * Math.min(1, dt * 3);
      this.cur.fov = s.fov ?? 30;
      this.cur.ox += (this.lensX(s) - this.cur.ox) * Math.min(1, dt * 3);
      this.cur.oy += (this.lensY(s) - this.cur.oy) * Math.min(1, dt * 3);
    }
    // visitor orbit inertia
    if (!this.dragging) {
      this.user.az += this.userVel.az * dt;
      this.user.el += this.userVel.el * dt;
      const k = Math.exp(-dt * 4.5);
      this.userVel.az *= k;
      this.userVel.el *= k;
    }
    this.clampUser();
    // velocities of the effective state (for the next transition's start)
    const eff = this.effective();
    if (prevEff && dt > 0) {
      const a = 0.35; // smoothed
      this.vel.t.lerp(eff.target.clone().sub(prevEff.target).divideScalar(dt), a);
      this.vel.az += (wrap(eff.az - prevEff.az) / dt - this.vel.az) * a;
      this.vel.el += ((eff.el - prevEff.el) / dt - this.vel.el) * a;
      this.vel.dist += ((eff.dist - prevEff.dist) / dt - this.vel.dist) * a;
      this.vel.fov += ((eff.fov - prevEff.fov) / dt - this.vel.fov) * a;
      this.vel.ox += ((eff.ox - prevEff.ox) / dt - this.vel.ox) * a;
      this.vel.oy += ((eff.oy - prevEff.oy) / dt - this.vel.oy) * a;
    }
    this.prev = eff;
    this.apply(eff);
  }

  private clampUser() {
    const s = this.shot;
    const o = s?.orbit;
    if (!s || o === false || o === undefined) {
      this.user.az *= 0.9;
      this.user.el *= 0.9;
      this.user.zoom = 1 + (this.user.zoom - 1) * 0.9;
      return;
    }
    if (o.az) this.user.az = MathUtils.clamp(this.user.az, o.az[0], o.az[1]);
    const el = o.el ?? [-0.25, 0.9];
    this.user.el = MathUtils.clamp(this.user.el, el[0] - this.cur.el, el[1] - this.cur.el);
    const d = o.dist ?? [0.6, 1.8];
    this.user.zoom = MathUtils.clamp(this.user.zoom, d[0], d[1]);
  }

  private _p = new Vector3();
  private _c = new Vector3();
  private apply(s: CamState) {
    const cam = this.camera;
    const p = positionOf(s, this._p);
    // keep-out: push out of the robot's capsules, stay above the floor and below the ceiling
    for (const k of this.keepOut) {
      const ab = this._c.subVectors(k.b, k.a);
      const t = MathUtils.clamp(new Vector3().subVectors(p, k.a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
      const closest = k.a.clone().addScaledVector(ab, t);
      const d = p.distanceTo(closest);
      if (d < k.r) {
        const dir = p.clone().sub(closest);
        if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
        p.copy(closest).addScaledVector(dir.normalize(), k.r);
      }
    }
    p.y = MathUtils.clamp(p.y, this.floor, this.ceiling);
    cam.position.copy(p);
    cam.up.set(0, 1, 0);
    cam.lookAt(s.target);
    if (Math.abs(cam.fov - s.fov) > 1e-4) cam.fov = s.fov;
    const dist = p.distanceTo(s.target);
    cam.near = MathUtils.clamp(dist * 0.02, 0.008, 0.2);
    cam.far = 80;
    // lens shift: render a window offset within a larger virtual frame
    const W = this.viewW;
    const H = this.viewH;
    if (Math.abs(s.ox) > 1e-4 || Math.abs(s.oy) > 1e-4) cam.setViewOffset(W, H, s.ox * W, -s.oy * H, W, H);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }

  // ─────────────────────────── visitor input ───────────────────────────

  private pointers = new Map<number, { x: number; y: number }>();
  private pinch0 = 0;
  private zoom0 = 1;

  canOrbit(): boolean {
    return !!this.shot && this.shot.orbit !== false && this.shot.orbit !== undefined;
  }

  attach(el: HTMLElement): () => void {
    const down = (e: PointerEvent) => {
      if (!this.canOrbit()) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.userVel = { az: 0, el: 0 };
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom0 = this.user.zoom;
      }
    };
    const move = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1) {
        const k = 0.0055;
        this.user.az -= dx * k;
        this.user.el += dy * k;
        const now = 1 / 60;
        this.userVel.az = (-dx * k) / now;
        this.userVel.el = (dy * k) / now;
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch0 > 0) this.user.zoom = this.zoom0 * (this.pinch0 / Math.max(1, d));
      }
    };
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) {
        this.dragging = false;
        // keep a little of the fling
        this.userVel.az = MathUtils.clamp(this.userVel.az * 0.25, -2, 2);
        this.userVel.el = MathUtils.clamp(this.userVel.el * 0.25, -1, 1);
      }
    };
    const wheel = (e: WheelEvent) => {
      if (!this.canOrbit()) return;
      e.preventDefault();
      this.user.zoom *= Math.exp(e.deltaY * 0.0012);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }

  /** The visitor has moved the camera away from the directed framing. */
  get offFraming(): boolean {
    return Math.abs(this.user.az) > 0.05 || Math.abs(this.user.el) > 0.05 || Math.abs(this.user.zoom - 1) > 0.05;
  }

  /** Return to the directed framing (smoothly). */
  recenter() {
    if (this.shot) this.go(this.shot, { duration: 1.1 });
  }
}
