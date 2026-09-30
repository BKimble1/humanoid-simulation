/**
 * FO-H1's markings, kept quiet: the designation on the backpack and the outside of the left
 * thigh, the maker's name small on the chest. Each is a small decal found by casting a ray at
 * the shell it belongs on, so it sits on the real surface (0.6 mm off it, facing out) whatever
 * the shell's curvature; it follows the cover when it fades or opens.
 */
import { Mesh, MeshPhysicalMaterial, PlaneGeometry, Quaternion, Raycaster, Vector3, type Object3D } from 'three';
import { markingTexture } from '../materials';
import type { RobotRig } from './rig';

interface Mark {
  /** The mesh to put it on (by name: "segment:subsystem[:part]"). */
  on: string;
  /** Ray origin and direction in the segment's frame. */
  from: [number, number, number];
  dir: [number, number, number];
  text: { text: string; size: number; weight?: number; tracking?: number }[];
  width: number;
  color: string;
  /** Rotate the text about the surface normal (rad). */
  spin?: number;
}

const MARKS: Mark[] = [
  { on: 'torso:shell', from: [0, 0.3, -0.4], dir: [0, 0, 1], text: [{ text: 'FO-H1', size: 62, weight: 700, tracking: 10 }], width: 0.085, color: '#c3c6cc' },
  { on: 'torso:shell:chest', from: [0.062, 0.345, 0.4], dir: [0, 0, -1], text: [{ text: 'FAB / ONE', size: 44, weight: 600, tracking: 8 }], width: 0.056, color: '#34363b' },
  { on: 'L_thigh:shell', from: [0.4, -0.2, 0.0], dir: [-1, 0, 0], text: [{ text: 'FO-H1', size: 62, weight: 700, tracking: 10 }], width: 0.06, color: '#2a2c30', spin: Math.PI / 2 },
];

export function addMarkings(rig: RobotRig) {
  const ray = new Raycaster();
  for (const m of MARKS) {
    const target = rig.meshes.find((r) => r.mesh.name === m.on)?.mesh;
    if (!target) continue;
    const parent = target.parent as Object3D;
    // cast in the parent's (segment's) frame: meshes are built in it with identity transforms
    ray.set(new Vector3(...m.from), new Vector3(...m.dir).normalize());
    const hit = ray.intersectObject(target, false)[0];
    if (!hit || !hit.face) continue;
    const tex = markingTexture(
      m.text.map((t) => ({ ...t, y: 64, x: 256, align: 'center' as CanvasTextAlign, color: m.color })),
      512,
      128,
    );
    const mat = new MeshPhysicalMaterial({ map: tex, transparent: true, roughness: 0.5, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const decal = new Mesh(new PlaneGeometry(m.width, m.width / 4), mat);
    const n = hit.face.normal.clone().normalize();
    decal.position.copy(hit.point).addScaledVector(n, 0.0006);
    decal.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), n);
    if (m.spin) decal.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), m.spin));
    decal.renderOrder = 6;
    decal.name = `marking:${m.on}`;
    decal.userData.robot = true;
    parent.add(decal);
  }
}
