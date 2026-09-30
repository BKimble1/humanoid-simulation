/**
 * Arms. Shoulder: pitch actuator inside the torso, roll actuator behind the shoulder (axis
 * forward), upper-arm yaw actuator below it (axis along the arm). Elbow actuator across the
 * elbow. Forearm: the wrist yaw actuator near the elbow; the two wrist actuators (pitch and
 * roll) in the lower forearm, driving the wrist through short rods, so their mass stays out of
 * the hand. Hand: see hand.ts.
 */
import { CylinderGeometry, Group, Matrix4, Quaternion, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ACTUATORS } from '../../spec/actuators';
import { DIM, WRIST_YAW_Y, type Side } from '../../spec/body';
import type { LimbScale } from '../../engine/skeleton';
import { discPart, ringPart } from '../geo/lathe';
import { loft } from '../geo/loft';
import { actuatorExterior, alongAxis, boltCircle, plate, tube } from './parts';
import type { RobotRig } from './rig';
import { T, addPieces, placeActuator } from './build';
import { buildHand } from './hand';

const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();

export function buildArm(rig: RobotRig, side: Side, scale: LimbScale) {
  const s = side === 'L' ? 1 : -1;
  const shL = `${side}_shoulder_link` as const;
  const rollL = `${side}_shoulder_roll_link` as const;
  const ua = `${side}_upper_arm` as const;
  const fa = `${side}_forearm` as const;
  const wl = `${side}_wrist_link` as const;
  const wc = `${side}_wrist_cross` as const;
  const hand = `${side}_hand` as const;
  const Lu = DIM.upperArm * scale.upperArm;
  const Lf = DIM.forearm * scale.forearm;
  const wristY = Lf - WRIST_YAW_Y;

  // ── shoulder link: a bracket from the pitch flange back to the roll actuator
  rig.add(shL, 'anodized', 'structure', plate(0.012, 0.09, 0.12, 0.006), { m: T(s * 0.006, 0, -0.03) });
  rig.add(shL, 'anodized', 'structure', plate(0.05, 0.07, 0.012, 0.005), { m: T(s * 0.0, 0, -0.124) });
  rig.add(shL, 'anodized', 'structure', plate(0.012, 0.07, 0.05, 0.004), { m: T(s * 0.03, 0, -0.105) });
  // shoulder cap: a light cover over the pitch flange and bracket
  const cap = loft(
    [
      { y: -0.045, w: 0.05, d: 0.062, n: 2.4 },
      { y: 0.0, w: 0.056, d: 0.066, n: 2.4 },
      { y: 0.04, w: 0.05, d: 0.06, n: 2.4 },
    ],
    { arc: [-0.2, 0.2], thickness: 0.004, radial: 40 },
  );
  rig.add(shL, 'shell', 'shell', cap, { m: new Matrix4().makeRotationZ(s > 0 ? 0 : Math.PI).premultiply(T(s * 0.0, 0, -0.035)) });
  placeActuator({ rig, fam: ACTUATORS.A60, seg: shL, child: rollL, jointOrigin: new Vector3(), axis: new Vector3(0, 0, 1), face: new Vector3(0, 0, -0.052) });

  // ── roll link: L-bracket from the roll flange down to the upper-arm yaw actuator
  rig.add(rollL, 'anodized', 'structure', plate(0.06, 0.12, 0.012, 0.006), { m: T(0, -0.04, -0.046) });
  rig.add(rollL, 'anodized', 'structure', plate(0.07, 0.012, 0.1, 0.005), { m: T(0, -0.056, -0.004) });
  placeActuator({ rig, fam: ACTUATORS.A60, seg: rollL, child: ua, jointOrigin: new Vector3(), axis: new Vector3(0, -1, 0), face: new Vector3(0, -0.128, 0) });

  // ── upper arm: member, a light sleeve, the elbow actuator
  rig.add(ua, 'anodized', 'structure', tube(0.018, -Lu + 0.045, -0.13, 28));
  rig.add(ua, 'anodized', 'structure', new RoundedBoxGeometry(0.07, 0.03, 0.05, 2, 0.008), { m: T(s * 0.006, -Lu + 0.058, 0) });
  const sleeve = loft(
    [
      { y: -0.132, w: 0.04, d: 0.042, n: 2.6 },
      { y: -0.17, w: 0.045, d: 0.046, n: 2.7, front: 0.004 },
      { y: -Lu + 0.06, w: 0.04, d: 0.042, n: 2.6 },
    ],
    { thickness: 0.004, radial: 48 },
  );
  rig.add(ua, 'shell', 'shell', sleeve);
  rig.add(ua, 'shellDark', 'shell', ringPart(0.036, 0.043, -0.134, -0.128, 0.001, 40));
  placeActuator({
    rig,
    fam: ACTUATORS.A80,
    seg: ua,
    child: fa,
    jointOrigin: new Vector3(0, -Lu, 0),
    axis: new Vector3(-s, 0, 0),
    face: new Vector3(-s * 0.037, -Lu, 0),
    part: side === 'L' ? 'act:L_elbow' : undefined,
  });

  // ── forearm: clevis from the elbow flange, wrist yaw actuator, cover
  rig.add(fa, 'anodized', 'structure', plate(0.01, 0.1, 0.07, 0.006), { m: T(-s * 0.042, -0.02, 0) });
  rig.add(fa, 'anodized', 'structure', plate(0.06, 0.012, 0.06, 0.005), { m: T(-s * 0.014, -0.05, 0) });
  placeActuator({ rig, fam: ACTUATORS.A45, seg: fa, child: wl, jointOrigin: new Vector3(0, -WRIST_YAW_Y, 0), axis: new Vector3(0, -1, 0), face: new Vector3(0, -WRIST_YAW_Y, 0), kind: 'harmonic' });
  const fcov = loft(
    [
      { y: -0.052, w: 0.036, d: 0.037, n: 2.6 },
      { y: -0.085, w: 0.039, d: 0.04, n: 2.7, front: 0.002 },
      { y: -WRIST_YAW_Y + 0.004, w: 0.036, d: 0.037, n: 2.6 },
    ],
    { thickness: 0.0035, radial: 48 },
  );
  rig.add(fa, 'shell', 'shell', fcov);

  // ── wrist link (turns with wrist yaw): two stacked wrist actuators under a cover
  const wA = actuatorExterior(ACTUATORS.A45.housingOD, ACTUATORS.A45.housingLength, 'harmonic');
  for (const [i, y0] of [
    [0, -0.004],
    [1, -0.07],
  ] as const) {
    const m = alongAxis(new Vector3(0, -1, 0), new Vector3(0, y0, 0), i * 0.6);
    for (const pc of wA.housing) rig.add(wl, pc.look, 'actuator', pc.geo, { m });
    for (const pc of wA.output) rig.add(wl, pc.look, 'actuator', pc.geo, { m });
  }
  const wcov = loft(
    [
      { y: 0.0, w: 0.036, d: 0.037, n: 2.6 },
      { y: -0.06, w: 0.035, d: 0.036, n: 2.8 },
      { y: -wristY + 0.018, w: 0.03, d: 0.031, n: 2.8 },
    ],
    { thickness: 0.0035, radial: 48 },
  );
  rig.add(wl, 'shell', 'shell', wcov, { part: `${side}_wrist_cover` });
  rig.add(wl, 'shellDark', 'shell', ringPart(0.028, 0.033, -wristY + 0.012, -wristY + 0.018, 0.0008, 40));
  // wrist clevis
  for (const c of [1, -1]) rig.add(wl, 'anodized', 'structure', new RoundedBoxGeometry(0.008, 0.03, 0.03, 2, 0.003), { m: T(c * 0.024, -wristY + 0.006, 0) });
  // wrist cross
  rig.add(wc, 'steel', 'structure', new RoundedBoxGeometry(0.03, 0.016, 0.03, 2, 0.004));
  rig.add(wc, 'aluBright', 'structure', new CylinderGeometry(0.004, 0.004, 0.052, 12).rotateZ(Math.PI / 2));

  // wrist rods: from cranks at the bottom of the wrist actuators to lugs on the hand's back
  const rodBase = [new Vector3(0.013, -wristY + 0.03, -0.02), new Vector3(-0.013, -wristY + 0.03, -0.02)];
  const lugs = [new Vector3(0.013, -0.012, -0.018), new Vector3(-0.013, -0.012, -0.018)];
  const rods: Group[] = [];
  for (let i = 0; i < 2; i++) {
    const g = new Group();
    g.position.copy(rodBase[i]);
    rig.seg.get(wl)!.add(g);
    rig.addTo(g, wl, 'titanium', 'structure', new CylinderGeometry(0.0022, 0.0022, 1, 10).translate(0, -0.5, 0), `${side}_wrist_rods`);
    rods.push(g);
  }

  // hand
  buildHand(rig, side);
  addPieces(rig, hand, 'sensor', boltCircle(5, 0.017, -0.004, 0.002).map((p) => ({ ...p, geo: p.geo.clone().rotateX(Math.PI) })));
  rig.add(hand, 'anodized', 'sensor', discPart(0.024, -0.02, -0.004, 0.0015, 40));
  rig.add(hand, 'aluBright', 'sensor', ringPart(0.024, 0.025, -0.014, -0.011, 0.0002, 40));
  for (const l of lugs) rig.add(hand, 'anodized', 'structure', new RoundedBoxGeometry(0.008, 0.012, 0.008, 1, 0.002), { m: T(l.x, l.y, l.z) });

  rig.anchor(`shoulder${side}`, shL, [s * 0.01, 0, 0]);
  rig.anchor(`elbowAct${side}`, ua, [0, -Lu, 0]);
  rig.anchor(`elbow${side}`, fa, [0, 0, 0.04]);
  rig.anchor(`wrist${side}`, wc, [0, 0, 0]);
  rig.anchor(`ftWrist${side}`, hand, [0, -0.012, 0.026]);

  const wlG = rig.seg.get(wl)!;
  const handG = rig.seg.get(hand)!;
  rig.onPose.push(() => {
    wlG.updateMatrixWorld(true);
    handG.updateMatrixWorld(true);
    const inv = new Matrix4().copy(wlG.matrixWorld).invert();
    for (let i = 0; i < 2; i++) {
      _w.copy(lugs[i]).applyMatrix4(handG.matrixWorld).applyMatrix4(inv);
      _v.subVectors(_w, rodBase[i]);
      const len = _v.length();
      _q.setFromUnitVectors(new Vector3(0, -1, 0), _v.normalize());
      rods[i].quaternion.copy(_q);
      rods[i].scale.set(1, Math.max(0.001, len), 1);
    }
  });
}
