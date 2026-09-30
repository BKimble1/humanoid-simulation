/**
 * The hand: a palm with six finger actuators inside, four fingers of three phalanges and a
 * two-segment thumb, silicone tactile pads on the palmar side. Each finger's joints are coupled
 * by its linkage (one actuator per finger; two for the thumb), so a hand pose is six numbers.
 *
 * Orientation (left hand, arm hanging): fingers point −Y, the palm faces the body (−X), the
 * index finger is at the front (+Z). The right hand is the mirror image.
 */
import { CylinderGeometry, Group, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { HAND, type Side } from '../../spec/body';
import { loft } from '../geo/loft';
import type { RobotRig } from './rig';
import { T } from './build';

export interface HandPose {
  /** Flexion of index, middle, ring and little fingers, 0 (open) … 1 (closed fist). */
  fingers: [number, number, number, number];
  /** Thumb flexion (towards the palm) and opposition (across it), 0 … 1. */
  thumbFlex: number;
  thumbOpp: number;
  /** Spread of the fingers (abduction), 0 … 1. */
  spread: number;
}

export const OPEN_HAND: HandPose = { fingers: [0.12, 0.12, 0.14, 0.16], thumbFlex: 0.1, thumbOpp: 0.2, spread: 0.1 };

export const handPoses: Record<Side, HandPose> = {
  L: { ...OPEN_HAND, fingers: [...OPEN_HAND.fingers] },
  R: { ...OPEN_HAND, fingers: [...OPEN_HAND.fingers] },
};

const DEG = Math.PI / 180;

export function buildHand(rig: RobotRig, side: Side) {
  const s = side === 'L' ? 1 : -1;
  const H = `${side}_hand` as const;
  // palm: light back cover, dark palmar pad, graphite core
  const core = loft(
    [
      { y: -0.02, w: 0.014, d: 0.036, n: 3.2 },
      { y: -0.05, w: 0.0165, d: 0.043, n: 3.6 },
      { y: -0.096, w: 0.015, d: 0.043, n: 3.6 },
    ],
    { capTop: 'flat', capBottom: 'flat', radial: 48 },
  );
  rig.add(H, 'shellDark', 'hand', core);
  const back = loft(
    [
      { y: -0.024, w: 0.0165, d: 0.038, n: 3.2 },
      { y: -0.05, w: 0.0185, d: 0.0445, n: 3.6 },
      { y: -0.094, w: 0.017, d: 0.0445, n: 3.6 },
    ],
    { arc: s > 0 ? [-0.16, 0.16] : [0.34, 0.66], thickness: 0.003, radial: 40 },
  );
  rig.add(H, 'shell', 'shell', back);
  const pad = loft(
    [
      { y: -0.03, w: 0.0165, d: 0.036, n: 3.2 },
      { y: -0.05, w: 0.0185, d: 0.042, n: 3.6 },
      { y: -0.093, w: 0.017, d: 0.042, n: 3.6 },
    ],
    { arc: s > 0 ? [0.36, 0.64] : [-0.14, 0.14], thickness: 0.003, radial: 40 },
  );
  rig.add(H, 'silicone', 'sensor', pad);
  // finger actuators inside the palm (x-ray)
  for (let i = 0; i < 6; i++) {
    const z = -0.03 + i * 0.012;
    rig.add(H, 'alu', 'actuator', new CylinderGeometry(0.0055, 0.0055, 0.034, 16), { m: T(0, -0.055, z) });
  }
  rig.add(H, 'anodized', 'structure', new CylinderGeometry(0.004, 0.004, 0.086, 12).rotateX(Math.PI / 2), { m: T(0, -0.097, 0) });

  // fingers
  const fingerZ = [0.0285, 0.0095, -0.0095, -0.0285];
  const names = ['index', 'middle', 'ring', 'little'] as const;
  const joints: { g: Group[]; finger: number }[] = [];
  for (let f = 0; f < 4; f++) {
    const lens = HAND.phalanges[names[f]];
    const base = new Group();
    base.name = `${side}_${names[f]}`;
    base.position.set(0, f === 3 ? -0.094 : -0.099, fingerZ[f]);
    const handG = rig.seg.get(H)!;
    handG.add(base);
    const chain: Group[] = [];
    let parent: Group = base;
    for (let k = 0; k < lens.length; k++) {
      const g = new Group();
      if (k > 0) g.position.set(0, -lens[k - 1], 0);
      parent.add(g);
      const L = lens[k];
      const w = 0.0165 - k * 0.0012;
      const t = 0.0168 - k * 0.0012;
      const part = `${side}_finger_${names[f]}_${k}`;
      rig.addTo(g, H, k === lens.length - 1 ? 'shell' : 'shellDark', 'hand', new RoundedBoxGeometry(t, L - 0.002, w, 3, Math.min(0.0055, t / 2 - 0.0005)).translate(0, -L / 2, 0), part);
      rig.addTo(g, H, 'steel', 'hand', new CylinderGeometry(0.0026, 0.0026, w + 0.002, 12).rotateX(Math.PI / 2), part);
      // tactile pad on the palmar face
      rig.addTo(g, H, 'silicone', 'sensor', new RoundedBoxGeometry(0.0035, L - 0.006, w - 0.003, 2, 0.0015).translate(-s * (t / 2), -L / 2 - 0.001, 0), part);
      chain.push(g);
      parent = g;
    }
    joints.push({ g: chain, finger: f });
    // the index fingertip's pad, on the distal phalanx (it follows the finger as it curls)
    if (f === 0) rig.anchor(`fingertip${side}`, H, [-s * 0.009, -lens[lens.length - 1] * 0.6, 0], chain[chain.length - 1]);
  }
  // thumb: two segments on a base that swings in front of the palm and across it
  const tb = new Group();
  tb.name = `${side}_thumb`;
  tb.position.set(-s * 0.006, -0.03, 0.038);
  rig.seg.get(H)!.add(tb);
  const t1 = new Group();
  tb.add(t1);
  const t2 = new Group();
  t2.position.set(0, -HAND.phalanges.thumb[0], 0);
  t1.add(t2);
  for (const [k, g] of [
    [0, t1],
    [1, t2],
  ] as const) {
    const L = HAND.phalanges.thumb[k];
    const part = `${side}_thumb_${k}`;
    rig.addTo(g, H, k === 1 ? 'shell' : 'shellDark', 'hand', new RoundedBoxGeometry(0.018, L - 0.002, 0.018, 3, 0.0065).translate(0, -L / 2, 0), part);
    rig.addTo(g, H, 'steel', 'hand', new CylinderGeometry(0.0028, 0.0028, 0.02, 12).rotateX(Math.PI / 2), part);
    rig.addTo(g, H, 'silicone', 'sensor', new RoundedBoxGeometry(0.004, L - 0.008, 0.014, 2, 0.0015).translate(-s * 0.009, -L / 2, 0), part);
  }
  rig.anchor(`palm${side}`, H, [-s * 0.02, -0.07, 0]);
  rig.anchor(`thumbtip${side}`, H, [-s * 0.02, -0.1, 0.04]);

  const axis = new Vector3(0, 0, -s);
  const X = new Vector3(1, 0, 0);
  rig.onPose.push(() => {
    const hp = handPoses[side];
    for (const j of joints) {
      const v = hp.fingers[j.finger];
      const spread = (j.finger - 1.5) * hp.spread * 5 * DEG;
      const [a, b, c] = [v * 78 * DEG, v * 95 * DEG, v * 62 * DEG];
      j.g[0].quaternion.setFromAxisAngle(axis, a);
      j.g[0].rotateOnAxis(X, -spread);
      j.g[1].quaternion.setFromAxisAngle(axis, b);
      j.g[2].quaternion.setFromAxisAngle(axis, c);
    }
    // thumb: splayed forward at rest; flexion swings it in front of the palm, opposition across
    tb.quaternion.setFromAxisAngle(X, -(12 - hp.thumbOpp * 30) * DEG);
    tb.rotateOnAxis(axis, (8 + hp.thumbFlex * 42) * DEG);
    t1.quaternion.setFromAxisAngle(X, hp.thumbOpp * 20 * DEG);
    t2.quaternion.setFromAxisAngle(axis, hp.thumbFlex * 38 * DEG);
  });
}
