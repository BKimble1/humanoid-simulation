/**
 * Energy and information moving through the robot, drawn as dashed lines that travel along
 * the cable routes: the DC bus from the battery through the contactors to every limb's
 * drives (the dash speed follows the electrical power that limb draws right now), the
 * low-voltage rails to the computers and sensors, and the data paths from the sensors
 * through the computers to the drives. Routes follow anchors on the moving robot, so they
 * stay attached through any motion.
 */
import { CatmullRomCurve3, Color, Group, Vector2, Vector3 } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { InterleavedBuffer } from 'three';
import { JOINTS } from '../../spec/body';
import { useApp } from '../../state/store';
import type { ChannelId } from '../../scene/seq/channels';
import type { Feature, World } from '../world';

const SAMPLES = 28;

interface Path {
  id: string;
  anchors: string[];
  channel: ChannelId;
  color: Color;
  width: number;
  /** Power (W) or a constant rate that sets the dash speed. */
  rate: (w: World) => number;
  line: Line2;
  mat: LineMaterial;
  pts: Vector3[];
  offset: number;
  alpha: number;
}

const HV = new Color('#ffb45c');
const LV = new Color('#8fb4ff');
const DATA = new Color('#a99bff');
const SAFE = new Color('#ff7a66');

/** Electrical power drawn by the joints whose id starts with one of the prefixes, W. */
function limbPower(w: World, prefixes: string[]): number {
  let p = 0;
  JOINTS.forEach((j, i) => {
    if (prefixes.some((x) => j.id.startsWith(x))) p += Math.abs(w.energy.joints[i].pElec);
  });
  return p;
}

export class Flows implements Feature {
  group = new Group();
  private paths: Path[] = [];
  private res = new Vector2(1280, 800);

  constructor() {
    this.group.name = 'flows';
    const P = (id: string, anchors: string[], channel: ChannelId, color: Color, width: number, rate: Path['rate']) => {
      const mat = new LineMaterial({ color: color.getHex(), linewidth: width, transparent: true, opacity: 0, depthTest: false, depthWrite: false, dashed: true, dashSize: 0.018, gapSize: 0.022, toneMapped: false });
      const geo = new LineGeometry();
      const pts = Array.from({ length: SAMPLES }, () => new Vector3());
      geo.setPositions(new Array(SAMPLES * 3).fill(0));
      const line = new Line2(geo, mat);
      line.computeLineDistances();
      line.frustumCulled = false;
      line.renderOrder = 33;
      line.visible = false;
      this.group.add(line);
      this.paths.push({ id, anchors, channel, color, width, rate, line, mat, pts, offset: 0, alpha: 0 });
    };
    // DC bus: battery → contactors → each limb's drives
    P('busL', ['cells', 'contactors', 'pelvis', 'hipRollActL', 'hipPitchActL', 'kneeActL', 'ankleActL'], 'powerFlow', HV, 2.6, (w) => limbPower(w, ['L_hip', 'L_knee', 'L_ankle']));
    P('busR', ['cells', 'contactors', 'pelvis', 'hipRollActR', 'hipPitchActR', 'kneeActR', 'ankleActR'], 'powerFlow', HV, 2.6, (w) => limbPower(w, ['R_hip', 'R_knee', 'R_ankle']));
    P('busArmL', ['cells', 'bms', 'shoulderL', 'elbowActL', 'wristL'], 'powerFlow', HV, 2.2, (w) => limbPower(w, ['L_shoulder', 'L_arm', 'L_elbow', 'L_wrist']));
    P('busArmR', ['cells', 'bms', 'shoulderR', 'elbowActR', 'wristR'], 'powerFlow', HV, 2.2, (w) => limbPower(w, ['R_shoulder', 'R_arm', 'R_elbow', 'R_wrist']));
    // low voltage: DC/DC → computers and head
    P('lvPC', ['dcdc', 'rtController', 'perceptionPC'], 'powerFlow', LV, 1.8, (w) => w.energy.summary.lv * 0.7);
    P('lvHead', ['dcdc', 'perceptionPC', 'cameras'], 'powerFlow', LV, 1.6, (w) => w.energy.summary.lv * 0.3);
    // data: sensors → perception → real-time control → drives
    P('dCam', ['cameras', 'perceptionPC'], 'dataFlow', DATA, 2.0, () => 70);
    P('dPlan', ['perceptionPC', 'rtController'], 'dataFlow', DATA, 2.0, () => 60);
    P('dImu', ['imu', 'rtController'], 'dataFlow', DATA, 1.8, () => 90);
    P('dLegL', ['rtController', 'ethercat', 'pelvis', 'hipPitchActL', 'kneeActL', 'ankleActL', 'ftL'], 'dataFlow', DATA, 1.8, () => 90);
    P('dLegR', ['rtController', 'ethercat', 'pelvis', 'hipPitchActR', 'kneeActR', 'ankleActR', 'ftR'], 'dataFlow', DATA, 1.8, () => 90);
    P('dArmL', ['ethercat', 'shoulderL', 'elbowActL', 'ftWristL'], 'dataFlow', DATA, 1.6, () => 90);
    P('sto', ['safety', 'ethercat'], 'dataFlow', SAFE, 1.4, () => 25);
  }

  update(w: World, dt: number) {
    const show = useApp.getState().overlays ? 1 : 0;
    this.res.set(w.director.viewW, w.director.viewH);
    for (const p of this.paths) {
      const a = w.ch.get(p.channel) * show;
      p.alpha = a;
      p.line.visible = a > 0.01;
      if (!p.line.visible) continue;
      // route through the anchors, smoothed
      const ctrl = p.anchors.map((n) => w.anchor(n));
      const curve = new CatmullRomCurve3(ctrl, false, 'centripetal', 0.5);
      const arr: number[] = [];
      for (let i = 0; i < SAMPLES; i++) {
        const q = curve.getPoint(i / (SAMPLES - 1), p.pts[i]);
        arr.push(q.x, q.y, q.z);
      }
      writePositions(p.line.geometry as LineGeometry, arr);
      p.line.computeLineDistances();
      // dash speed: 4 cm/s at rest up to 60 cm/s at 400 W (power), or the data rate
      const rate = p.rate(w);
      const speed = p.channel === 'powerFlow' ? 0.04 + 0.56 * Math.min(1, rate / 400) : 0.18;
      p.offset -= speed * dt;
      p.mat.dashOffset = p.offset;
      p.mat.opacity = 0.9 * a;
      p.mat.resolution.copy(this.res);
    }
  }
}

/** Update a line's points in place (the point count never changes). */
function writePositions(g: LineGeometry, arr: number[]) {
  const start = g.getAttribute('instanceStart') as unknown as { data: InterleavedBuffer };
  const buf = start.data;
  const a = buf.array as Float32Array;
  const n = arr.length / 3 - 1;
  for (let i = 0; i < n; i++) {
    a[i * 6] = arr[i * 3];
    a[i * 6 + 1] = arr[i * 3 + 1];
    a[i * 6 + 2] = arr[i * 3 + 2];
    a[i * 6 + 3] = arr[i * 3 + 3];
    a[i * 6 + 4] = arr[i * 3 + 4];
    a[i * 6 + 5] = arr[i * 3 + 5];
  }
  buf.needsUpdate = true;
  g.computeBoundingSphere();
}
