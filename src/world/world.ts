/**
 * The world: the lab, FO-H1, the camera director, the scene channels, the robot's pose driver
 * and the simulations, advanced together once per frame in a fixed order:
 *
 *   1. read what the visitor asked for (app store) → scene changes (from any state, smoothly)
 *   2. simulations and pose sources advance → the robot's pose
 *   3. channels advance → covers, explosions, overlays
 *   4. features update (overlays, labels, props) from the pose and the channels
 *   5. the director moves the camera; the stage renders
 *
 * Nothing waits on a timer: every animation is a function of the frame clock, so a scene can
 * be left at any moment and the next one starts from exactly what is on screen.
 */
import { Vector3 } from 'three';
import { ACTUATORS } from '../spec/actuators';
import { GAITS } from '../spec/motion';
import { BodyEnergy } from '../engine/power';
import { RobotModel, memberReport } from '../engine/robot';
import { Kinematics, Pose, restPose, segmentScale, type LimbScale } from '../engine/skeleton';
import { ActuatorAssembly } from '../scene/actuator/assembly';
import { Director } from '../scene/camera/director';
import { Lab } from '../scene/lab/lab';
import { buildRobot } from '../scene/robot/build';
import type { RobotMesh, RobotRig, VisualGroup } from '../scene/robot/rig';
import { Channels, type ChannelId } from '../scene/seq/channels';
import { Stage } from '../scene/stage';
import { TEST_HOOKS, VIRTUAL_TIME, tickRealtime, tickVirtual, time } from '../scene/time';
import { useApp, useLab, type AppState } from '../state/store';
import { PoseDriver, type PoseSource } from './pose';
import { SCENES, type SceneDef } from './scenes';
import { IdleSource } from './sources/idle';
import { WalkSource } from './sources/walk';
import { BalanceSource } from './sources/balance';
import { ReachSource } from './sources/reach';
import { ManipSource } from './sources/manip';
import { ActuatorLive } from './features/actuatorLive';
import { BodyState } from './features/body';
import { Overlays } from './features/overlays';
import { Labels } from './features/labels';
import { Openings } from './features/openings';
import { Flows } from './features/flows';
import { Look } from './features/look';
import { Vision } from './features/vision';
import { Sound } from './features/sound';
import { Props } from './features/props';
import { RIG_PIVOT } from './props/rig';
import { Limits } from './limits';
import { TourRunner } from './tourRunner';
import { publishReadouts } from './readouts';
import { Telemetry } from './telemetry';
import { RobotProxies } from './proxies';
import { handToArray, HAND_N } from './handPose';
import { AgXToneMapping, BoxGeometry, Mesh, Group, Matrix4, Quaternion, type Object3D } from 'three';

export interface Feature {
  update(w: World, dt: number): void;
  /** Numbers for the panels, gathered ~10 times a second. */
  readouts?(r: Record<string, number | string | boolean>, w: World): void;
  dispose?(): void;
}

/** A covered part of the robot: its ghost twin (x-ray) and current display state. */
interface Cover {
  rm: RobotMesh;
  ghost: Mesh;
  g: number;
  /** Centre of the mesh's bounds in its own frame (for fading by distance from a subject). */
  centre: Vector3;
}

export class World {
  stage: Stage;
  lab: Lab;
  rig!: RobotRig;
  director: Director;
  ch = new Channels();
  model: RobotModel;
  kin: Kinematics;
  energy: BodyEnergy;
  driver: PoseDriver;
  sources: Record<string, PoseSource> = {};
  idle: IdleSource;
  walk: WalkSource;
  balance: BalanceSource;
  exercise: BalanceSource;
  reach: ReachSource;
  manip: ManipSource;
  features: Feature[] = [];
  body = new BodyState();
  overlays: Overlays;
  actuatorLive = new ActuatorLive();
  labels: Labels;
  openings = new Openings();
  flows = new Flows();
  look = new Look();
  vision = new Vision();
  sound = new Sound();
  props = new Props();
  limits: Limits;
  tour: TourRunner;
  sceneId = '';
  scene: SceneDef = SCENES.intro;
  private covers: Cover[] = [];
  private unsub: (() => void)[] = [];
  private raf = 0;
  private running = false;
  /** The exploded actuator assemblies (built after the first frame). */
  assemblies: Partial<Record<'knee' | 'hip' | 'elbow', { asm: ActuatorAssembly; holder: Group; part: string; axis: Vector3; base: Matrix4 }>> = {};
  rotorAngle = 0;
  private partFocus = 0;
  private focusedPart: string | null = null;
  /** Highlight per visual group (hover in Explore), animated towards `hoverTarget`. */
  hover: VisualGroup | null = null;
  private highlight = new Map<VisualGroup, number>();
  readoutsAt = 0;
  onFrame: ((w: World, dt: number) => void)[] = [];
  /** Developer telemetry (tests and probes only). */
  telemetry = new Telemetry();
  /** The robot's collision proxies (the camera keeps out of them), from the displayed pose. */
  proxies = new RobotProxies();

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas);
    this.lab = new Lab();
    this.stage.scene.add(this.lab.group);
    this.director = new Director(this.stage.camera);
    const cfg = useApp.getState().config;
    this.model = new RobotModel(cfg);
    this.kin = this.newKin(cfg.scale);
    this.energy = new BodyEnergy(this.model);
    this.driver = new PoseDriver(cfg.scale);
    this.idle = new IdleSource(() => this.model, this.newKin(cfg.scale));
    this.walk = new WalkSource(() => this.model, this.newKin(cfg.scale), () => this.energy);
    this.balance = new BalanceSource(() => this.model, this.newKin(cfg.scale));
    this.exercise = new BalanceSource(() => this.model, this.newKin(cfg.scale));
    this.exercise.exercise = true;
    this.exercise.id = 'exercise';
    // a push only lands with the floor in front of the robot clear
    this.balance.pushGate = () => this.props.cart.dock < 0.01;
    this.reach = new ReachSource(() => this.model, this.newKin(cfg.scale));
    this.manip = new ManipSource(() => this.model, this.newKin(cfg.scale));
    this.sources = { idle: this.idle, walk: this.walk, balance: this.balance, exercise: this.exercise, reach: this.reach, manip: this.manip };
    // energy has one owner per interval: the gait's ticks while walking is the source
    this.walk.onLoad = (dt, tau, qd) => this.energy.step(dt, tau, qd);
    this.driver.onForced = (from, to) => this.telemetry.mark('forced-handover', `${from}→${to}`);
    this.director.obstacles = () => this.proxies.capsules;
    // a source that takes over after the previous one finished picks up the lab's settings
    this.driver.onSwitch = (src) => {
      if (src !== this.walk) return;
      const l = useLab.getState();
      this.walk.carry = l.carry;
      if (l.walking || this.sceneId === 'sim.wholebody') this.walk.start(GAITS[l.gait]);
    };
    this.director.onClamp = (by) => this.telemetry.mark('camera-clamp', by.toFixed(3));
    this.overlays = new Overlays(this.body);
    this.limits = new Limits(this);
    this.tour = new TourRunner(this);
    this.stage.scene.add(this.overlays.group);
    this.labels = new Labels(canvas.parentElement!, canvas);
    this.lab.group.name = 'lab';
    this.stage.scene.add(this.flows.group, this.props.group, this.vision.frustum);
    this.props.ik.attach(this, canvas);
    this.features.push(this.body, this.actuatorLive, this.look, this.props, this.overlays, this.flows, this.vision, this.labels, this.sound);
    // reduced motion: camera moves become short cross-moves
    const rm = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.director.reducedMotion = !!rm?.matches;
    const onRM = (e: MediaQueryListEvent) => this.setReducedMotion(e.matches);
    rm?.addEventListener?.('change', onRM);
    this.unsub.push(() => rm?.removeEventListener?.('change', onRM));
    this.setReducedMotion(!!rm?.matches);
    this.unsub.push(this.director.attach(canvas));
    this.stage.onResize = (w, h) => {
      this.director.viewW = w;
      this.director.viewH = h;
      this.director.compact = w < 760;
      this.measureFree();
    };
  }

  /** Build the robot and prepare the GPU; `progress` reports 0 … 1. Returns false if the world
   * was disposed while it was being prepared (nothing is left subscribed then). */
  async init(progress: (p: number) => void): Promise<boolean> {
    progress(0.1);
    await frame();
    if (this.disposed) return false;
    const cfg = useApp.getState().config;
    this.rig = buildRobot({ scale: cfg.scale, parallel: cfg.pack.parallel });
    this.stage.scene.add(this.rig.root);
    this.prepareCovers();
    this.openings.init(this);
    this.features.unshift(this.openings);
    progress(0.45);
    await frame();
    if (this.disposed) return false;
    // first pose, first camera
    const p = restPose();
    p.pelvisPos.set(0, 0.89, 0);
    this.driver.reset(p);
    this.driver.use(this.idle, 0);
    this.driver.update(1 / 60);
    this.rig.apply(this.driver.out, this.driver.hands);
    this.kin.update(this.driver.out);
    this.proxies.update(this.kin);
    this.applyScene(this.sceneFor(useApp.getState()), true);
    progress(0.6);
    await frame();
    if (this.disposed) return false;
    this.buildAssemblies();
    progress(0.75);
    await frame();
    if (this.disposed) return false;
    this.warmVariants();
    this.actuatorLive.prepare(this.model);
    await this.stage.prewarm();
    if (this.disposed) return false;
    progress(1);
    // follow the app store
    this.unsub.push(useApp.subscribe((s, prev) => this.onStore(s, prev)));
    this.unsub.push(useLab.subscribe(() => this.onLab()));
    this.onLab();
    if (TEST_HOOKS) {
      const w = window as unknown as Record<string, unknown>;
      w.__fab = this;
      w.__fabStores = { useApp, useLab };
      w.__fabTelemetry = this.telemetry;
      // advance n frames; with render=false only the last frame is drawn (fast recording)
      w.__fabAdvance = (n = 1, render = true) => {
        for (let i = 0; i < n; i++) this.step(tickVirtual(), render || i === n - 1);
      };
      // the virtual frame's length (s): tests run at 30, 60, 120 Hz or irregular steps
      w.__fabSetStep = (dt: number) => {
        time.step = dt;
      };
      // frames of the given lengths (s), none drawn: equal simulated time at any rate
      w.__fabSteps = (steps: number[]) => {
        for (const d of steps) {
          time.step = d;
          this.step(tickVirtual(), false);
        }
      };
      // everything the demonstration presents, as numbers (pause and determinism tests)
      w.__fabState = () => this.presentedState();
      w.__fabTime = () => {
        const t0 = performance.now();
        this.step(tickVirtual(), false);
        const t1 = performance.now();
        this.stage.render(1 / 30);
        return { logic: t1 - t0, render: performance.now() - t1 };
      };
      // real frame intervals and GPU resources (performance reports, soak tests)
      w.__fabPerf = () => ({ frames: this.stage.frames.summary(), memory: { ...this.stage.renderer.info.memory }, programs: this.stage.renderer.info.programs?.length ?? 0, calls: this.stage.stats.calls, triangles: this.stage.stats.triangles, tier: this.stage.currentTier });
      w.__fabPerfReset = () => this.stage.frames.reset();
      this.unsub.push(() => {
        for (const k of ['__fab', '__fabStores', '__fabTelemetry', '__fabAdvance', '__fabSetStep', '__fabSteps', '__fabState', '__fabTime', '__fabPerf', '__fabPerfReset']) if (w[k] && (k !== '__fab' || w[k] === this)) delete w[k];
      });
    }
    return true;
  }

  private disposed = false;

  /** Reduced motion: camera moves, scene channels and blends all become short. */
  setReducedMotion(on: boolean) {
    this.director.reducedMotion = on;
    this.ch.speed = on ? 0.35 : 1;
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (VIRTUAL_TIME) return; // frames on request only (__fabAdvance)
    const loop = () => {
      if (!this.running) return;
      this.step(tickRealtime());
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ─────────────────────────── scenes ───────────────────────────

  sceneFor(s: Pick<AppState, 'mode' | 'system' | 'lab' | 'exploded' | 'limit'>): string {
    if (s.mode === 'intro') return 'intro';
    if (s.mode === 'explore') return s.system === 'actuators' && s.exploded ? 'explore.actuators.open' : `explore.${s.system}`;
    if (s.mode === 'engineer') return 'engineer';
    if (s.mode === 'simulate') return s.lab === 'limits' && s.limit ? `sim.limits.${s.limit}` : `sim.${s.lab}`;
    return this.sceneId || 'intro';
  }

  private onStore(s: AppState, prev: AppState) {
    // the guided tour owns the scene while the mode is 'watch'
    if (s.mode === 'watch' && prev.mode !== 'watch') this.tour.start(0);
    if (s.mode !== 'watch' && prev.mode === 'watch') this.tour.stop();
    // leaving the limits lab puts back whatever its scenario changed
    if (this.limits.active && (s.mode !== 'simulate' || s.lab !== 'limits')) this.limits.restore();
    const placeChanged = s.mode !== prev.mode || s.system !== prev.system || s.lab !== prev.lab || s.exploded !== prev.exploded || s.limit !== prev.limit;
    if (placeChanged) {
      if (s.mode !== 'watch') this.applyScene(this.sceneFor(s));
    } else if (s.actuator !== prev.actuator && s.mode !== 'watch') {
      // another actuator: the closed view reframes now; an opened one waits for the old one
      // to close (see updateAssemblies)
      if (this.sceneId === 'explore.actuators') this.director.go(this.scene.shot(this), { replan: true });
    }
    if (s.config !== prev.config) this.applyConfig();
  }

  private lastWhole = '';
  private onLab() {
    const l = useLab.getState();
    if (this.sceneId === 'sim.wholebody' && l.wholeMotion !== this.lastWhole) {
      this.lastWhole = l.wholeMotion;
      this.applyScene('sim.wholebody');
    }
    this.lastWhole = l.wholeMotion;
    this.balance.task = l.balanceTask;
    this.reach.mode = l.ikMode;
    this.reach.side = l.ikSide;
    this.manip.setTask(l.task);
    this.walk.carryMass = this.model.config.payload > 0 ? this.model.config.payload : 10;
    if (this.driver.source === this.walk && !this.driver.pending && this.sceneId !== 'sim.wholebody') {
      if (l.walking && !this.walk.running) this.walk.start(GAITS[l.gait]);
      else if (l.walking && this.walk.running && this.walk.gait.id !== l.gait) this.walk.start(GAITS[l.gait]);
      else if (!l.walking && this.walk.running) this.walk.stop();
      this.walk.carry = l.carry;
    }
  }

  /** Move to a scene from wherever everything is now. */
  applyScene(id: string, instant = false) {
    const def = SCENES[id] ?? SCENES.intro;
    this.sceneId = id;
    this.scene = def;
    const targets = { ...def.channels };
    if (useApp.getState().actuator !== this.shownActuator && (this.ch.get('actuatorOut') > 0.001 || this.ch.get('explode') > 0.001)) {
      targets.actuatorOut = 0;
      targets.explode = 0;
    }
    this.ch.to(targets);
    if (instant) for (const k of Object.keys(def.channels) as ChannelId[]) this.ch.set(k, def.channels[k]!);
    this.director.go(def.shot(this), instant ? { instant: true } : {});
    // pose source (the whole-body view runs whichever motion the visitor picked)
    let kind = def.pose;
    if (id === 'sim.wholebody') {
      const m = useLab.getState().wholeMotion;
      kind = m === 'walk' ? 'walk' : m === 'balance' ? 'balance' : 'reach';
    }
    const src = kind === 'walk' ? this.walk : (this.sources[kind] ?? this.idle);
    if (src === this.idle) this.idle.preset = def.idle ?? 'rest';
    const was = this.driver.source;
    this.driver.use(src, instant ? 0 : 1.0);
    if (kind === 'walk' && was === this.walk && this.driver.source === this.walk) {
      // already walking here (taken back before it handed over): carry on as the lab says
      const l = useLab.getState();
      this.walk.carry = l.carry;
      if (l.walking || id === 'sim.wholebody') this.walk.start(GAITS[l.gait]);
    }
  }

  /** Every kinematics instance (the world's and the pose sources'): limb lengths change them all. */
  private kins: Kinematics[] = [];
  private newKin(scale: LimbScale): Kinematics {
    const k = new Kinematics(scale);
    this.kins.push(k);
    return k;
  }

  private applyConfig() {
    const cfg = useApp.getState().config;
    const prev = this.model.config.scale;
    this.model = new RobotModel(cfg);
    this.energy.setModel(this.model);
    const s = cfg.scale;
    if (s.thigh !== prev.thigh || s.shin !== prev.shin || s.upperArm !== prev.upperArm || s.forearm !== prev.forearm) this.applyScale(s);
  }

  /** New limb lengths: the joints move, the limbs' parts stretch along them. */
  private applyScale(s: LimbScale) {
    for (const k of this.kins) k.setScale(s);
    this.driver.scale = { ...s };
    this.rig.setScale(s);
    const segs = new Set<Object3D>(this.rig.seg.values());
    for (const [id, g] of this.rig.seg) {
      const f = segmentScale(id, s);
      for (const c of g.children) if (!segs.has(c)) c.scale.y = f;
    }
    if (this.driver.source === this.walk) this.walk.enter(this.driver.display());
  }

  // ─────────────────────────── queries used by shots and features ───────────────────────────

  anchor(name: string, out = new Vector3()): Vector3 {
    return this.rig.anchorWorld(name, out);
  }

  /** Middle of the opened actuator's parts, following the slide-out and the explode. */
  assemblyCentre(): Vector3 {
    const a = this.assemblies[this.framedActuator];
    if (!a) return this.anchor('kneeActL');
    const p = new Vector3(0, a.asm.L * 0.5 - this.ch.get('explode') * 0.31 * a.asm.spread, 0);
    return p.applyMatrix4(a.holder.matrixWorld);
  }

  /** The selected actuator's exterior (for the Actuators shot). */
  actuatorAnchor(): Vector3 {
    const sel = useApp.getState().actuator;
    const name = sel === 'knee' ? 'kneeActL' : sel === 'hip' ? 'hipPitchActL' : 'elbowActL';
    return this.anchor(name);
  }

  private members: { model: RobotModel; r: ReturnType<typeof memberReport> } | null = null;
  /** Structural member results for the current configuration (cached per model). */
  designMembers() {
    if (!this.members || this.members.model !== this.model) this.members = { model: this.model, r: memberReport(this.model.config) };
    return this.members.r;
  }

  walkTarget(): Vector3 {
    this.rig.seg.get('pelvis')!.updateWorldMatrix(true, false);
    const p = this.anchor('pelvis');
    return new Vector3(p.x * 0.6, 0.9, p.z * 0.6);
  }

  rigTarget(): Vector3 {
    return RIG_PIVOT.clone().add(new Vector3(0.05, -0.1, 0.14));
  }

  /**
   * Compile every material variant a visit can reveal, while loading: `compile` only walks
   * what is visible, so the x-ray fades and ghosts, the opened assemblies, parked props, the
   * vision view's tone mapping and depth material would otherwise compile on first use, in
   * the middle of a transition.
   */
  private warmVariants() {
    const r = this.stage.renderer;
    const scene = this.stage.scene;
    const cam = this.stage.camera;
    const shown: Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) {
        o.visible = true;
        shown.push(o);
      }
    });
    const tone = r.toneMapping;
    const probe = new Mesh(new BoxGeometry(0.01, 0.01, 0.01));
    probe.position.set(0, -5, 0);
    scene.add(probe);
    try {
      r.compile(scene, cam);
      for (const c of this.covers) c.rm.mesh.material = c.rm.fade;
      r.compile(scene, cam);
      r.toneMapping = AgXToneMapping;
      r.compile(scene, cam);
      for (const m of this.vision.warmMaterials()) {
        probe.material = m;
        r.compile(scene, cam);
      }
    } finally {
      r.toneMapping = tone;
      for (const c of this.covers) c.rm.mesh.material = c.rm.solid;
      for (const o of shown) o.visible = false;
      scene.remove(probe);
      probe.geometry.dispose();
    }
  }

  // ─────────────────────────── covers, isolation, highlight ───────────────────────────

  /** Markings on covers, by the cover mesh's name: they fade with it. */
  private decals = new Map<string, Mesh>();

  private prepareCovers() {
    this.rig.root.traverse((o) => {
      if (o.name.startsWith('marking:')) this.decals.set(o.name.slice(8), o as Mesh);
    });
    this.covers = this.rig.meshes.map((rm) => {
      const ghost = new Mesh(rm.mesh.geometry, rm.ghost);
      ghost.visible = false;
      ghost.renderOrder = 5;
      ghost.name = rm.mesh.name + ':ghost';
      rm.mesh.parent!.add(ghost);
      rm.mesh.geometry.computeBoundingSphere();
      return { rm, ghost, g: 0, centre: rm.mesh.geometry.boundingSphere!.center.clone() };
    });
  }

  private isCover(rm: RobotMesh): boolean {
    return rm.sub === 'shell' || rm.sub === 'head' || rm.part === 'visor';
  }

  private applyCovers() {
    const x = this.ch.get('xray');
    const iso = this.ch.get('isolate');
    const focus = this.scene.focus;
    // an opened actuator is the subject: the robot around it recedes to a faint outline, and
    // everything away from the actuator's limb fades out altogether (stacked ghosts of the
    // torso and the other limbs would only be clutter behind the parts)
    const ex = this.ch.get('explode');
    const subject = ex > 0.001 ? this.assemblyCentre() : null;
    for (const c of this.covers) {
      let ghostK = 1 - 0.72 * ex;
      if (subject) {
        const d = _cw.copy(c.centre).applyMatrix4(c.rm.mesh.matrixWorld).distanceTo(subject);
        const near = 1 - smoothstep(0.22, 0.55, d);
        ghostK = 1 - ex * (0.72 + 0.26 * (1 - near));
      }
      const rm = c.rm;
      // the opened actuator's exterior is replaced by its assembly
      const hidden = this.assemblyHides(rm);
      let g = this.isCover(rm) ? x : 0;
      if (focus && !focus.includes(rm.sub)) g = Math.max(g, iso * (this.isCover(rm) ? 1 : 0.92));
      // an opened cover is out of the way: it only fades as it lifts off
      const op = this.openings.opening(rm.part);
      if (op > 0) g = g * (1 - op) + 0.55 * op;
      c.g = g;
      if (hidden) {
        rm.mesh.visible = false;
        c.ghost.visible = false;
        continue;
      }
      rm.mesh.visible = g < 0.985;
      if (g < 0.002) {
        if (rm.mesh.material !== rm.solid) rm.mesh.material = rm.solid;
      } else {
        if (rm.mesh.material !== rm.fade) rm.mesh.material = rm.fade;
        rm.fade.opacity = 1 - g;
        rm.fade.depthWrite = g < 0.5;
      }
      c.ghost.visible = g > 0.002;
      const decal = this.decals.get(rm.mesh.name);
      if (decal) {
        (decal.material as import('three').MeshPhysicalMaterial).opacity = Math.max(0, 1 - g * 1.6);
        decal.visible = g < 0.6 && rm.mesh.visible;
      }
      (c.ghost.material as import('three').ShaderMaterial).uniforms.uOpacity.value = g * ghostK;
      // highlight (hover)
      const h = this.highlight.get(rm.sub) ?? 0;
      rm.solid.userData.fab.uHighlight.value = h;
    }
  }

  private updateHighlight(dt: number) {
    const groups: VisualGroup[] = ['structure', 'actuator', 'shell', 'power', 'compute', 'sensor', 'hand', 'wiring', 'head'];
    for (const g of groups) {
      const target = this.hover === g ? 1 : 0;
      const cur = this.highlight.get(g) ?? 0;
      this.highlight.set(g, cur + (target - cur) * Math.min(1, dt * 8));
    }
  }

  // ─────────────────────────── the opened actuators ───────────────────────────

  private buildAssemblies() {
    const defs: { key: 'knee' | 'hip' | 'elbow'; part: string; fam: typeof ACTUATORS.A100 }[] = [
      { key: 'knee', part: 'act:L_knee', fam: ACTUATORS.A100 },
      { key: 'hip', part: 'act:L_hip_pitch', fam: ACTUATORS.A100 },
      { key: 'elbow', part: 'act:L_elbow', fam: ACTUATORS.A80 },
    ];
    for (const d of defs) {
      const holder = this.rig.parts.get(d.part) as Group | undefined;
      if (!holder) continue;
      // The exterior was built along +Y from its rear cap and placed with a matrix; recover
      // it from the part's first mesh by rebuilding the same placement: the assembly shares
      // the exterior's local frame, so we mount it with the same transform.
      const asm = new ActuatorAssembly(d.fam);
      const mount = new Group();
      mount.name = `${d.part}:assembly`;
      const frameM = this.rig.partFrames.get(d.part) ?? new Matrix4();
      frameM.decompose(mount.position, mount.quaternion, mount.scale);
      holder.add(mount);
      mount.add(asm.root);
      mount.visible = false;
      this.assemblies[d.key] = { asm, holder: mount, part: d.part, axis: new Vector3(), base: frameM.clone() };
    }
  }

  /**
   * The actuator shown opened (its exterior hidden, its assembly out) — which lags the one
   * selected: a change of actuator while one is open closes and retracts the open one first,
   * then slides out and opens the new one, while the camera travels between them. Reversing
   * midway re-opens the one still out, from where it is.
   */
  shownActuator: 'knee' | 'hip' | 'elbow' = 'knee';
  /** The actuator the open view's camera frames (moves on once the old one has closed). */
  framedActuator: 'knee' | 'hip' | 'elbow' = 'knee';

  private updateAssemblies(dt: number) {
    const st = useApp.getState();
    const sel = st.actuator;
    const out = this.ch.get('actuatorOut');
    const ex = this.ch.get('explode');
    const wantOut = this.scene.channels.actuatorOut ?? 0;
    const wantEx = this.scene.channels.explode ?? 0;
    if (sel !== this.shownActuator) {
      if (out < 0.001 && ex < 0.001) {
        // the old one is home: the new one is the subject now
        this.shownActuator = sel;
        this.telemetry.mark('actuator-subject', sel);
        if (wantOut > 0 || wantEx > 0) this.ch.toSome({ actuatorOut: wantOut, explode: wantEx });
      } else if (this.ch.target('actuatorOut') > 0 || this.ch.target('explode') > 0) this.ch.toSome({ actuatorOut: 0, explode: 0 }, 0.72, 0.6);
    } else if ((wantOut > 0 || wantEx > 0) && (this.ch.target('actuatorOut') !== wantOut || this.ch.target('explode') !== wantEx)) {
      // back to the one still out (a reversal): open it again from where it is
      this.ch.toSome({ actuatorOut: wantOut, explode: wantEx });
    }
    // the camera stays on the one closing until it is nearly home, then moves to the next
    const framed = sel !== this.shownActuator && ex < 0.15 && out < 0.5 ? sel : this.shownActuator;
    if (framed !== this.framedActuator) {
      this.framedActuator = framed;
      if (this.sceneId === 'explore.actuators.open') this.director.go(this.scene.shot(this), { replan: true });
    }
    // the part in focus must exist in the actuator shown
    const shown = this.assemblies[this.shownActuator];
    if (st.part && shown && !shown.asm.parts.some((p) => p.id === st.part)) useApp.getState().set({ part: null });
    // the motor turns at its real duty-cycle speed, slowed (see features/actuatorLive)
    this.rotorAngle = this.actuatorLive.angle;
    const o2 = this.ch.get('actuatorOut');
    const e2 = this.ch.get('explode');
    for (const key of Object.keys(this.assemblies) as ('knee' | 'hip' | 'elbow')[]) {
      const a = this.assemblies[key]!;
      const on = key === this.shownActuator && (o2 > 0.001 || e2 > 0.001);
      a.holder.visible = on;
      if (!on) {
        // home in the limb (the camera may already be framing it)
        a.holder.position.setFromMatrixPosition(a.base);
        continue;
      }
      // outwards along the actuator's axis (its rear direction, away from the joint)
      const dir = _dir.set(0, -1, 0).applyQuaternion(a.holder.quaternion);
      a.holder.position.setFromMatrixPosition(a.base).addScaledVector(dir, 0.1 * o2);
      a.asm.update(e2, this.rotorAngle);
      const part = st.part;
      this.partFocus += ((part ? 1 : 0) - this.partFocus) * (1 - Math.exp(-dt * 5));
      if (part) this.focusedPart = part;
      a.asm.setFocus(this.partFocus > 0.002 ? this.focusedPart : null, this.partFocus * e2);
    }
  }

  private assemblyHides(rm: RobotMesh): boolean {
    const a = this.assemblies[this.shownActuator];
    if (!a || !rm.part) return false;
    const on = this.ch.get('actuatorOut') > 0.001 || this.ch.get('explode') > 0.001;
    return on && (rm.part === a.part || rm.part === `${a.part}:out`);
  }

  // ─────────────────────────── frame ───────────────────────────

  /**
   * One frame. `dt` is the frame's time. The demonstration — the robot, grasps and gait, the
   * belt, actuators, heat and charge, scene transitions and the tour's timeline — runs on the
   * presentation clock, which stops while the tour is paused (the interface, the visitor's
   * own camera moves and hover highlights keep the real clock). Nothing catches up on resume.
   */
  step(dt: number, render = true) {
    const pdt = this.presentationPaused ? 0 : dt;
    this.ch.update(pdt);
    this.updateHighlight(dt);
    // gaze
    const gz = this.scene.gaze;
    if (gz === 'camera') this.idle.gaze = (this.idle.gaze ?? new Vector3()).copy(this.stage.camera.position);
    else if (gz === 'cart') this.idle.gaze = (this.idle.gaze ?? new Vector3()).set(0.05, 0.95, 0.75);
    else this.idle.gaze = null;
    this.driver.update(pdt);
    this.rig.apply(this.driver.out, this.driver.hands);
    this.rig.root.updateMatrixWorld(true);
    this.lab.moveBelt(this.walk.beltNow - this.lab.beltOffset);
    this.applyCovers();
    // the actuator's duty cycle steps before the assemblies read its rotor (no frame of lag)
    this.actuatorLive.update(this, pdt);
    this.updateAssemblies(pdt);
    this.limits.update();
    // objects disturbed in the manipulation lab go back while the cart is away
    if (this.manip.disturbed && this.driver.source !== this.manip && this.driver.target !== this.manip && this.ch.get('cart') < 0.002) {
      this.manip.putBack();
      this.telemetry.mark('cart-reset');
    }
    const src = this.driver.source;
    this.overlays.push = src === this.balance ? this.balance.pushArrow : null;
    this.overlays.extra = src === this.manip ? this.manip.forces : [];
    for (const f of this.features) if (f !== this.actuatorLive) f.update(this, pdt);
    for (const cb of this.onFrame) cb(this, pdt);
    if (time.now - this.readoutsAt > 0.1) {
      this.readoutsAt = time.now;
      publishReadouts(this);
      this.measureFree();
      const off = this.director.offFraming && this.director.canOrbit();
      if (off !== useApp.getState().offFraming) useApp.setState({ offFraming: off });
    }
    this.tour.update(pdt, dt);
    this.kin.update(this.driver.out);
    this.proxies.update(this.kin);
    this.director.update(pdt, dt);
    this.telemetry.record(this, dt);
    if (render) {
      this.stage.render(dt);
      this.vision.renderInto(this);
    }
  }

  resize(w: number, h: number) {
    this.stage.resize(w, h);
  }

  /**
   * The part of the view the interface leaves free, for the camera's framing: measured from the
   * page (the header, and whichever side panel, phone sheet or caption bar is showing), so a
   * collapsed sheet or a turned phone reframes the subject without per-device rules.
   */
  private measureFree() {
    if (typeof document === 'undefined') return;
    const c = this.stage.canvas.getBoundingClientRect();
    if (c.width < 2 || c.height < 2) return;
    const f = { l: 0, t: 0, r: 1, b: 1 };
    for (const el of document.querySelectorAll<HTMLElement>('.ui header.top, .ui aside.side, .ui .watchbar')) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const l = (r.left - c.left) / c.width;
      const rt = (r.right - c.left) / c.width;
      const t = (r.top - c.top) / c.height;
      const b = (r.bottom - c.top) / c.height;
      if (b - t > 0.5 && l > 0.4) f.r = Math.min(f.r, l);
      else if (b - t > 0.5 && rt < 0.6) f.l = Math.max(f.l, rt);
      else if (b > 0.7) f.b = Math.min(f.b, t);
      else if (t < 0.3) f.t = Math.max(f.t, b);
    }
    const d = this.director.free;
    if (Math.abs(d.l - f.l) + Math.abs(d.t - f.t) + Math.abs(d.r - f.r) + Math.abs(d.b - f.b) > 0.004) {
      this.director.free = f;
      // the first layout with the interface on screen: frame for it at once (the page is
      // appearing), afterwards ease (a sheet collapsing, a phone turning)
      if (!this.framedLayout && f.t > 0) {
        this.framedLayout = true;
        this.director.snapFraming();
      }
    }
  }
  private framedLayout = false;

  /**
   * A tour chapter's physical starting point: no limits scenario, no push waiting, the cart's
   * objects where they belong (put back at once if the cart is away, or by the robot if it is
   * holding one), and the charge and temperatures of `energy`.
   */
  prepareChapter(energy: import('../engine/power').EnergySnapshot | null) {
    if (this.limits.active) this.limits.restore();
    this.balance.cancelPush();
    if (this.driver.source === this.manip || this.driver.target === this.manip) this.manip.restart();
    else if (this.manip.disturbed || this.manip.stage !== 'rest') this.manip.putBack();
    if (energy) this.energy.restore(energy);
    this.telemetry.mark('chapter-reset');
  }

  /** What is presented, as plain numbers (pose, hands, feet, objects, channels, belt, rotor,
   * charge and temperatures, camera, the tour's clock). */
  presentedState() {
    const o = this.driver.out;
    const r = (v: number) => Math.round(v * 1e6) / 1e6;
    const objs: Record<string, number[]> = {};
    for (const [id, p] of this.trackedObjects()) objs[id] = [r(p.x), r(p.y), r(p.z)];
    const e = this.energy.snapshot();
    const cam = this.stage.camera.position;
    return {
      q: Array.from(o.q, r),
      pelvis: [r(o.pelvisPos.x), r(o.pelvisPos.y), r(o.pelvisPos.z)],
      hands: this.displayedHandScalars().map(r),
      feet: [this.driver.feet.L.ankle, this.driver.feet.R.ankle].flatMap((a) => [r(a.x), r(a.y), r(a.z)]),
      objects: objs,
      channels: Object.fromEntries(Object.entries(this.ch.values).map(([k, v]) => [k, r(v)])),
      belt: r(this.walk.beltNow),
      rotor: r(this.rotorAngle),
      soc: Math.round(e.soc * 1e9) / 1e9,
      temps: e.thermal.filter((x): x is [number, number] => !!x).map((x) => r(x[0])),
      camera: [r(cam.x), r(cam.y), r(cam.z)],
      tourT: r(this.tour.t),
      config: JSON.stringify(useApp.getState().config),
      source: this.driver.source?.id ?? '',
      stage: this.manip.stage,
    };
  }

  // ─────────────────────────── telemetry accessors ───────────────────────────

  /** The displayed hand pose as numbers (both hands: four fingers, thumb flexion, opposition, spread). */
  displayedHandScalars(): number[] {
    const o = new Array<number>(HAND_N * 2);
    handToArray(this.rig.hands.L, o, 0);
    handToArray(this.rig.hands.R, o, HAND_N);
    return o;
  }

  /** Movable objects the visitor sees, by name (world positions). */
  trackedObjects(): [string, Vector3][] {
    const o: [string, Vector3][] = Object.entries(this.manip.objects);
    o.push(['liftBox', this.balance.box]);
    return o;
  }

  /** Distance from a held cart object to where the displayed hand holds it (m; -1: nothing held). */
  holdAttachmentError(): number {
    if (this.driver.source !== this.manip || !this.manip.held) return -1;
    const exp = this.manip.expectedCentre(this.kin);
    return exp ? exp.distanceTo(this.manip.objects[this.manip.item.id]) : -1;
  }

  visibleAssemblies(): string[] {
    return (Object.keys(this.assemblies) as ('knee' | 'hip' | 'elbow')[]).filter((k) => this.assemblies[k]!.holder.visible);
  }

  /** The demonstration is paused (the guided tour's pause, once a chapter change has settled). */
  get presentationPaused(): boolean {
    return this.tour.holdsPresentation;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const u of this.unsub) u();
    this.unsub = [];
    for (const f of this.features) f.dispose?.();
    // GPU resources: every geometry, material and texture the scene owns, then the context
    const geos = new Set<{ dispose(): void }>();
    const mats = new Set<import('three').Material>();
    this.stage.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) geos.add(m.geometry);
      const mm = m.material as import('three').Material | import('three').Material[] | undefined;
      if (Array.isArray(mm)) mm.forEach((x) => mats.add(x));
      else if (mm) mats.add(mm);
    });
    for (const c of this.covers) (mats.add(c.rm.fade), mats.add(c.rm.solid));
    for (const m of mats) {
      for (const v of Object.values(m)) if (v && typeof v === 'object' && (v as { isTexture?: boolean }).isTexture) (v as { dispose(): void }).dispose();
      m.dispose();
    }
    for (const g of geos) g.dispose();
    this.stage.dispose();
  }

  get time() {
    return time.now;
  }
}

const _dir = new Vector3();
const _cw = new Vector3();
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function frame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export { Pose, Quaternion };
