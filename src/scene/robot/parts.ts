/**
 * Part builders shared by the robot: actuator exteriors (from each family's housing diameter
 * and length), bolt circles, brackets, tubes and cables. All geometry is built along +Y and
 * placed with a matrix; units are metres.
 */
import { BufferGeometry, CatmullRomCurve3, CylinderGeometry, Matrix4, Quaternion, TubeGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Profile, discPart, ringPart } from '../geo/lathe';
import type { LookName } from '../materials';

export interface Piece {
  geo: BufferGeometry;
  look: LookName;
}

const Y = new Vector3(0, 1, 0);

/** Matrix placing a +Y-built part so its axis runs along `axis`, its base at `at`. */
export function alongAxis(axis: Vector3, at: Vector3, spin = 0): Matrix4 {
  const q = new Quaternion().setFromUnitVectors(Y, axis.clone().normalize());
  if (spin) q.multiply(new Quaternion().setFromAxisAngle(Y, spin));
  return new Matrix4().compose(at, q, new Vector3(1, 1, 1));
}

export function transformed(g: BufferGeometry, m: Matrix4): BufferGeometry {
  return g.clone().applyMatrix4(m);
}

/** A socket-head cap screw head (and its dark socket), standing on y = 0, pointing +Y. */
export function screwHead(d: number): Piece[] {
  const h = d * 0.9;
  // a cap head with a chamfered top edge and a dark recessed socket (a small inner step)
  const head = Profile.from(0, 0)
    .to(d / 2, 0)
    .to(d / 2, h * 0.84)
    .to(d * 0.42, h)
    .to(d * 0.26, h)
    .to(d * 0.26, h * 0.8)
    .to(0, h * 0.8)
    .build(10);
  return [{ geo: head, look: 'steel' }];
}

/** Bolts on a circle of radius r (in the XZ plane at height y), `n` of them, heads up. */
export function boltCircle(n: number, r: number, y: number, d = 0.003, phase = 0): Piece[] {
  const out: Piece[] = [];
  const unit = screwHead(d);
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const m = new Matrix4().makeTranslation(Math.sin(a) * r, y, Math.cos(a) * r);
    for (const p of unit) out.push({ geo: transformed(p.geo, m), look: p.look });
  }
  return out;
}

export interface ActuatorExterior {
  /** Parts fixed to the housing (stator side). */
  housing: Piece[];
  /** Parts that turn with the output (child side). */
  output: Piece[];
  /** Length along +Y from the rear cap (y = 0) to the output face (y = L). */
  length: number;
  radius: number;
}

/**
 * The outside of a rotary actuator along +Y: rear cap with connector and status ring at y = 0,
 * finned motor section, a seam, the reducer section, and the machined output flange at the top
 * (which turns with the joint's child).
 */
export function actuatorExterior(od: number, length: number, kind: 'cycloidal' | 'planetary' | 'harmonic' = 'cycloidal'): ActuatorExterior {
  const R = od / 2;
  const L = length;
  const housing: Piece[] = [];
  const output: Piece[] = [];
  const flangeH = Math.max(0.006, L * 0.1);
  const bodyTop = L - flangeH;
  // main housing profile (bead-blasted aluminium)
  const p = Profile.from(0, 0.004)
    .to(R * 0.62, 0.004)
    .chamfer(0.0012)
    .to(R * 0.66, 0.0)
    .to(R * 0.9, 0.0)
    .fillet(0.002)
    .to(R * 0.97, 0.004);
  // fins over the motor section
  const finTop = L * 0.46;
  const pitch = Math.max(0.0028, R * 0.07);
  let y = 0.008;
  p.to(R, y);
  while (y + pitch < finTop) {
    p.to(R, y + pitch * 0.55);
    p.to(R * 0.965, y + pitch * 0.62);
    p.to(R * 0.965, y + pitch * 0.93);
    p.to(R, y + pitch);
    y += pitch;
  }
  p.to(R, finTop + 0.002);
  // a seam between the motor and reducer halves
  p.groove(R, L * 0.52, 0.0012, 0.0016);
  p.to(R, bodyTop - 0.003).chamfer(0.0015).to(R * 0.93, bodyTop).to(R * 0.8, bodyTop);
  housing.push({ geo: p.build(44), look: 'alu' });
  // dark anodised rear cap with the connector
  housing.push({ geo: discPart(R * 0.6, 0.0, 0.0045, 0.0008, 36), look: 'anodized' });
  const conn = new RoundedBoxGeometry(R * 0.5, 0.012, R * 0.28, 2, 0.002).translate(0, -0.004, R * 0.25);
  housing.push({ geo: conn, look: 'shellDark' });
  const gland = new CylinderGeometry(R * 0.07, R * 0.07, 0.01, 12).rotateX(Math.PI / 2).translate(0, -0.004, R * 0.43);
  housing.push({ geo: gland, look: 'cable' });
  // status ring (quiet violet)
  housing.push({ geo: ringPart(R * 0.63, R * 0.66, -0.0006, 0.0006, 0.0001, 36), look: 'statusDim' });
  // rear-cap screws
  housing.push(...boltCircle(6, R * 0.78, 0.0, Math.max(0.0022, R * 0.05)).map((b) => ({ ...b, geo: b.geo.clone().rotateX(Math.PI).translate(0, 0, 0) })));
  // output flange: machined, bright, with a bolt circle and a dark centre cap
  const fl = Profile.from(R * 0.3, bodyTop + 0.0005)
    .to(R * 0.84, bodyTop + 0.0005)
    .to(R * 0.84, L - 0.0012)
    .chamfer(0.001)
    .to(R * 0.8, L)
    .to(R * 0.3, L)
    .build(44);
  output.push({ geo: fl, look: 'aluBright' });
  output.push({ geo: discPart(R * 0.3, L - 0.003, L + 0.0005, 0.0006, 24), look: 'anodized' });
  output.push(...boltCircle(8, R * 0.62, L, Math.max(0.0022, R * 0.045), Math.PI / 8));
  // harmonic drives are longer and slimmer at the output: a small step ring
  if (kind === 'harmonic') housing.push({ geo: ringPart(R * 0.84, R * 0.99, bodyTop - 0.008, bodyTop - 0.002, 0.0005, 48), look: 'anodized' });
  return { housing, output, length: L, radius: R };
}

/** A straight tube (structural member) along +Y from y0 to y1. */
export function tube(r: number, y0: number, y1: number, segments = 32): BufferGeometry {
  return new CylinderGeometry(r, r, y1 - y0, segments, 1, false).translate(0, (y0 + y1) / 2, 0);
}

/** A cable (or bundle) along a smooth path through points. */
export function cable(points: Vector3[], r: number, tubular = 32, radial = 8): BufferGeometry {
  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  return new TubeGeometry(curve, tubular, r, radial, false);
}

/** A rounded plate (bracket), centred at the origin. */
export function plate(w: number, h: number, t: number, r = 0.004): BufferGeometry {
  return new RoundedBoxGeometry(w, h, t, 2, Math.min(r, t / 2 - 1e-4));
}

/** A clevis: two cheek plates either side of a joint, joined by a bridge. Axis along X. */
export function clevis(gap: number, cheekT: number, height: number, depth: number, bridgeY: number): BufferGeometry[] {
  const cheek = plate(cheekT, height, depth, 0.004);
  const l = cheek.clone().translate(-(gap / 2 + cheekT / 2), -height / 2 + 0.01, 0);
  const r = cheek.clone().translate(gap / 2 + cheekT / 2, -height / 2 + 0.01, 0);
  const bridge = plate(gap + cheekT * 2, 0.012, depth, 0.004).translate(0, bridgeY, 0);
  return [l, r, bridge];
}
