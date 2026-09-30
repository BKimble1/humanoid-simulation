/**
 * Engineering overlays drawn in the scene: centre of mass, support polygon, capture point and
 * centre of pressure, ground-reaction forces, and each major joint's load as a ring around its
 * axis (green, amber, red as the torque approaches and passes the actuator's limits).
 *
 * All drawn on top of the robot (they describe its inside), thin and quiet; each group's
 * opacity follows its scene channel and the visitor's overlay switch. Vector lengths are
 * scaled for legibility (a visual approximation; the numbers are in the panels).
 */
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  ShapeGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { ACTUATORS } from '../../spec/actuators';
import { JOINTS, type JointId } from '../../spec/body';
import { JOINT_INDEX } from '../../engine/skeleton';
import { useApp } from '../../state/store';
import type { Feature, World } from '../world';
import type { BodyState } from './body';

const VIOLET = new Color('#9b8fff');
const FORCE = new Color('#ffc86b');
const OK = new Color('#43c992');
const WARN = new Color('#e4a73c');
const BAD = new Color('#ff6e5e');

function mat(color: Color | string, opacity = 1): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, side: DoubleSide });
}

/** An arrow along +Y from the origin, length set with setLength. */
export class Arrow extends Group {
  shaft: Mesh;
  head: Mesh;
  materials: MeshBasicMaterial[];
  constructor(color: Color, radius = 0.007) {
    super();
    const m = mat(color, 0.95);
    this.materials = [m];
    this.shaft = new Mesh(new CylinderGeometry(radius, radius, 1, 12).translate(0, 0.5, 0), m);
    this.head = new Mesh(new ConeGeometry(radius * 2.6, radius * 7, 16).translate(0, radius * 3.5, 0), m);
    this.add(this.shaft, this.head);
    this.renderOrder = 30;
    this.shaft.renderOrder = 30;
    this.head.renderOrder = 30;
  }
  set(from: Vector3, vec: Vector3, opacity: number) {
    const len = vec.length();
    this.visible = opacity > 0.01 && len > 0.01;
    if (!this.visible) return;
    this.position.copy(from);
    this.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), vec.clone().normalize());
    this.shaft.scale.set(1, Math.max(0.001, len - 0.045), 1);
    this.head.position.y = Math.max(0.001, len - 0.045);
    for (const m of this.materials) m.opacity = 0.95 * opacity;
  }
}

const LOAD_JOINTS: JointId[] = ['L_hip_pitch', 'R_hip_pitch', 'L_hip_roll', 'R_hip_roll', 'L_knee', 'R_knee', 'L_ankle_pitch', 'R_ankle_pitch', 'waist_yaw', 'L_shoulder_pitch', 'R_shoulder_pitch', 'L_elbow', 'R_elbow'];

export class Overlays implements Feature {
  group = new Group();
  body: BodyState;
  // balance
  private comDot: Mesh;
  private comHalo: Mesh;
  private comLine: Line;
  private comFloor: Mesh;
  private supportLine: Line;
  private supportFill: Mesh;
  private capture: Mesh;
  private cop: Mesh;
  // forces
  private arrows: Record<'L' | 'R', Arrow>;
  private pushArrow: Arrow;
  // loads
  private rings: { joint: number; mesh: Mesh; mat: MeshBasicMaterial; r: number }[] = [];
  /** External push to draw (world position, force vector N), set by the balance lab. */
  push: { at: Vector3; force: Vector3 } | null = null;
  /** Extra force arrows (wrists, fingertips), set by sources. */
  extra: { at: Vector3; force: Vector3 }[] = [];
  private extraArrows: Arrow[] = [];
  private ratio = new Map<number, number>();

  constructor(body: BodyState) {
    this.body = body;
    const g = this.group;
    g.name = 'overlays';
    this.comDot = new Mesh(new SphereGeometry(0.016, 20, 14), mat('#ffffff', 1));
    this.comHalo = new Mesh(new RingGeometry(0.024, 0.03, 40), mat(VIOLET, 0.9));
    this.comDot.renderOrder = this.comHalo.renderOrder = 32;
    const lg = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3));
    this.comLine = new Line(lg, new LineDashedMaterial({ color: VIOLET, dashSize: 0.025, gapSize: 0.018, transparent: true, depthTest: false, toneMapped: false }));
    this.comLine.renderOrder = 31;
    this.comFloor = new Mesh(new RingGeometry(0.018, 0.026, 40).rotateX(-Math.PI / 2), mat(VIOLET, 0.9));
    this.comFloor.renderOrder = 31;
    this.supportLine = new Line(new BufferGeometry(), new LineBasicMaterial({ color: '#e8eaf0', transparent: true, opacity: 0.8, depthTest: false, toneMapped: false }));
    this.supportFill = new Mesh(new BufferGeometry(), mat('#e8eaf0', 0.07));
    this.supportLine.renderOrder = this.supportFill.renderOrder = 29;
    this.capture = new Mesh(new RingGeometry(0.012, 0.02, 32).rotateX(-Math.PI / 2), mat(VIOLET, 0.9));
    this.cop = new Mesh(new SphereGeometry(0.011, 14, 10), mat(FORCE, 0.95));
    this.capture.renderOrder = this.cop.renderOrder = 31;
    g.add(this.comDot, this.comHalo, this.comLine, this.comFloor, this.supportLine, this.supportFill, this.capture, this.cop);
    this.arrows = { L: new Arrow(FORCE), R: new Arrow(FORCE) };
    this.pushArrow = new Arrow(new Color('#ff8a74'), 0.011);
    g.add(this.arrows.L, this.arrows.R, this.pushArrow);
    for (const id of LOAD_JOINTS) {
      const ji = JOINT_INDEX[id];
      const j = JOINTS[ji];
      const fam = j.actuator === 'ankle' ? null : ACTUATORS[j.actuator];
      const r = fam ? fam.housingOD / 2 + 0.012 : 0.05;
      const m = mat(OK, 0);
      const mesh = new Mesh(new TorusGeometry(r, 0.0032, 8, 64), m);
      mesh.renderOrder = 28;
      g.add(mesh);
      this.rings.push({ joint: ji, mesh, mat: m, r });
    }
  }

  private setPolygon(pts: { x: number; y: number }[]) {
    if (pts.length < 3) {
      this.supportLine.visible = this.supportFill.visible = false;
      return;
    }
    const pos: number[] = [];
    for (const p of pts) pos.push(p.x, 0.004, p.y);
    pos.push(pts[0].x, 0.004, pts[0].y);
    this.supportLine.geometry.dispose();
    this.supportLine.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pos, 3));
    const shape = new Shape(pts.map((p) => ({ x: p.x, y: -p.y }) as unknown as import('three').Vector2));
    this.supportFill.geometry.dispose();
    this.supportFill.geometry = new ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, 0.003, 0);
  }

  update(w: World, dt: number) {
    const show = useApp.getState().overlays ? 1 : 0;
    const bal = w.ch.get('balanceViz') * show;
    const frc = w.ch.get('forces') * show;
    const loads = w.ch.get('loads') * show;
    const b = this.body;
    // centre of mass
    const vis = bal > 0.01;
    for (const o of [this.comDot, this.comHalo, this.comLine, this.comFloor, this.capture, this.cop]) o.visible = vis;
    if (vis) {
      this.comDot.position.copy(b.com);
      this.comHalo.position.copy(b.com);
      this.comHalo.quaternion.copy(w.stage.camera.quaternion);
      (this.comDot.material as MeshBasicMaterial).opacity = bal;
      (this.comHalo.material as MeshBasicMaterial).opacity = 0.9 * bal;
      this.comLine.position.set(b.com.x, 0, b.com.z);
      this.comLine.scale.set(1, b.com.y, 1);
      this.comLine.computeLineDistances();
      (this.comLine.material as LineDashedMaterial).opacity = 0.85 * bal;
      this.comFloor.position.set(b.com.x, 0.004, b.com.z);
      (this.comFloor.material as MeshBasicMaterial).opacity = 0.9 * bal;
      this.setPolygon(b.support);
      (this.supportLine.material as LineBasicMaterial).opacity = 0.8 * bal;
      (this.supportFill.material as MeshBasicMaterial).opacity = 0.07 * bal;
      this.capture.position.set(b.capture.x, 0.005, b.capture.z);
      (this.capture.material as MeshBasicMaterial).opacity = 0.9 * bal;
      this.cop.position.set(b.zmp.x, 0.006, b.zmp.z);
      (this.cop.material as MeshBasicMaterial).opacity = 0.95 * bal;
    } else this.supportLine.visible = this.supportFill.visible = false;
    // ground reaction forces: 1 m per 1500 N
    for (const s of ['L', 'R'] as const) {
      const g = b.grf?.[s];
      if (!g || g.load < 0.01) {
        this.arrows[s].visible = false;
        continue;
      }
      this.arrows[s].set(g.cop.clone().setY(0.006), g.force.clone().multiplyScalar(1 / 1500), frc);
    }
    if (this.push) this.pushArrow.set(this.push.at.clone().sub(this.push.force.clone().multiplyScalar(1 / 900)), this.push.force.clone().multiplyScalar(1 / 900), Math.max(frc, bal));
    else this.pushArrow.visible = false;
    while (this.extraArrows.length < this.extra.length) {
      const a = new Arrow(FORCE, 0.005);
      this.extraArrows.push(a);
      this.group.add(a);
    }
    this.extraArrows.forEach((a, i) => {
      const e = this.extra[i];
      if (!e) a.visible = false;
      else a.set(e.at, e.force.clone().multiplyScalar(1 / 300), frc);
    });
    // joint loads: |τ| / τ_continuous, smoothed
    for (const r of this.rings) {
      r.mesh.visible = loads > 0.01;
      if (!r.mesh.visible) continue;
      const rat = w.model.actuatorRatings[r.joint];
      const cont = rat ? rat.continuousTorque : 90;
      const tau = Math.abs(b.tau[r.joint]);
      const prev = this.ratio.get(r.joint) ?? 0;
      const val = prev + (tau / cont - prev) * Math.min(1, dt * 6);
      this.ratio.set(r.joint, val);
      const c = val < 0.7 ? OK.clone().lerp(WARN, Math.max(0, (val - 0.4) / 0.3)) : val < 1 ? WARN.clone().lerp(BAD, (val - 0.7) / 0.3) : BAD.clone();
      r.mat.color.copy(c);
      r.mat.opacity = loads * (0.35 + 0.55 * Math.min(1, val));
      // at the joint, around its axis
      const pos = w.kin.jointPos[r.joint];
      const axis = w.kin.jointAxis[r.joint];
      r.mesh.position.copy(pos);
      r.mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), axis);
      const sc = 1 + 0.25 * Math.min(1.5, val);
      r.mesh.scale.set(sc, sc, 1);
    }
  }

  /** Current load ratio (|τ| / continuous) of a joint, smoothed. */
  loadRatio(joint: number): number {
    return this.ratio.get(joint) ?? 0;
  }
}

