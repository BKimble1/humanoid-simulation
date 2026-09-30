/**
 * The robot's scene graph: one Group per kinematic segment, nested exactly as the kinematic
 * tree in engine/skeleton.ts, so what is drawn and what is calculated can never disagree. A
 * pose (engine Pose) is applied by setting each joint group's rotation about its axis.
 *
 * Geometry is collected by the builder per (segment, look, subsystem[, part]) and merged into
 * one mesh per key: a few hundred draw calls for the whole robot. Named parts (the chest cover,
 * an actuator that explodes, a finger phalanx) stay separate objects.
 */
import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import { clean } from '../geo/merge';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { JOINTS, type SegmentId, type Subsystem } from '../../spec/body';
import { type LimbScale, UNIT_SCALE, jointOrigin, type Pose, SEGMENTS } from '../../engine/skeleton';
import { fadeTwin, ghostMaterial, lookAttributes, robotSurface, type FabMaterial, type LookName } from '../materials';

export type VisualGroup = Subsystem | 'hand' | 'head';

export interface RobotMesh {
  mesh: Mesh;
  seg: SegmentId;
  sub: VisualGroup;
  part?: string;
  /** Looks merged into this mesh (for reports and tests). */
  looks: Set<LookName>;
  solid: FabMaterial;
  fade: FabMaterial;
  ghost: ReturnType<typeof ghostMaterial>;
}

export { clean };

interface Pending {
  seg: SegmentId;
  sub: VisualGroup;
  part?: string;
  geos: { g: BufferGeometry; look: LookName }[];
  castShadow: boolean;
  parent?: Object3D;
}

/** Give a geometry constant per-vertex material attributes from a look. */
function withLook(g: BufferGeometry, look: LookName): BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = lookAttributes(look);
  const color = new Float32Array(n * 3);
  const pbr = new Float32Array(n * 4);
  const emit = new Float32Array(n * 3);
  const noise = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    color[i * 3] = a.color.r;
    color[i * 3 + 1] = a.color.g;
    color[i * 3 + 2] = a.color.b;
    pbr.set(a.pbr, i * 4);
    emit[i * 3] = a.emit.r;
    emit[i * 3 + 1] = a.emit.g;
    emit[i * 3 + 2] = a.emit.b;
    noise[i * 2] = a.noise[0];
    noise[i * 2 + 1] = a.noise[1];
  }
  g.setAttribute('color', new BufferAttribute(color, 3));
  g.setAttribute('aPbr', new BufferAttribute(pbr, 4));
  g.setAttribute('aEmit', new BufferAttribute(emit, 3));
  g.setAttribute('aNoise', new BufferAttribute(noise, 2));
  return g;
}

export class RobotRig {
  root = new Group();
  seg = new Map<SegmentId, Group>();
  /** The group each joint rotates (its child segment), and the joint's rest transform. */
  private jointGroups: { g: Group; axis: Vector3; origin: Vector3 }[] = [];
  meshes: RobotMesh[] = [];
  parts = new Map<string, Object3D>();
  /** Named points on the robot (for labels, camera framing, overlays), per segment. */
  anchors = new Map<string, { seg: SegmentId; local: Vector3 }>();
  private pending = new Map<string, Pending>();
  scale: LimbScale = { ...UNIT_SCALE };
  /** Called after each pose is applied (linkages, rods, fingers). */
  onPose: ((rig: RobotRig) => void)[] = [];

  constructor() {
    this.root.name = 'FO-H1';
    for (const s of SEGMENTS) {
      const g = new Group();
      g.name = s;
      this.seg.set(s, g);
    }
    this.root.add(this.seg.get('pelvis')!);
    for (const j of JOINTS) {
      const parent = this.seg.get(j.parent)!;
      const child = this.seg.get(j.child)!;
      parent.add(child);
      const origin = jointOrigin(j, this.scale);
      child.position.copy(origin);
      this.jointGroups.push({ g: child, axis: new Vector3(...j.axis), origin });
    }
  }

  /** Geometry for a segment (merged later with everything of the same key). */
  add(seg: SegmentId, look: LookName, sub: VisualGroup, geo: BufferGeometry, opts: { part?: string; m?: Matrix4; castShadow?: boolean } = {}) {
    const key = `${seg}|${sub}|${opts.part ?? ''}`;
    let p = this.pending.get(key);
    if (!p) {
      p = { seg, sub, part: opts.part, geos: [], castShadow: opts.castShadow ?? true };
      this.pending.set(key, p);
    }
    const g = opts.m ? geo.clone().applyMatrix4(opts.m) : geo;
    p.geos.push({ g: clean(g), look });
  }

  /**
   * A separate object: its geometry is added under `part` and parented to `holder` (created
   * and attached to the segment if not given), so it can move on its own.
   */
  holder(seg: SegmentId, part: string, at?: Matrix4): Group {
    let h = this.parts.get(part) as Group | undefined;
    if (!h) {
      h = new Group();
      h.name = part;
      if (at) at.decompose(h.position, h.quaternion, h.scale);
      this.seg.get(seg)!.add(h);
      this.parts.set(part, h);
    }
    return h;
  }

  addTo(holder: Group, seg: SegmentId, look: LookName, sub: VisualGroup, geo: BufferGeometry, part: string, m?: Matrix4) {
    const key = `${seg}|${sub}|${part}`;
    let p = this.pending.get(key);
    if (!p) {
      p = { seg, sub, part, geos: [], castShadow: true, parent: holder };
      this.pending.set(key, p);
    }
    const g = m ? geo.clone().applyMatrix4(m) : geo;
    p.geos.push({ g: clean(g), look });
  }

  anchor(name: string, seg: SegmentId, local: Vector3 | [number, number, number]) {
    this.anchors.set(name, { seg, local: Array.isArray(local) ? new Vector3(...local) : local.clone() });
  }

  /** Merge everything collected into meshes: one per (segment, subsystem, part). */
  finalize() {
    for (const p of this.pending.values()) {
      const parts = p.geos.map(({ g, look }) => withLook(g, look));
      const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
      if (!geo) continue;
      geo.computeBoundingSphere();
      const solid = robotSurface(`${p.seg}:${p.sub}:${p.part ?? ''}`);
      const fade = fadeTwin(solid);
      const ghost = ghostMaterial();
      const mesh = new Mesh(geo, solid);
      mesh.castShadow = p.castShadow;
      mesh.receiveShadow = true;
      mesh.name = `${p.seg}:${p.sub}${p.part ? ':' + p.part : ''}`;
      mesh.userData.robot = true;
      (p.parent ?? this.seg.get(p.seg)!).add(mesh);
      this.meshes.push({ mesh, seg: p.seg, sub: p.sub, part: p.part, looks: new Set(p.geos.map((x) => x.look)), solid, fade, ghost });
    }
    this.pending.clear();
  }

  apply(pose: Pose) {
    const pel = this.seg.get('pelvis')!;
    pel.position.copy(pose.pelvisPos);
    pel.quaternion.copy(pose.pelvisQuat);
    for (let i = 0; i < this.jointGroups.length; i++) {
      const jg = this.jointGroups[i];
      jg.g.quaternion.setFromAxisAngle(jg.axis, pose.q[i]);
    }
    for (const f of this.onPose) f(this);
  }

  setScale(s: LimbScale) {
    this.scale = { ...s };
    JOINTS.forEach((j, i) => {
      const o = jointOrigin(j, this.scale);
      this.jointGroups[i].origin.copy(o);
      this.jointGroups[i].g.position.copy(o);
    });
  }

  /** World position of an anchor. */
  anchorWorld(name: string, out = new Vector3()): Vector3 {
    const a = this.anchors.get(name);
    if (!a) return out.set(0, 1, 0);
    return out.copy(a.local).applyMatrix4(this.seg.get(a.seg)!.matrixWorld);
  }

  /** World matrix of a segment. */
  segWorld(seg: SegmentId): Matrix4 {
    return this.seg.get(seg)!.matrixWorld;
  }
}
