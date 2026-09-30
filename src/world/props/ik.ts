/**
 * Kinematics lab in the scene: the target the hand reaches for (drag it), the arm's sampled
 * workspace as a faint point cloud, and the kinematic chain drawn as joint dots and links.
 * When the target is out of reach, a dashed line joins the palm to it.
 *
 * Dragging moves the target in the plane facing the camera through it; the handle captures
 * the pointer before the camera does, so dragging it never orbits the view.
 */
import { BufferGeometry, Color, Float32BufferAttribute, Group, Line, LineBasicMaterial, LineDashedMaterial, Mesh, MeshBasicMaterial, Plane, Points, PointsMaterial, Raycaster, SphereGeometry, TorusGeometry, Vector2, Vector3 } from 'three';
import { ARM_JOINTS } from '../../engine/ik';
import { JOINT_INDEX, Kinematics } from '../../engine/skeleton';
import { useApp, useLab } from '../../state/store';
import { sampleWorkspace } from '../sources/reach';
import type { World } from '../world';

const VIOLET = new Color('#9b8fff');
const BAD = new Color('#ff6e5e');

export class IkProp {
  root = new Group();
  private handle: Mesh;
  private ring: Mesh;
  private miss: Line;
  private cloud: Record<'L' | 'R', Points | null> = { L: null, R: null };
  private chain: Line;
  private dots: Mesh[] = [];
  private dragging = false;
  private hover = false;
  private plane = new Plane();
  private ray = new Raycaster();
  private off = new Vector3();
  private canvas: HTMLCanvasElement | null = null;
  private unsub: (() => void) | null = null;

  constructor() {
    this.root.name = 'ik';
    const hm = new MeshBasicMaterial({ color: VIOLET, transparent: true, depthTest: false, toneMapped: false });
    this.handle = new Mesh(new SphereGeometry(0.02, 24, 16), hm);
    this.handle.renderOrder = 40;
    this.ring = new Mesh(new TorusGeometry(0.034, 0.0022, 8, 48), new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthTest: false, toneMapped: false }));
    this.ring.renderOrder = 40;
    const mg = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 1], 3));
    this.miss = new Line(mg, new LineDashedMaterial({ color: BAD, dashSize: 0.012, gapSize: 0.01, transparent: true, depthTest: false, toneMapped: false }));
    this.miss.renderOrder = 40;
    this.chain = new Line(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(new Array(3 * 9).fill(0), 3)), new LineBasicMaterial({ color: '#e8eaf0', transparent: true, depthTest: false, toneMapped: false }));
    this.chain.renderOrder = 39;
    for (let i = 0; i < 8; i++) {
      const d = new Mesh(new SphereGeometry(0.009, 12, 8), new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthTest: false, toneMapped: false }));
      d.renderOrder = 40;
      this.dots.push(d);
      this.root.add(d);
    }
    this.root.add(this.handle, this.ring, this.miss, this.chain);
    this.root.visible = false;
  }

  attach(w: World, canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ndc = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const hit = (e: PointerEvent) => {
      if (!this.root.visible || useLab.getState().ikMode !== 'ik') return false;
      this.ray.setFromCamera(ndc(e), w.stage.camera);
      // generous pick radius on touch screens
      const r = e.pointerType === 'touch' ? 0.07 : 0.045;
      return this.ray.ray.distanceToPoint(this.handle.position) < r;
    };
    const down = (e: PointerEvent) => {
      if (!hit(e)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      this.dragging = true;
      w.director.claimed.add(e.pointerId);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events have no capture */
      }
      const n = new Vector3();
      w.stage.camera.getWorldDirection(n);
      this.plane.setFromNormalAndCoplanarPoint(n, this.handle.position);
      const p = new Vector3();
      this.ray.ray.intersectPlane(this.plane, p);
      this.off.copy(this.handle.position).sub(p);
    };
    const move = (e: PointerEvent) => {
      if (this.dragging) {
        e.stopImmediatePropagation();
        this.ray.setFromCamera(ndc(e), w.stage.camera);
        const p = new Vector3();
        if (this.ray.ray.intersectPlane(this.plane, p)) {
          p.add(this.off);
          // keep it in the room: above the floor, in front of the wall
          p.y = Math.max(0.15, Math.min(2.1, p.y));
          w.reach.target.copy(p);
        }
        return;
      }
      const h = hit(e);
      if (h !== this.hover) {
        this.hover = h;
        canvas.style.cursor = h ? 'grab' : '';
      }
    };
    const up = (e: PointerEvent) => {
      if (!this.dragging) return;
      e.stopImmediatePropagation();
      this.dragging = false;
      w.director.claimed.delete(e.pointerId);
      try {
        canvas.releasePointerCapture?.(e.pointerId);
      } catch {
        /* not captured */
      }
    };
    canvas.addEventListener('pointerdown', down, { capture: true });
    canvas.addEventListener('pointermove', move, { capture: true });
    canvas.addEventListener('pointerup', up, { capture: true });
    canvas.addEventListener('pointercancel', up, { capture: true });
    this.unsub = () => {
      canvas.removeEventListener('pointerdown', down, { capture: true });
      canvas.removeEventListener('pointermove', move, { capture: true });
      canvas.removeEventListener('pointerup', up, { capture: true });
      canvas.removeEventListener('pointercancel', up, { capture: true });
    };
  }

  update(w: World) {
    const a = w.ch.get('ik') * (useApp.getState().overlays ? 1 : 0.6);
    const on = a > 0.01 && w.driver.source === w.reach;
    this.root.visible = on;
    if (!on) return;
    const r = w.reach;
    const l = useLab.getState();
    const reached = r.result ? r.result.reached : true;
    this.handle.position.copy(r.target);
    this.ring.position.copy(r.target);
    this.ring.quaternion.copy(w.stage.camera.quaternion);
    const hm = this.handle.material as MeshBasicMaterial;
    hm.color.copy(reached ? VIOLET : BAD);
    hm.opacity = a * (l.ikMode === 'ik' ? 1 : 0.35);
    (this.ring.material as MeshBasicMaterial).opacity = a * (this.dragging || this.hover ? 1 : 0.6);
    this.ring.scale.setScalar(this.dragging ? 1.25 : 1);
    // miss line
    this.miss.visible = !reached;
    if (!reached) {
      const pos = this.miss.geometry.getAttribute('position') as Float32BufferAttribute;
      pos.setXYZ(0, r.palm.x, r.palm.y, r.palm.z);
      pos.setXYZ(1, r.target.x, r.target.y, r.target.z);
      pos.needsUpdate = true;
      this.miss.computeLineDistances();
      (this.miss.material as LineDashedMaterial).opacity = a;
    }
    // the chain: shoulder → … → wrist → palm
    const ids = ARM_JOINTS(r.side);
    const pts: Vector3[] = ids.map((id) => w.kin.jointPos[JOINT_INDEX[id]].clone());
    pts.push(w.kin.palm(r.side));
    const cp = this.chain.geometry.getAttribute('position') as Float32BufferAttribute;
    pts.forEach((p, i) => cp.setXYZ(i, p.x, p.y, p.z));
    for (let i = pts.length; i < 9; i++) cp.setXYZ(i, pts[pts.length - 1].x, pts[pts.length - 1].y, pts[pts.length - 1].z);
    cp.needsUpdate = true;
    (this.chain.material as LineBasicMaterial).opacity = 0.75 * a;
    this.dots.forEach((d, i) => {
      d.visible = i < pts.length;
      if (d.visible) d.position.copy(pts[i]);
      (d.material as MeshBasicMaterial).opacity = a;
    });
    // workspace cloud (sampled once per arm, with the robot standing)
    for (const s of ['L', 'R'] as const) {
      let c = this.cloud[s];
      if (!c && s === r.side && l.showWorkspace) {
        const data = sampleWorkspace(w.reach.pose, s, new Kinematics(w.kin.scale));
        const g = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(data, 3));
        c = new Points(g, new PointsMaterial({ color: VIOLET, size: 0.012, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false }));
        this.cloud[s] = c;
        this.root.add(c);
      }
      if (c) {
        c.visible = l.showWorkspace && s === r.side;
        (c.material as PointsMaterial).opacity = 0.4 * a;
      }
    }
  }

  dispose() {
    this.unsub?.();
    if (this.canvas) this.canvas.style.cursor = '';
  }
}
