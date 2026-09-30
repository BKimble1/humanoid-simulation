/**
 * Legs. Hip: yaw actuator in the pelvis saddle (vertical), roll actuator behind the hip
 * (axis forward), pitch actuator at the side (axis lateral), all three axes through the hip
 * centre. Thigh: the knee actuator sits high on its outer side and drives the knee through a
 * parallel push rod (both cranks equal and parallel, so the rod only translates and the
 * transmission is 1:1). Shin: two ball-screw linear actuators on the calf drive the ankle's
 * pitch and roll through rods to the heel. The rods and cranks move every frame from the pose.
 */
import { CylinderGeometry, Group, Matrix4, Quaternion, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ACTUATORS, ANKLE_LINEAR } from '../../spec/actuators';
import { DIM, KNEE_CRANK, KNEE_DRIVE_Y, type Side } from '../../spec/body';
import type { LimbScale } from '../../engine/skeleton';
import { Profile, discPart, ringPart } from '../geo/lathe';
import { loft } from '../geo/loft';
import { actuatorExterior, alongAxis, boltCircle, plate, tube } from './parts';
import type { RobotRig } from './rig';
import { T, X, addPieces, placeActuator } from './build';

const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();

export function buildLeg(rig: RobotRig, side: Side, scale: LimbScale) {
  const s = side === 'L' ? 1 : -1;
  const yawL = `${side}_hip_yaw_link` as const;
  const rollL = `${side}_hip_roll_link` as const;
  const thigh = `${side}_thigh` as const;
  const shin = `${side}_shin` as const;
  const ankleL = `${side}_ankle_link` as const;
  const foot = `${side}_foot` as const;
  const Lt = DIM.thigh * scale.thigh;
  const Ls = DIM.shin * scale.shin;

  // ── hip yaw link: an L-bracket from the yaw flange back and down to the roll actuator
  rig.add(yawL, 'anodized', 'structure', plate(0.072, 0.012, 0.2, 0.005), { m: T(0, 0.058, -0.066) });
  rig.add(yawL, 'anodized', 'structure', plate(0.108, 0.13, 0.012, 0.006), { m: T(0, 0.0, -0.158) });
  rig.add(yawL, 'anodized', 'structure', plate(0.012, 0.06, 0.09, 0.004), { m: T(s * 0.03, 0.03, -0.12) });
  rig.add(yawL, 'anodized', 'structure', plate(0.012, 0.06, 0.09, 0.004), { m: T(-s * 0.03, 0.03, -0.12) });
  placeActuator({ rig, fam: ACTUATORS.A100, seg: yawL, child: rollL, jointOrigin: new Vector3(), axis: new Vector3(0, 0, 1), face: new Vector3(0, 0, -0.065) });
  // hip fairing: a sculpted cover over the roll actuator and its bracket (rides on the yaw link)
  const fairing = loft(
    [
      { y: 0.078, w: 0.064, d: 0.07, n: 2.7 },
      { y: 0.12, w: 0.07, d: 0.076, n: 2.8 },
      { y: 0.158, w: 0.064, d: 0.07, n: 2.6 },
    ],
    { capTop: { dome: 0.026 }, radial: 56, thickness: 0.004 },
  );
  // loft Y → −Z (backwards), loft Z → +Y (up)
  rig.add(yawL, 'shell', 'shell', fairing, { m: new Matrix4().makeRotationX(-Math.PI / 2).premultiply(T(0, 0.012, 0)) });
  rig.add(yawL, 'shellDark', 'shell', ringPart(0.058, 0.066, -0.0, 0.006, 0.0008, 48).rotateX(-Math.PI / 2), { m: T(0, 0.012, -0.078) });

  // ── hip roll link: a bracket from the roll flange around to the pitch actuator's rear
  rig.add(rollL, 'anodized', 'structure', plate(0.13, 0.1, 0.012, 0.006), { m: T(s * 0.045, 0, -0.061) });
  rig.add(rollL, 'anodized', 'structure', plate(0.012, 0.1, 0.1, 0.006), { m: T(s * 0.106, 0, -0.018) });
  rig.add(rollL, 'anodized', 'structure', new RoundedBoxGeometry(0.03, 0.03, 0.05, 2, 0.006), { m: T(s * 0.1, 0.035, -0.04) });
  placeActuator({
    rig,
    fam: ACTUATORS.A100,
    seg: rollL,
    child: thigh,
    jointOrigin: new Vector3(),
    axis: new Vector3(-s, 0, 0),
    face: new Vector3(s * 0.012, 0, 0),
    part: side === 'L' ? 'act:L_hip_pitch' : undefined,
  });

  // ── thigh: a machined blade from the hip flange, the member tube, the knee clevis
  const blade = loft(
    [
      { y: 0.045, w: 0.006, d: 0.05, n: 3 },
      { y: -0.08, w: 0.006, d: 0.046, n: 3 },
      { y: -0.2, w: 0.006, d: 0.034, n: 3 },
    ],
    { capTop: 'flat', capBottom: 'flat', radial: 32 },
  );
  rig.add(thigh, 'anodized', 'structure', blade, { m: T(s * 0.008, 0, 0) });
  rig.add(thigh, 'anodized', 'structure', tube(0.025, -Lt + 0.05, -0.19, 32));
  rig.add(thigh, 'anodized', 'structure', ringPart(0.025, 0.029, -0.2, -0.186, 0.001, 32));
  // knee clevis cheeks (outer), either side of the shin's lug
  for (const c of [1, -1]) rig.add(thigh, 'anodized', 'structure', new RoundedBoxGeometry(0.012, 0.075, 0.07, 2, 0.005), { m: T(c * 0.04, -Lt + 0.025, 0) });
  rig.add(thigh, 'anodized', 'structure', new RoundedBoxGeometry(0.092, 0.024, 0.06, 2, 0.006), { m: T(0, -Lt + 0.06, 0) });
  rig.add(thigh, 'aluBright', 'structure', discPart(0.017, -0.0015, 0.0015, 0.0005, 32).rotateZ(Math.PI / 2), { m: T(0.047, -Lt, 0) });
  rig.add(thigh, 'aluBright', 'structure', discPart(0.017, -0.0015, 0.0015, 0.0005, 32).rotateZ(Math.PI / 2), { m: T(-0.047, -Lt, 0) });

  // knee actuator, high on the outer side (its output crank turns with the knee)
  const kneeFam = ACTUATORS.A100;
  const kneeExt = actuatorExterior(kneeFam.housingOD, kneeFam.housingLength, 'cycloidal');
  const kneeAxisPos = new Vector3(s * 0.028, -KNEE_DRIVE_Y, 0);
  const kneeM = alongAxis(new Vector3(-s, 0, 0), kneeAxisPos.clone().add(new Vector3(s * kneeExt.length, 0, 0)));
  const kneePart = side === 'L' ? 'act:L_knee' : `act:${side}_knee_body`;
  const kneeHold = rig.holder(thigh, kneePart);
  rig.partFrames.set(kneePart, kneeM.clone());
  for (const pc of kneeExt.housing) rig.addTo(kneeHold, thigh, pc.look, 'actuator', pc.geo, kneePart, kneeM);
  // the output flange and crank rotate about the actuator axis with the knee angle
  const crankTop = new Group();
  crankTop.name = `${side}_knee_crank_top`;
  crankTop.position.copy(kneeAxisPos);
  rig.seg.get(thigh)!.add(crankTop);
  const toCrank = new Matrix4().makeTranslation(-kneeAxisPos.x, -kneeAxisPos.y, -kneeAxisPos.z).multiply(kneeM);
  for (const pc of kneeExt.output) rig.addTo(crankTop, thigh, pc.look, 'actuator', pc.geo, side === 'L' ? 'act:L_knee:out' : `${side}_knee_out`, toCrank);
  const crankArm = (look: 'anodized' | 'aluBright') => {
    const g = new RoundedBoxGeometry(0.008, 0.026, KNEE_CRANK + 0.026, 2, 0.004).translate(0, 0, -KNEE_CRANK / 2);
    return { g, look };
  };
  const ca = crankArm('anodized');
  rig.addTo(crankTop, thigh, ca.look, 'structure', ca.g, `${side}_knee_crank_top`, T(-s * 0.004, 0, 0));
  rig.addTo(crankTop, thigh, 'aluBright', 'structure', new CylinderGeometry(0.006, 0.006, 0.016, 16).rotateZ(Math.PI / 2), `${side}_knee_crank_top`, T(-s * 0.004, 0, -KNEE_CRANK));

  // push rod (translates with the cranks)
  const rod = new Group();
  rod.name = `${side}_knee_rod`;
  rig.seg.get(thigh)!.add(rod);
  const rodLen = Lt - KNEE_DRIVE_Y;
  rig.addTo(rod, thigh, 'titanium', 'structure', new CylinderGeometry(0.0055, 0.0055, rodLen - 0.03, 16).translate(0, -rodLen / 2, 0), `${side}_knee_rod`);
  for (const y of [0, -rodLen]) rig.addTo(rod, thigh, 'anodized', 'structure', new RoundedBoxGeometry(0.014, 0.03, 0.02, 2, 0.006).translate(0, y + (y === 0 ? -0.01 : 0.01), 0), `${side}_knee_rod`);

  // thigh covers: a light "quadriceps" cover over the lower two thirds, a knee cap
  const quad = loft(
    [
      { y: -0.2, w: 0.052, d: 0.05, n: 2.8, front: 0.006 },
      { y: -0.26, w: 0.06, d: 0.056, n: 2.9, front: 0.014 },
      { y: -0.33, w: 0.058, d: 0.054, n: 2.9, front: 0.012 },
      { y: -Lt + 0.035, w: 0.05, d: 0.048, n: 2.8, front: 0.006 },
    ].map((q) => (q.y < -0.25 ? { ...q, y: -0.2 + ((q.y + 0.2) * (Lt - 0.235)) / (DIM.thigh - 0.235) } : q)),
    { arc: [0.02, 0.48], thickness: 0.004, radial: 56, perSpan: 8 },
  );
  rig.add(thigh, 'shell', 'shell', quad);
  const knee = loft(
    [
      { y: -Lt + 0.03, w: 0.048, d: 0.05, n: 2.6, front: 0.01 },
      { y: -Lt - 0.012, w: 0.046, d: 0.052, n: 2.6, front: 0.014 },
      { y: -Lt - 0.04, w: 0.038, d: 0.046, n: 2.4, front: 0.006 },
    ],
    { arc: [0.12, 0.38], thickness: 0.0035, radial: 40 },
  );
  rig.add(`${side}_shin`, 'shellDark', 'shell', knee, { m: T(0, Lt, 0).premultiply(new Matrix4()) });
  // (the knee cap rides on the shin: its geometry was built in thigh coordinates, shifted by Lt)

  // ── shin: lug in the knee clevis, crank, member, calf actuators, ankle clevis
  rig.add(shin, 'anodized', 'structure', new RoundedBoxGeometry(0.036, 0.07, 0.056, 2, 0.008), { m: T(0, -0.012, 0) });
  rig.add(shin, 'steel', 'structure', new CylinderGeometry(0.012, 0.012, 0.096, 24).rotateZ(Math.PI / 2));
  const crankLow = new RoundedBoxGeometry(0.008, 0.026, KNEE_CRANK + 0.026, 2, 0.004).translate(0, 0, -KNEE_CRANK / 2);
  rig.add(shin, 'anodized', 'structure', crankLow, { m: T(s * 0.025, 0, 0) });
  rig.add(shin, 'aluBright', 'structure', new CylinderGeometry(0.006, 0.006, 0.016, 16).rotateZ(Math.PI / 2), { m: T(s * 0.025, 0, -KNEE_CRANK) });
  rig.add(shin, 'anodized', 'structure', tube(0.0225, -Ls + 0.05, -0.04, 32), { m: T(0, 0, 0.004) });
  rig.add(shin, 'anodized', 'structure', new RoundedBoxGeometry(0.1, 0.02, 0.05, 2, 0.006), { m: T(0, -0.045, -0.035) });
  for (const c of [1, -1]) rig.add(shin, 'anodized', 'structure', new RoundedBoxGeometry(0.01, 0.06, 0.05, 2, 0.004), { m: T(c * 0.029, -Ls + 0.022, 0) });
  rig.add(shin, 'anodized', 'structure', new RoundedBoxGeometry(0.066, 0.02, 0.05, 2, 0.006), { m: T(0, -Ls + 0.058, 0) });
  // tibia cover (light)
  const tib = loft(
    [
      { y: -0.07, w: 0.042, d: 0.04, n: 2.8, front: 0.012 },
      { y: -0.14, w: 0.044, d: 0.042, n: 2.8, front: 0.016 },
      { y: -Ls + 0.075, w: 0.036, d: 0.036, n: 2.6, front: 0.008 },
    ],
    { arc: [0.08, 0.42], thickness: 0.0035, radial: 48 },
  );
  rig.add(shin, 'shell', 'shell', tib, { m: T(0, 0, 0.004) });

  // ankle linear actuators: pivot at the top on the shin, rod to the heel lug on the foot
  const pivots: Vector3[] = [];
  const bodies: Group[] = [];
  const rods: Group[] = [];
  for (const c of [1, -1]) {
    const pivot = new Vector3(c * ANKLE_LINEAR.rollArm, -0.05, -0.058);
    pivots.push(pivot);
    rig.add(shin, 'anodized', 'structure', new RoundedBoxGeometry(0.03, 0.02, 0.03, 2, 0.005), { m: T(pivot.x, pivot.y + 0.012, pivot.z + 0.004) });
    const body = new Group();
    body.name = `${side}_ankle_act_${c > 0 ? 'a' : 'b'}`;
    body.position.copy(pivot);
    rig.seg.get(shin)!.add(body);
    // built along −Y from the pivot: motor can, belt housing, screw tube
    const part = `${side}_ankle_act`;
    const motor = Profile.from(0, 0)
      .to(0.023, 0)
      .chamfer(0.002)
      .to(0.025, -0.004)
      .to(0.025, -0.058)
      .chamfer(0.002)
      .to(0.021, -0.062)
      .to(0, -0.062)
      .build(40);
    rig.addTo(body, shin, 'alu', 'actuator', motor, part);
    rig.addTo(body, shin, 'anodized', 'actuator', ringPart(0.0235, 0.0255, -0.03, -0.026, 0.0004, 40), part);
    rig.addTo(body, shin, 'anodized', 'actuator', new CylinderGeometry(0.019, 0.019, ANKLE_LINEAR.bodyLength - 0.062, 32).translate(0, -0.062 - (ANKLE_LINEAR.bodyLength - 0.062) / 2, 0), part);
    rig.addTo(body, shin, 'aluBright', 'actuator', ringPart(0.008, 0.02, -ANKLE_LINEAR.bodyLength - 0.004, -ANKLE_LINEAR.bodyLength, 0.0005, 32), part);
    rig.addTo(body, shin, 'statusDim', 'actuator', ringPart(0.0244, 0.0256, -0.012, -0.011, 0.0001, 32), part);
    bodies.push(body);
    const rodG = new Group();
    rodG.name = `${side}_ankle_rod_${c > 0 ? 'a' : 'b'}`;
    body.add(rodG);
    // unit-length rod along −Y (scaled to the needed extension each frame)
    rig.addTo(rodG, shin, 'steel', 'actuator', new CylinderGeometry(0.0062, 0.0062, 1, 16).translate(0, -0.5, 0), `${side}_ankle_rod`);
    rods.push(rodG);
  }
  // ankle cross
  rig.add(ankleL, 'steel', 'structure', new RoundedBoxGeometry(0.046, 0.026, 0.032, 2, 0.006));
  rig.add(ankleL, 'aluBright', 'structure', new CylinderGeometry(0.006, 0.006, 0.07, 16).rotateZ(Math.PI / 2));

  // ── foot: force/torque sensor, plate, sole, upper cover, heel lugs
  const Ft = foot;
  rig.add(Ft, 'anodized', 'sensor', discPart(0.036, -0.046, -0.028, 0.002, 48));
  rig.add(Ft, 'aluBright', 'sensor', ringPart(0.036, 0.0372, -0.04, -0.036, 0.0003, 48));
  addPieces(rig, Ft, 'sensor', boltCircle(6, 0.028, -0.028, 0.0025));
  rig.add(Ft, 'anodized', 'structure', new RoundedBoxGeometry(0.05, 0.02, 0.05, 2, 0.006), { m: T(0, -0.02, 0) });
  const L = DIM.toe - DIM.heel;
  const zc = (DIM.toe + DIM.heel) / 2;
  rig.add(Ft, 'alu', 'structure', new RoundedBoxGeometry(DIM.footWidth - 0.004, 0.012, L - 0.006, 3, 0.005), { m: T(0, -0.066, zc) });
  rig.add(Ft, 'rubber', 'structure', new RoundedBoxGeometry(DIM.footWidth, 0.013, L, 3, 0.0055), { m: T(0, -DIM.ankleHeight + 0.0065, zc) });
  // tread grooves on the sole's edge (a few dark lines)
  const upper = loft(
    [
      { y: DIM.heel + 0.002, w: 0.047, d: 0.018, n: 3.2 },
      { y: -0.02, w: 0.05, d: 0.03, n: 3.4 },
      { y: 0.06, w: 0.051, d: 0.026, n: 3.4 },
      { y: 0.13, w: 0.05, d: 0.016, n: 3.2 },
      { y: DIM.toe - 0.012, w: 0.044, d: 0.009, n: 3 },
    ],
    { arc: [0.5, 1.0], thickness: 0.003, radial: 48, perSpan: 6 },
  );
  // loft along Y → along the foot (Z), its −Z half turned up (+Y)
  rig.add(Ft, 'shell', 'shell', upper, { m: new Matrix4().makeRotationX(Math.PI / 2).premultiply(T(0, -0.059, 0)) });
  const toe = loft(
    [
      { y: DIM.toe - 0.03, w: 0.0525, d: 0.012, n: 3.2 },
      { y: DIM.toe - 0.002, w: 0.05, d: 0.01, n: 3 },
    ],
    { arc: [0.5, 1.0], thickness: 0.003, radial: 40, capTop: 'none' },
  );
  rig.add(Ft, 'shellDark', 'shell', toe, { m: new Matrix4().makeRotationX(Math.PI / 2).premultiply(T(0, -0.06, 0)) });
  const lugs: Vector3[] = [];
  for (const c of [1, -1]) {
    const lug = new Vector3(c * ANKLE_LINEAR.rollArm, -0.012, -ANKLE_LINEAR.pitchArm);
    lugs.push(lug);
    rig.add(Ft, 'anodized', 'structure', new RoundedBoxGeometry(0.018, 0.03, 0.02, 2, 0.005), { m: T(lug.x, lug.y - 0.018, lug.z) });
    rig.add(Ft, 'aluBright', 'structure', new CylinderGeometry(0.009, 0.009, 0.012, 16).rotateZ(Math.PI / 2), { m: T(lug.x, lug.y, lug.z) });
  }

  // anchors
  rig.anchor(`hip${side}`, rollL, [s * 0.06, 0, 0]);
  rig.anchor(`hipPitchAct${side}`, rollL, [s * 0.055, 0, 0]);
  rig.anchor(`hipRollAct${side}`, yawL, [0, 0, -0.11]);
  rig.anchor(`kneeAct${side}`, thigh, [s * 0.071, -KNEE_DRIVE_Y, 0]);
  rig.anchor(`knee${side}`, shin, [0, 0, 0.05]);
  rig.anchor(`kneeRod${side}`, thigh, [s * 0.025, -0.27, -0.045]);
  rig.anchor(`ankleAct${side}`, shin, [0, -0.13, -0.06]);
  rig.anchor(`ankle${side}`, foot, [0, 0, 0]);
  rig.anchor(`ft${side}`, foot, [s * 0.036, -0.037, 0]);
  rig.anchor(`sole${side}`, foot, [0, -DIM.ankleHeight, zc]);
  rig.anchor(`toe${side}`, foot, [0, -0.06, DIM.toe - 0.02]);

  // per-pose updates: knee crank and rod, ankle actuators aimed at the heel lugs
  const shinG = rig.seg.get(shin)!;
  const footG = rig.seg.get(foot)!;
  const rodTop = new Vector3(s * 0.025, -KNEE_DRIVE_Y, -KNEE_CRANK);
  rig.onPose.push(() => {
    // knee angle from the shin's rotation about +X relative to the thigh
    const q = shinG.quaternion;
    const angle = 2 * Math.atan2(q.x, q.w);
    crankTop.quaternion.setFromAxisAngle(X, angle);
    // rod: parallel to the thigh, its ends on both crank pins
    _v.set(0, 0, -KNEE_CRANK).applyAxisAngle(X, angle);
    rod.position.set(rodTop.x, -KNEE_DRIVE_Y + _v.y, _v.z);
    // ankle actuators: in shin coordinates, point each body at its lug
    shinG.updateMatrixWorld(true);
    footG.updateMatrixWorld(true);
    const inv = new Matrix4().copy(shinG.matrixWorld).invert();
    for (let i = 0; i < 2; i++) {
      _w.copy(lugs[i]).applyMatrix4(footG.matrixWorld).applyMatrix4(inv);
      _v.subVectors(_w, pivots[i]);
      const len = _v.length();
      _q.setFromUnitVectors(new Vector3(0, -1, 0), _v.normalize());
      bodies[i].quaternion.copy(_q);
      const ext = Math.max(0.005, len - ANKLE_LINEAR.bodyLength);
      rods[i].position.set(0, -ANKLE_LINEAR.bodyLength + 0.004, 0);
      rods[i].scale.set(1, ext, 1);
    }
  });
}
