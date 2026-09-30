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
import { Kinematics, Pose, restPose } from '../engine/skeleton';
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
import { Props } from './features/props';
import { RIG_PIVOT } from './props/rig';
import { Limits } from './limits';
import { TourRunner } from './tourRunner';
import { publishReadouts } from './readouts';
import { Mesh, Group, Matrix4, Quaternion } from 'three';

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

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas);
    this.lab = new Lab();
    this.stage.scene.add(this.lab.group);
    this.director = new Director(this.stage.camera);
    const cfg = useApp.getState().config;
    this.model = new RobotModel(cfg);
    this.kin = new Kinematics(cfg.scale);
    this.energy = new BodyEnergy(this.model);
    this.driver = new PoseDriver(cfg.scale);
    this.idle = new IdleSource(() => this.model, new Kinematics(cfg.scale));
    this.walk = new WalkSource(() => this.model, new Kinematics(cfg.scale), () => this.energy);
    this.balance = new BalanceSource(() => this.model, new Kinematics(cfg.scale));
    this.exercise = new BalanceSource(() => this.model, new Kinematics(cfg.scale));
    this.exercise.exercise = true;
    this.exercise.id = 'exercise';
    this.reach = new ReachSource(() => this.model, new Kinematics(cfg.scale));
    this.manip = new ManipSource(() => this.model, new Kinematics(cfg.scale));
    this.sources = { idle: this.idle, walk: this.walk, balance: this.balance, exercise: this.exercise, reach: this.reach, manip: this.manip };
    this.overlays = new Overlays(this.body);
    this.limits = new Limits(this);
    this.tour = new TourRunner(this);
    this.stage.scene.add(this.overlays.group);
    this.labels = new Labels(canvas.parentElement!, canvas);
    this.lab.group.name = 'lab';
    this.stage.scene.add(this.flows.group, this.props.group, this.vision.frustum);
    this.props.ik.attach(this, canvas);
    this.features.push(this.body, this.actuatorLive, this.look, this.props, this.overlays, this.flows, this.vision, this.labels);
    this.unsub.push(this.director.attach(canvas));
    this.stage.onResize = (w, h) => {
      this.director.viewW = w;
      this.director.viewH = h;
      this.director.compact = w < 760;
    };
  }

  /** Build the robot and prepare the GPU; `progress` reports 0 … 1. */
  async init(progress: (p: number) => void) {
    progress(0.1);
    await frame();
    const cfg = useApp.getState().config;
    this.rig = buildRobot({ scale: cfg.scale, parallel: cfg.pack.parallel });
    this.stage.scene.add(this.rig.root);
    this.prepareCovers();
    this.openings.init(this);
    this.features.unshift(this.openings);
    progress(0.45);
    await frame();
    // first pose, first camera
    const p = restPose();
    p.pelvisPos.set(0, 0.89, 0);
    this.driver.out.copy(p);
    this.driver.use(this.idle, 0.01);
    this.driver.update(1 / 60);
    this.rig.apply(this.driver.out);
    this.applyScene('intro', true);
    progress(0.6);
    await frame();
    this.buildAssemblies();
    progress(0.75);
    await frame();
    await this.stage.prewarm();
    progress(1);
    // follow the app store
    this.unsub.push(useApp.subscribe((s, prev) => this.onStore(s, prev)));
    this.unsub.push(useLab.subscribe(() => this.onLab()));
    this.onLab();
    if (TEST_HOOKS) {
      const w = window as unknown as Record<string, unknown>;
      w.__fab = this;
      w.__fabStores = { useApp, useLab };
      // advance n frames; with render=false only the last frame is drawn (fast recording)
      w.__fabAdvance = (n = 1, render = true) => {
        for (let i = 0; i < n; i++) this.step(tickVirtual(), render || i === n - 1);
      };
      w.__fabTime = () => {
        const t0 = performance.now();
        this.step(tickVirtual(), false);
        const t1 = performance.now();
        this.stage.render(1 / 30);
        return { logic: t1 - t0, render: performance.now() - t1 };
      };
    }
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
    if (s.mode !== prev.mode || s.system !== prev.system || s.lab !== prev.lab || s.exploded !== prev.exploded || s.actuator !== prev.actuator || s.limit !== prev.limit) {
      if (s.mode !== 'watch') this.applyScene(this.sceneFor(s));
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
    if (this.driver.source === this.walk && this.sceneId !== 'sim.wholebody') {
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
    this.ch.to(def.channels);
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
    this.driver.use(src, instant ? 0.01 : 1.0);
    if (kind === 'walk') {
      const l = useLab.getState();
      this.walk.carry = l.carry;
      if (l.walking || id === 'sim.wholebody') this.walk.start(GAITS[l.gait]);
    }
  }

  private applyConfig() {
    const cfg = useApp.getState().config;
    this.model = new RobotModel(cfg);
    this.energy.setModel(this.model);
  }

  // ─────────────────────────── queries used by shots and features ───────────────────────────

  anchor(name: string, out = new Vector3()): Vector3 {
    return this.rig.anchorWorld(name, out);
  }

  /** Middle of the opened actuator's parts, following the slide-out and the explode. */
  assemblyCentre(): Vector3 {
    const a = this.assemblies[useApp.getState().actuator];
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

  // ─────────────────────────── covers, isolation, highlight ───────────────────────────

  private prepareCovers() {
    this.covers = this.rig.meshes.map((rm) => {
      const ghost = new Mesh(rm.mesh.geometry, rm.ghost);
      ghost.visible = false;
      ghost.renderOrder = 5;
      ghost.name = rm.mesh.name + ':ghost';
      rm.mesh.parent!.add(ghost);
      return { rm, ghost, g: 0 };
    });
  }

  private isCover(rm: RobotMesh): boolean {
    return rm.sub === 'shell' || rm.sub === 'head' || rm.part === 'visor';
  }

  private applyCovers() {
    const x = this.ch.get('xray');
    const iso = this.ch.get('isolate');
    const focus = this.scene.focus;
    // an opened actuator is the subject: the robot around it recedes to a faint outline
    const ghostK = 1 - 0.72 * this.ch.get('explode');
    for (const c of this.covers) {
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

  /** Slide the selected actuator out of the limb, open it up, turn its motor. */
  private updateAssemblies(dt: number) {
    const sel = useApp.getState().actuator;
    const out = this.ch.get('actuatorOut');
    const ex = this.ch.get('explode');
    // the motor turns at its real duty-cycle speed, slowed (see features/actuatorLive)
    this.rotorAngle = this.actuatorLive.angle;
    for (const key of Object.keys(this.assemblies) as ('knee' | 'hip' | 'elbow')[]) {
      const a = this.assemblies[key]!;
      const on = key === sel && (out > 0.001 || ex > 0.001);
      a.holder.visible = on;
      if (!on) continue;
      // outwards along the actuator's axis (its rear direction, away from the joint)
      const dir = new Vector3(0, -1, 0).applyQuaternion(a.holder.quaternion);
      const basePos = new Vector3().setFromMatrixPosition(a.base);
      a.holder.position.copy(basePos).addScaledVector(dir, 0.1 * out);
      a.asm.update(ex, this.rotorAngle);
      const part = useApp.getState().part;
      this.partFocus += ((part ? 1 : 0) - this.partFocus) * Math.min(1, dt * 5);
      if (part) this.focusedPart = part;
      a.asm.setFocus(this.partFocus > 0.002 ? this.focusedPart : null, this.partFocus * ex);
    }
  }

  private assemblyHides(rm: RobotMesh): boolean {
    const sel = useApp.getState().actuator;
    const a = this.assemblies[sel];
    if (!a || !rm.part) return false;
    const on = this.ch.get('actuatorOut') > 0.001 || this.ch.get('explode') > 0.001;
    return on && (rm.part === a.part || rm.part === `${a.part}:out`);
  }

  // ─────────────────────────── frame ───────────────────────────

  step(dt: number, render = true) {
    this.ch.update(dt);
    this.updateHighlight(dt);
    // gaze
    const gz = this.scene.gaze;
    this.idle.gaze = gz === 'camera' ? this.stage.camera.position.clone() : gz === 'cart' ? new Vector3(0.05, 0.95, 0.75) : null;
    this.driver.update(dt);
    this.rig.apply(this.driver.out);
    this.rig.root.updateMatrixWorld(true);
    this.lab.moveBelt(this.walk.beltNow - this.lab.beltOffset);
    this.applyCovers();
    this.updateAssemblies(dt);
    this.limits.update();
    const src = this.driver.source;
    this.overlays.push = src === this.balance ? this.balance.pushArrow : null;
    this.overlays.extra = src === this.manip ? this.manip.forces : [];
    for (const f of this.features) f.update(this, dt);
    for (const cb of this.onFrame) cb(this, dt);
    if (time.now - this.readoutsAt > 0.1) {
      this.readoutsAt = time.now;
      publishReadouts(this);
    }
    this.tour.update(dt);
    this.director.update(dt);
    if (render) {
      this.stage.render(dt);
      this.vision.renderInto(this);
    }
  }

  resize(w: number, h: number) {
    this.stage.resize(w, h);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const u of this.unsub) u();
    for (const f of this.features) f.dispose?.();
    this.stage.dispose();
  }

  get time() {
    return time.now;
  }
}

function frame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export { Pose, Quaternion };
