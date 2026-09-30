/**
 * FO-H1's geometry, built procedurally from the specification (spec/body.ts, spec/actuators.ts)
 * so that every dimension the engineering models use is the one that is drawn: joint
 * positions, limb lengths, actuator diameters and lengths, battery size.
 *
 * Design language: machined natural-aluminium actuators and dark anodised structure, carried
 * inside warm light-grey molded covers with graphite secondary panels; black silicone contact
 * surfaces; a black glass sensor visor. Markings are few and small.
 */
import { BoxGeometry, CylinderGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ACTUATORS, type ActuatorFamily } from '../../spec/actuators';
import { DIM, type SegmentId } from '../../spec/body';
import type { LimbScale } from '../../engine/skeleton';
import { discPart, ringPart } from '../geo/lathe';
import { loft } from '../geo/loft';
import type { LookName } from '../materials';
import { buildArm } from './arms';
import { buildBattery, buildCompute } from './internals';
import { buildLeg } from './legs';
import { actuatorExterior, alongAxis, boltCircle, cable, plate, type Piece } from './parts';
import { RobotRig, type VisualGroup } from './rig';

export const X = new Vector3(1, 0, 0);
export const Yv = new Vector3(0, 1, 0);
export const Z = new Vector3(0, 0, 1);

export interface ActuatorPlacement {
  rig: RobotRig;
  fam: ActuatorFamily;
  /** Segment holding the housing, and the joint's child segment (turns with the output). */
  seg: SegmentId;
  child: SegmentId;
  /** The joint's origin in `seg`'s frame (the child frame's origin at zero pose). */
  jointOrigin: Vector3;
  /** Axis from the rear cap towards the output face, in `seg`'s frame. */
  axis: Vector3;
  /** Centre of the output face, in `seg`'s frame. */
  face: Vector3;
  /** Separate part name (for actuators that open up in Explore). */
  part?: string;
  kind?: 'cycloidal' | 'planetary' | 'harmonic';
  spin?: number;
}

/** Place a rotary actuator: housing on the parent, output flange on the child. */
export function placeActuator(p: ActuatorPlacement) {
  const ext = actuatorExterior(p.fam.housingOD, p.fam.housingLength, p.kind ?? (p.fam.reducer.kind as 'cycloidal'));
  const a = p.axis.clone().normalize();
  const base = p.face.clone().addScaledVector(a, -ext.length);
  const m = alongAxis(a, base, p.spin ?? 0);
  const mc = m.clone().premultiply(new Matrix4().makeTranslation(-p.jointOrigin.x, -p.jointOrigin.y, -p.jointOrigin.z));
  if (p.part) {
    const hold = p.rig.holder(p.seg, p.part);
    for (const pc of ext.housing) p.rig.addTo(hold, p.seg, pc.look, 'actuator', pc.geo, p.part, m);
    const out = p.rig.holder(p.child, `${p.part}:out`);
    for (const pc of ext.output) p.rig.addTo(out, p.child, pc.look, 'actuator', pc.geo, `${p.part}:out`, mc);
  } else {
    for (const pc of ext.housing) p.rig.add(p.seg, pc.look, 'actuator', pc.geo, { m });
    for (const pc of ext.output) p.rig.add(p.child, pc.look, 'actuator', pc.geo, { m: mc });
  }
}

export function addPieces(rig: RobotRig, seg: SegmentId, sub: VisualGroup, pieces: Piece[], m?: Matrix4) {
  for (const p of pieces) rig.add(seg, p.look, sub, p.geo, { m });
}

export function T(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeTranslation(x, y, z);
}

export function R(axis: Vector3, angle: number, at = new Vector3()): Matrix4 {
  return new Matrix4().compose(at, new Quaternion().setFromAxisAngle(axis, angle), new Vector3(1, 1, 1));
}

function buildPelvis(rig: RobotRig) {
  const P = 'pelvis';
  // the saddle: a dark cast frame above the hips carrying both hip yaw actuators
  const saddle = loft(
    [
      { y: 0.066, w: 0.135, d: 0.07, n: 4.2 },
      { y: 0.09, w: 0.148, d: 0.082, n: 4.2 },
      { y: 0.13, w: 0.146, d: 0.085, n: 4 },
      { y: 0.162, w: 0.118, d: 0.078, n: 3.6 },
      { y: 0.172, w: 0.1, d: 0.072, n: 3.2 },
    ],
    { capBottom: 'flat', capTop: 'flat', radial: 64 },
  );
  rig.add(P, 'anodized', 'structure', saddle);
  // bosses where the yaw actuators exit below, and the top flange for the waist
  for (const s of [1, -1]) {
    rig.add(P, 'anodized', 'structure', ringPart(0.047, 0.056, 0.058, 0.07, 0.001, 48), { m: T(s * DIM.hipHalfWidth, 0, 0) });
    placeActuator({ rig, fam: ACTUATORS.A80, seg: P, child: s > 0 ? 'L_hip_yaw_link' : 'R_hip_yaw_link', jointOrigin: new Vector3(s * DIM.hipHalfWidth, 0, 0), axis: new Vector3(0, -1, 0), face: new Vector3(s * DIM.hipHalfWidth, 0.066, 0) });
  }
  rig.add(P, 'aluBright', 'structure', ringPart(0.03, 0.058, 0.168, 0.174, 0.0008, 48));
  addPieces(rig, P, 'structure', boltCircle(10, 0.05, 0.174, 0.0028));
  // front "belt" cover in light grey, and a dark lower insert
  const belt = loft(
    [
      { y: 0.074, w: 0.142, d: 0.086, n: 3.2, front: -0.004 },
      { y: 0.1, w: 0.155, d: 0.094, n: 3.4, front: 0.004 },
      { y: 0.142, w: 0.152, d: 0.094, n: 3.4, front: 0.006 },
      { y: 0.172, w: 0.118, d: 0.084, n: 3.0, front: 0.0 },
    ],
    { arc: [0.05, 0.45], thickness: 0.004, radial: 56, perSpan: 6 },
  );
  rig.add(P, 'shellDark', 'shell', belt);
  // a light front plate on the belt (a restrained accent) with the maker's small mark
  const buckle = loft(
    [
      { y: 0.098, w: 0.1555, d: 0.0945, n: 3.4, front: 0.0045 },
      { y: 0.14, w: 0.1525, d: 0.0945, n: 3.4, front: 0.0065 },
    ],
    { arc: [0.19, 0.31], thickness: 0.0015, radial: 40 },
  );
  rig.add(P, 'shell', 'shell', buckle);
  // primary IMU module (visible in x-ray) on the saddle's rear, near the COM
  rig.add(P, 'shellDark', 'sensor', new RoundedBoxGeometry(0.05, 0.022, 0.04, 2, 0.003), { m: T(0, 0.12, -0.062) });
  rig.add(P, 'statusDim', 'sensor', new BoxGeometry(0.012, 0.002, 0.002), { m: T(0.012, 0.131, -0.042) });
  rig.anchor('imu', P, [0, 0.12, -0.062]);
  rig.anchor('pelvis', P, [0, 0.1, 0.05]);
}

function buildTorso(rig: RobotRig) {
  const S = 'torso';
  const sh = DIM.shoulderHeight;
  const shx = DIM.shoulderHalfWidth;
  // waist actuator: housing in the torso, output facing down onto the pelvis
  placeActuator({ rig, fam: ACTUATORS.A80, seg: S, child: 'pelvis', jointOrigin: new Vector3(0, -DIM.waistHeight, 0), axis: new Vector3(0, -1, 0), face: new Vector3(0, 0.0, 0) });
  // the waist's corrugated cover (a boot around the actuator)
  const boot: { y: number; w: number; d: number; n: number }[] = [];
  for (let i = 0; i <= 8; i++) {
    const y = 0.006 + i * 0.0085;
    const r = i % 2 ? 0.066 : 0.072;
    boot.push({ y, w: r * 1.18, d: r, n: 2.6 });
  }
  rig.add(S, 'shellDark', 'shell', loft(boot, { radial: 56, perSpan: 3 }));
  // structure: a lower bulkhead ring, a spine plate, an upper yoke carrying the shoulders
  rig.add(S, 'anodized', 'structure', loft([{ y: 0.07, w: 0.128, d: 0.08, n: 4 }, { y: 0.084, w: 0.128, d: 0.08, n: 4 }], { thickness: 0.012, radial: 56 }));
  rig.add(S, 'anodized', 'structure', plate(0.15, 0.3, 0.012, 0.004), { m: T(0, 0.23, -0.078) });
  for (const s of [1, -1]) rig.add(S, 'anodized', 'structure', plate(0.012, 0.28, 0.07, 0.004), { m: T(s * 0.126, 0.225, -0.035) });
  rig.add(S, 'anodized', 'structure', new CylinderGeometry(0.02, 0.02, 2 * (shx - 0.075), 24).rotateZ(Math.PI / 2), { m: T(0, sh, -0.01) });
  rig.add(S, 'anodized', 'structure', plate(0.2, 0.05, 0.08, 0.006), { m: T(0, sh + 0.03, -0.02) });
  // shoulder pitch actuators inside the torso, output flanges facing out
  for (const s of [1, -1]) {
    placeActuator({
      rig,
      fam: ACTUATORS.A80,
      seg: S,
      child: s > 0 ? 'L_shoulder_link' : 'R_shoulder_link',
      jointOrigin: new Vector3(s * shx, sh, -0.01),
      axis: new Vector3(s, 0, 0),
      face: new Vector3(s * shx, sh, -0.01),
      part: s > 0 ? 'act:L_shoulder_pitch' : undefined,
    });
  }
  // battery, power distribution and computers
  buildBattery(rig, S);
  buildCompute(rig, S);
  // Torso covers: a light upper chest plate over a graphite abdomen plate, tapering to the
  // waist (a V silhouette). Both are separate parts: they open in Power to show the battery.
  const chest = loft(
    [
      { y: 0.205, w: 0.13, d: 0.088, n: 3.6, front: 0.03 },
      { y: 0.255, w: 0.146, d: 0.092, n: 3.6, front: 0.034 },
      { y: 0.315, w: 0.152, d: 0.09, n: 3.5, front: 0.032 },
      { y: 0.365, w: 0.138, d: 0.083, n: 3.2, front: 0.024 },
      { y: 0.398, w: 0.108, d: 0.071, n: 2.9, front: 0.013 },
    ],
    { arc: [0.075, 0.425], thickness: 0.0045, radial: 56, perSpan: 8 },
  );
  const chestHolder = rig.holder(S, 'chest');
  rig.addTo(chestHolder, S, 'shell', 'shell', chest, 'chest');
  rig.addTo(chestHolder, S, 'shellDark', 'sensor', new RoundedBoxGeometry(0.07, 0.024, 0.012, 2, 0.004), 'chest', T(0, 0.3, 0.1195));
  rig.addTo(chestHolder, S, 'lens', 'sensor', new CylinderGeometry(0.0065, 0.0065, 0.004, 24).rotateX(Math.PI / 2), 'chest', T(-0.018, 0.3, 0.126));
  rig.addTo(chestHolder, S, 'lens', 'sensor', new CylinderGeometry(0.0045, 0.0045, 0.004, 20).rotateX(Math.PI / 2), 'chest', T(0.016, 0.3, 0.126));
  // status light under the neck (quiet)
  rig.addTo(chestHolder, S, 'status', 'compute', new RoundedBoxGeometry(0.022, 0.0035, 0.004, 1, 0.0015), 'chest', T(0, 0.375, 0.097));
  const abdomenHolder = rig.holder(S, 'abdomen');
  const abdomen = loft(
    [
      { y: 0.078, w: 0.112, d: 0.08, n: 3.4, front: 0.008 },
      { y: 0.13, w: 0.121, d: 0.084, n: 3.5, front: 0.018 },
      { y: 0.2, w: 0.1285, d: 0.087, n: 3.6, front: 0.028 },
    ],
    { arc: [0.08, 0.42], thickness: 0.0045, radial: 64, perSpan: 6 },
  );
  rig.addTo(abdomenHolder, S, 'shellDark', 'shell', abdomen, 'abdomen');
  // three horizontal grooves on the abdomen plate
  for (const y of [0.11, 0.14, 0.17])
    rig.addTo(abdomenHolder, S, 'anodized', 'shell', loft([{ y, w: 0.1175 + (y - 0.11) * 0.18, d: 0.0825 + (y - 0.11) * 0.06, n: 3.5, front: 0.013 + (y - 0.11) * 0.16 }, { y: y + 0.0025, w: 0.1177 + (y - 0.11) * 0.18, d: 0.0827 + (y - 0.11) * 0.06, n: 3.5, front: 0.0132 + (y - 0.11) * 0.16 }], { arc: [0.12, 0.38], thickness: 0.0008, radial: 40 }), 'abdomen');
  // collar around the neck base
  rig.add(S, 'shellDark', 'shell', loft([{ y: 0.394, w: 0.1, d: 0.066, n: 2.8 }, { y: 0.405, w: 0.086, d: 0.058, n: 2.6 }, { y: 0.41, w: 0.07, d: 0.05, n: 2.4 }], { thickness: 0.004, radial: 56 }));
  rig.anchor('chest', S, [0, 0.27, 0.125]);
  rig.anchor('chestCam', S, [0, 0.3, 0.127]);
  // back cover (dark) and the backpack: compute and cooling behind a vented panel
  const back = loft(
    [
      { y: 0.08, w: 0.112, d: 0.08, n: 3.4 },
      { y: 0.2, w: 0.128, d: 0.087, n: 3.5 },
      { y: 0.315, w: 0.148, d: 0.09, n: 3.4 },
      { y: 0.398, w: 0.106, d: 0.07, n: 2.9 },
    ],
    { arc: [0.575, 0.925], thickness: 0.004, radial: 60 },
  );
  rig.add(S, 'shellDark', 'shell', back);
  // backpack shell: a shaped light cover over the computers, with a dark vented panel
  const pack = loft(
    [
      { y: 0.16, w: 0.09, d: 0.03, n: 3.4, cz: -0.1 },
      { y: 0.2, w: 0.105, d: 0.052, n: 3.6, cz: -0.11 },
      { y: 0.33, w: 0.108, d: 0.056, n: 3.6, cz: -0.112 },
      { y: 0.375, w: 0.09, d: 0.04, n: 3.2, cz: -0.1 },
    ],
    { arc: [0.56, 0.94], thickness: 0.004, radial: 48, capTop: 'none' },
  );
  rig.add(S, 'shell', 'shell', pack);
  rig.add(S, 'shellDark', 'shell', new RoundedBoxGeometry(0.12, 0.13, 0.006, 2, 0.003), { m: T(0, 0.27, -0.1665) });
  for (let i = 0; i < 8; i++) rig.add(S, 'rubber', 'compute', new BoxGeometry(0.1, 0.0045, 0.002), { m: T(0, 0.218 + i * 0.015, -0.1698) });
  rig.anchor('backpack', S, [0, 0.27, -0.155]);
  // side panels under the arms (graphite), leaving the shoulder actuators exposed above
  for (const s of [1, -1]) {
    const side = loft(
      [
        { y: 0.082, w: 0.11, d: 0.08, n: 3.4 },
        { y: 0.2, w: 0.126, d: 0.086, n: 3.5 },
        { y: 0.27, w: 0.132, d: 0.088, n: 3.5 },
      ],
      { arc: s > 0 ? [-0.09, 0.09] : [0.41, 0.59], thickness: 0.004, radial: 30 },
    );
    rig.add(S, 'shellDark', 'shell', side);
  }
  // neck base and neck yaw actuator
  rig.add(S, 'anodized', 'structure', loft([{ y: 0.388, w: 0.07, d: 0.058, n: 3 }, { y: 0.402, w: 0.06, d: 0.05, n: 3 }], { capTop: 'flat', radial: 40 }));
  placeActuator({ rig, fam: ACTUATORS.A45, seg: S, child: 'neck', jointOrigin: new Vector3(0, DIM.neckHeight, -0.012), axis: new Vector3(0, 1, 0), face: new Vector3(0, DIM.neckHeight, -0.012) });
  // main harness up the spine (visible when the covers are ghosted)
  rig.add(S, 'cable', 'wiring', cable([new Vector3(0.03, 0.07, -0.065), new Vector3(0.035, 0.2, -0.066), new Vector3(0.03, 0.33, -0.06), new Vector3(0.012, 0.39, -0.04)], 0.007, 40, 8));
  rig.add(S, 'cable', 'wiring', cable([new Vector3(-0.03, 0.07, -0.065), new Vector3(-0.035, 0.2, -0.066), new Vector3(-0.07, 0.3, -0.05), new Vector3(-0.12, 0.33, -0.03)], 0.006, 40, 8));
  rig.add(S, 'cable', 'wiring', cable([new Vector3(0.035, 0.2, -0.066), new Vector3(0.07, 0.3, -0.05), new Vector3(0.12, 0.33, -0.03)], 0.006, 30, 8));
  // markings: the designation on the backpack, the maker on the chest (small)
  rig.anchor('torso', S, [0, 0.22, 0.13]);
  rig.anchor('battery', S, [0, 0.16, 0.07]);
  rig.anchor('shoulderL', S, [shx, sh, -0.01]);
}

function buildHead(rig: RobotRig) {
  // neck link: a short bracket carrying the pitch actuator
  const N = 'neck';
  rig.add(N, 'anodized', 'structure', plate(0.05, 0.05, 0.03, 0.005), { m: T(0, 0.02, 0) });
  placeActuator({ rig, fam: ACTUATORS.A45, seg: N, child: 'head', jointOrigin: new Vector3(0, DIM.neckLength, 0), axis: new Vector3(1, 0, 0), face: new Vector3(0.031, DIM.neckLength, 0), kind: 'harmonic' });
  rig.add(N, 'cable', 'wiring', cable([new Vector3(-0.02, 0.0, -0.03), new Vector3(-0.03, 0.03, -0.045), new Vector3(-0.02, 0.07, -0.04)], 0.005, 20, 8));
  rig.add(N, 'shellDark', 'shell', loft([{ y: 0.004, w: 0.05, d: 0.046, n: 2.4 }, { y: 0.016, w: 0.046, d: 0.043, n: 2.4 }], { thickness: 0.003, radial: 40 }));
  // head: a smooth shell with a black glass visor across the face
  const H = 'head';
  const shell = loft(
    [
      { y: 0.026, w: 0.05, d: 0.054, n: 2.8, cz: -0.008 },
      { y: 0.052, w: 0.074, d: 0.086, n: 3.1, cz: 0.004, front: 0.006 },
      { y: 0.1, w: 0.086, d: 0.1, n: 3.3, cz: 0.012, front: 0.012 },
      { y: 0.16, w: 0.085, d: 0.1, n: 3.3, cz: 0.012, front: 0.009 },
      { y: 0.192, w: 0.074, d: 0.088, n: 3.0, cz: 0.008 },
    ],
    { capBottom: 'flat', capTop: { dome: 0.018 }, radial: 56, perSpan: 8 },
  );
  rig.add(H, 'shell', 'head', shell);
  // the sensor visor: a black glass band across the face
  const visor = loft(
    [
      { y: 0.074, w: 0.0845, d: 0.0985, n: 3.25, cz: 0.011, front: 0.0115 },
      { y: 0.112, w: 0.0885, d: 0.1025, n: 3.3, cz: 0.012, front: 0.0135 },
      { y: 0.148, w: 0.0875, d: 0.1025, n: 3.3, cz: 0.012, front: 0.0105 },
    ],
    { arc: [0.07, 0.43], thickness: 0.003, radial: 64, perSpan: 8 },
  );
  rig.add(H, 'visor', 'sensor', visor, { part: 'visor' });
  // a thin graphite brow line above the visor
  rig.add(H, 'shellDark', 'head', loft([{ y: 0.1515, w: 0.0868, d: 0.1015, n: 3.3, cz: 0.012, front: 0.0095 }, { y: 0.1555, w: 0.0866, d: 0.1013, n: 3.3, cz: 0.012, front: 0.009 }], { arc: [0.08, 0.42], thickness: 0.0015, radial: 48 }));
  // side pods (microphone arrays), fine grooves
  for (const s of [1, -1]) {
    rig.add(H, 'shellDark', 'head', discPart(0.026, 0, 0.008, 0.0015, 40).rotateZ((-s * Math.PI) / 2), { m: T(s * 0.087, 0.11, 0.004) });
    for (let i = 0; i < 3; i++) rig.add(H, 'anodized', 'head', ringPart(0.009 + i * 0.005, 0.0105 + i * 0.005, 0.0081, 0.0086, 0.0001, 32).rotateZ((-s * Math.PI) / 2), { m: T(s * 0.087, 0.11, 0.004) });
  }
  // sensors behind the visor: stereo pair, colour camera, projector (visible in x-ray)
  const lens = (x: number, y: number, r: number) => {
    rig.add(H, 'anodized', 'sensor', new CylinderGeometry(r * 1.6, r * 1.6, 0.012, 24).rotateX(Math.PI / 2), { m: T(x, y, 0.088) });
    rig.add(H, 'lens', 'sensor', new CylinderGeometry(r, r, 0.004, 24).rotateX(Math.PI / 2), { m: T(x, y, 0.095) });
  };
  lens(0.04, 0.11, 0.0055);
  lens(-0.04, 0.11, 0.0055);
  lens(0, 0.122, 0.0045);
  lens(0.016, 0.094, 0.003);
  rig.add(H, 'pcbBlack', 'sensor', new RoundedBoxGeometry(0.11, 0.04, 0.006, 2, 0.002), { m: T(0, 0.11, 0.084) });
  rig.anchor('head', H, [0, 0.11, 0.105]);
  rig.anchor('cameras', H, [0, 0.112, 0.1]);
  rig.anchor('eyeL', H, [0.04, 0.112, 0.1]);
  rig.anchor('eyeR', H, [-0.04, 0.112, 0.1]);
}

export interface BuildOptions {
  scale: LimbScale;
  /** Battery configuration for the pack's visual size (cells in parallel). */
  parallel: number;
}

/** Build the whole robot. */
export function buildRobot(opts: BuildOptions): RobotRig {
  const rig = new RobotRig();
  rig.setScale(opts.scale);
  buildPelvis(rig);
  buildTorso(rig);
  buildHead(rig);
  for (const side of ['L', 'R'] as const) {
    buildLeg(rig, side, opts.scale);
    buildArm(rig, side, opts.scale);
  }
  rig.finalize();
  return rig;
}

export type { LookName };
