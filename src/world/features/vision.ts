/**
 * What FO-H1 sees: its left stereo camera's view, drawn into a rectangle of the page that the
 * Vision panel reserves (a second render into the same canvas, scissored), in one of three
 * modes:
 *
 *   camera        the image (rendered, not a simulated sensor: no noise, blur or rolling shutter)
 *   depth         distance along the optical axis, as the stereo pair would measure it, as a
 *                 colour ramp; the expected depth error at each distance is σz = z²·σd/(f·B)
 *   segmentation  each thing on the cart as its own class, the robot's own hands, the rest
 *
 * Detected objects get a box, their range and its expected error. In the scene, the camera's
 * field of view is drawn from the head.
 */
import {
  AgXToneMapping,
  Box3,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  ShaderMaterial,
  Vector3,
  Vector4,
} from 'three';
import { HEAD_CAMERAS } from '../../spec/sensing';
import { stereoDepth } from '../../engine/sensing';
import { useApp } from '../../state/store';
import { ITEMS, type ItemId } from '../cart';
import type { Feature, World } from '../world';

/** Backgrounds of the depth and segmentation images (shared: the inset is drawn every frame). */
const DEPTH_BG = new Color('#050506');
const SEG_BG = new Color('#0b0c10');

export type VisionMode = 'camera' | 'depth' | 'segmentation';

const S = HEAD_CAMERAS.stereo;
const VFOV = (2 * Math.atan(Math.tan(((S.hfovDeg / 2) * Math.PI) / 180) * (S.height / S.width)) * 180) / Math.PI;

export interface Detection {
  id: ItemId;
  label: string;
  /** Box in the view, 0–1 from the top left. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  range: number;
  sigma: number;
  color: string;
}

const depthMat = new ShaderMaterial({
  uniforms: { uNear: { value: 0.3 }, uFar: { value: 6 } },
  vertexShader: /* glsl */ `varying float vZ; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */ `varying float vZ; uniform float uNear; uniform float uFar;
    void main() {
      float t = clamp((vZ - uNear) / (uFar - uNear), 0.0, 1.0);
      t = sqrt(t);
      vec3 a = vec3(0.98, 0.93, 0.78), b = vec3(0.92, 0.55, 0.25), c = vec3(0.45, 0.2, 0.55), d = vec3(0.08, 0.07, 0.2);
      vec3 col = t < 0.33 ? mix(a, b, t / 0.33) : t < 0.66 ? mix(b, c, (t - 0.33) / 0.33) : mix(c, d, (t - 0.66) / 0.34);
      if (vZ < uNear || vZ > uFar) col = vec3(0.02);
      gl_FragColor = vec4(col, 1.0);
    }`,
});

export class Vision implements Feature {
  mode: VisionMode = 'camera';
  /** The canvas the view is copied into (set by the Vision panel). */
  view: HTMLCanvasElement | null = null;
  cam = new PerspectiveCamera(VFOV, S.width / S.height, 0.05, 20);
  frustum: LineSegments;
  detections: Detection[] = [];
  private segMats = new Map<string, MeshBasicMaterial>();
  private saved = new Map<Mesh, Material | Material[]>();
  private tmp = new Vector3();
  private vp = new Vector4();

  constructor() {
    const g = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(new Array(16 * 3).fill(0), 3));
    this.frustum = new LineSegments(g, new LineBasicMaterial({ color: '#9b8fff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    this.frustum.frustumCulled = false;
    this.frustum.renderOrder = 34;
  }

  private placeCamera(w: World) {
    const head = w.rig.seg.get('head')!;
    head.updateWorldMatrix(true, false);
    // left camera of the pair: half the baseline to the robot's left of the centre
    const p = w.anchor('cameras', this.tmp);
    const left = new Vector3(S.baseline / 2, 0, 0).transformDirection(head.matrixWorld);
    this.cam.position.copy(p).addScaledVector(left, S.baseline / 2);
    const fwd = new Vector3(0, 0, 1).transformDirection(head.matrixWorld);
    const up = new Vector3(0, 1, 0).transformDirection(head.matrixWorld);
    this.cam.up.copy(up);
    this.cam.lookAt(this.cam.position.clone().add(fwd));
    this.cam.updateMatrixWorld();
  }

  update(w: World) {
    const a = w.ch.get('vision') * (useApp.getState().overlays ? 1 : 0.5);
    this.placeCamera(w);
    // frustum lines out to 1.2 m
    const m = this.frustum.material as LineBasicMaterial;
    m.opacity = 0.3 * a;
    this.frustum.visible = a > 0.01;
    if (this.frustum.visible) {
      const d = 0.8;
      const hy = Math.tan(((VFOV / 2) * Math.PI) / 180) * d;
      const hx = hy * this.cam.aspect;
      const o = this.cam.position;
      const corners = [
        [-hx, -hy],
        [hx, -hy],
        [hx, hy],
        [-hx, hy],
      ].map(([x, y]) => new Vector3(x, y, -d).applyMatrix4(this.cam.matrixWorld));
      const pos = this.frustum.geometry.getAttribute('position') as Float32BufferAttribute;
      let k = 0;
      const put = (p: Vector3) => pos.setXYZ(k++, p.x, p.y, p.z);
      for (let i = 0; i < 4; i++) {
        put(o);
        put(corners[i]);
        put(corners[i]);
        put(corners[(i + 1) % 4]);
      }
      pos.needsUpdate = true;
    }
    // detections: the cart's items in view
    this.detections = [];
    if (a > 0.01 && w.props.cart.root.visible) {
      for (const it of Object.values(ITEMS)) {
        const g = w.props.cart.items[it.id];
        const box = new Box3().setFromObject(g);
        if (box.isEmpty()) continue;
        const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((j) => new Vector3(j & 1 ? box.max.x : box.min.x, j & 2 ? box.max.y : box.min.y, j & 4 ? box.max.z : box.min.z));
        let x0 = 1,
          y0 = 1,
          x1 = 0,
          y1 = 0,
          behind = false;
        for (const p of pts) {
          const c = p.clone().applyMatrix4(this.cam.matrixWorldInverse);
          if (c.z > -0.05) behind = true;
          p.project(this.cam);
          x0 = Math.min(x0, p.x * 0.5 + 0.5);
          x1 = Math.max(x1, p.x * 0.5 + 0.5);
          y0 = Math.min(y0, -p.y * 0.5 + 0.5);
          y1 = Math.max(y1, -p.y * 0.5 + 0.5);
        }
        if (behind || x1 < 0 || x0 > 1 || y1 < 0 || y0 > 1) continue;
        const centre = box.getCenter(new Vector3()).applyMatrix4(this.cam.matrixWorldInverse);
        const z = -centre.z;
        const r = stereoDepth(z);
        this.detections.push({ id: it.id, label: it.label, x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(1, x1), y1: Math.min(1, y1), range: z, sigma: r.sigma, color: it.seg });
      }
    }
  }

  /** Materials only the robot's view uses (for the warm-up: none may compile on first use). */
  warmMaterials(): import('three').Material[] {
    return [depthMat];
  }

  /** Draw the robot's view into the reserved rectangle (after the main render). */
  renderInto(w: World) {
    const el = this.view;
    if (!el || w.ch.get('vision') < 0.5) return;
    const r = el.getBoundingClientRect();
    const c = w.stage.renderer.domElement.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const renderer = w.stage.renderer;
    const x = r.left - c.left;
    const y = c.bottom - r.bottom;
    this.vp.set(x, y, r.width, r.height);
    this.cam.aspect = r.width / r.height;
    this.cam.updateProjectionMatrix();
    const scene = w.stage.scene;
    const prevTone = renderer.toneMapping;
    const prevBg = scene.background;
    const prevOverride = scene.overrideMaterial;
    renderer.setViewport(this.vp);
    renderer.setScissor(this.vp);
    renderer.setScissorTest(true);
    // the robot's own overlays are not in its camera image
    const hidden: Object3D[] = [];
    for (const o of [w.overlays.group, w.flows.group, this.frustum, w.props.ik.root]) {
      if (o.visible) {
        hidden.push(o);
        o.visible = false;
      }
    }
    if (this.mode === 'depth') {
      scene.overrideMaterial = depthMat;
      scene.background = DEPTH_BG;
    } else if (this.mode === 'segmentation') {
      this.segment(w, true);
      scene.background = SEG_BG;
    } else renderer.toneMapping = AgXToneMapping;
    renderer.render(scene, this.cam);
    // copy it out at once (the drawing buffer is valid until this frame is composited); the
    // main view is drawn under the panel there, where it cannot be seen
    const dpr = renderer.getPixelRatio();
    const cw = Math.round(r.width * dpr);
    const chh = Math.round(r.height * dpr);
    if (el.width !== cw || el.height !== chh) {
      el.width = cw;
      el.height = chh;
    }
    const g = el.getContext('2d');
    g?.drawImage(renderer.domElement, x * dpr, (c.height - y - r.height) * dpr, r.width * dpr, r.height * dpr, 0, 0, cw, chh);
    if (this.mode === 'segmentation') this.segment(w, false);
    for (const o of hidden) o.visible = true;
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    renderer.toneMapping = prevTone;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, c.width, c.height);
  }

  private segMat(color: string): MeshBasicMaterial {
    let m = this.segMats.get(color);
    if (!m) {
      m = new MeshBasicMaterial({ color, toneMapped: false });
      this.segMats.set(color, m);
    }
    return m;
  }

  /** Swap every mesh to its class colour (on), or back (off). */
  private segment(w: World, on: boolean) {
    if (!on) {
      for (const [mesh, mat] of this.saved) mesh.material = mat;
      this.saved.clear();
      return;
    }
    const cls = (o: Object3D): string => {
      for (let p: Object3D | null = o; p; p = p.parent) {
        if (p.name.startsWith('item:')) return ITEMS[p.name.slice(5) as ItemId].seg;
        if (p.name === 'cart') return '#3d5a73';
        if (p.name === 'FO-H1') return '#6c6f78';
        if (p.name === 'lab') return '#1a1c22';
      }
      return '#15171c';
    };
    w.stage.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.visible) return;
      this.saved.set(m, m.material);
      m.material = this.segMat(cls(m));
    });
  }
}
