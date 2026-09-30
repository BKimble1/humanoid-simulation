/**
 * An actuator opened up: every part of a cycloidal rotary actuator, built along +Y from the
 * rear cap (y = 0) to the output face (y = L), with the same outside as the exterior model so
 * the swap is invisible. Parts separate along the axis in a fixed order (explode 0 → 1) and
 * turn as the real mechanism does:
 *
 *   rotor and eccentric shaft   ω_m (motor speed)
 *   cycloidal discs             centre orbits at ω_m with eccentricity e; the disc turns
 *                               backwards at ω_m / (N − 1) (N ring pins, N − 1 lobes)
 *   output pins, flange         ω_out = −ω_m / (N − 1)
 *
 * The disc profile is the true epitrochoid for N pins of radius r on a pin circle R, with
 * eccentricity e (Shin & Kwon, 2006, the standard form).
 */
import {
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  Path,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ActuatorFamily } from '../../spec/actuators';
import { Profile, discPart, ringPart } from '../geo/lathe';
import { merge } from '../geo/merge';
import { fadeTwin, material, type FabMaterial, type LookName } from '../materials';
import { boltCircle } from '../robot/parts';

export interface AssemblyPart {
  id: string;
  label: string;
  /** What it does, in one or two sentences. */
  role: string;
  /** Engineering facts shown when the part is selected. */
  facts: string[];
  group: Group;
  /** Axial offset when fully exploded, m, and when it starts moving (0–1 of the explode). */
  explode: number;
  delay: number;
  /** Anchor for its label, in assembly coordinates. */
  anchor: [number, number, number];
}

function mesh(g: BufferGeometry, look: LookName): Mesh {
  const m = new Mesh(g, material(look));
  m.userData.look = look;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Cycloidal disc outline: N pins (N − 1 lobes), pin circle R, pin radius rr, eccentricity e. */
export function cycloidProfile(N: number, R: number, rr: number, e: number, samples = 720): Vector2[] {
  const pts: Vector2[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const psi = Math.atan2(Math.sin((1 - N) * t), R / (e * N) - Math.cos((1 - N) * t));
    const x = R * Math.cos(t) - rr * Math.cos(t + psi) - e * Math.cos(N * t);
    const y = -R * Math.sin(t) + rr * Math.sin(t + psi) + e * Math.sin(N * t);
    pts.push(new Vector2(x, y));
  }
  return pts;
}

export class ActuatorAssembly {
  root = new Group();
  parts: AssemblyPart[] = [];
  rotor!: Group;
  discs: Group[] = [];
  output: Group[] = [];
  bearingBalls!: Group;
  L: number;
  R: number;
  /** Ring pins: one more than the reduction ratio (N − 1 lobes on each disc). */
  N: number;
  /** Scale of the exploded spacing (keeps the whole stack in a close shot). */
  spread = 0.78;
  ecc: number;
  /** Motor rotor angle and output angle (rad). */
  rotorAngle = 0;

  constructor(fam: ActuatorFamily) {
    const R = fam.housingOD / 2;
    const L = fam.housingLength;
    this.L = L;
    this.R = R;
    this.N = Math.round(fam.reducer.ratio) + 1;
    const rotorR = R * 0.52;
    const statorIn = rotorR + 0.0012;
    const statorOut = R * 0.86;
    const ringPinR = R * 0.7;
    const N = this.N;
    // pins no fatter than a third of their spacing; eccentricity small enough for a valid
    // (non-looping) disc profile: e·N < pin-circle radius
    const pinR = Math.min(Math.max(0.0018, R * 0.042), ((2 * Math.PI * ringPinR) / N) * 0.3);
    const ecc = Math.min(Math.max(0.0008, R * 0.018), (ringPinR / N) * 0.7);
    this.ecc = ecc;

    const add = (id: string, label: string, role: string, facts: string[], explode: number, delay: number, anchor: [number, number, number], build: (g: Group) => void) => {
      const g = new Group();
      g.name = id;
      build(g);
      this.root.add(g);
      this.parts.push({ id, label, role, facts, group: g, explode, delay, anchor });
      return g;
    };

    // 1. rear cover with the connector
    add('cover', 'Rear cover and connector', 'Closes the actuator and brings in the DC bus, the EtherCAT link and the safe-torque-off lines.', ['Black-anodised aluminium', 'Sealed connector: power, data, STO'], -0.62, 0.0, [0, 0.003, R * 0.7], (g) => {
      g.add(mesh(discPart(R * 0.93, 0, 0.005, 0.0008, 56), 'anodized'));
      g.add(mesh(new RoundedBoxGeometry(R * 0.5, 0.012, R * 0.28, 2, 0.002).translate(0, -0.004, R * 0.25), 'shellDark'));
      g.add(mesh(ringPart(R * 0.63, R * 0.66, -0.0006, 0.0006, 0.0001, 40), 'statusDim'));
      for (const b of boltCircle(6, R * 0.8, 0, 0.0028)) g.add(mesh(b.geo.clone().rotateX(Math.PI), 'steel'));
    });
    // 2. drive board (motor controller)
    add('drive', 'Motor drive (inverter)', 'Three-phase MOSFET bridge and a microcontroller running field-oriented current control at 20 kHz, plus the joint impedance loop at 5 kHz.', ['Phase current sensing by shunts', '48 V class MOSFETs, ~97 % efficient', 'Winding temperature from an NTC'], -0.57, 0.03, [R * 0.5, 0.009, 0], (g) => {
      g.add(mesh(ringPart(R * 0.2, R * 0.86, 0.007, 0.0086, 0.0002, 56), 'pcb'));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(mesh(new RoundedBoxGeometry(0.008, 0.002, 0.006, 1, 0.0005).translate(Math.sin(a) * R * 0.66, 0.0096, Math.cos(a) * R * 0.66).rotateY(0), 'chip'));
      }
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        g.add(mesh(new CylinderGeometry(0.0035, 0.0035, 0.009, 16).translate(Math.sin(a) * R * 0.42, 0.013, Math.cos(a) * R * 0.42), 'alu'));
      }
      g.add(mesh(new RoundedBoxGeometry(0.009, 0.0015, 0.009, 1, 0.0005).translate(R * 0.3, 0.0095, -R * 0.3), 'chip'));
    });
    // 3. encoder: a diametric magnet on the shaft end and the encoder chip on its board
    add('encoder', 'Motor encoder', 'An absolute magnetic encoder reads the rotor angle (16-bit) for commutation and speed; a second, 19-bit encoder reads the output.', ['Rotor angle for field-oriented control', 'Two encoders: motor side and output side'], -0.53, 0.06, [0, 0.012, R * 0.35], (g) => {
      g.add(mesh(new CylinderGeometry(0.005, 0.005, 0.003, 24).translate(0, 0.0115, 0), 'chip'));
      g.add(mesh(ringPart(R * 0.1, R * 0.3, 0.0132, 0.0145, 0.0002, 32), 'pcbBlack'));
      g.add(mesh(new RoundedBoxGeometry(0.004, 0.0012, 0.004, 1, 0.0003).translate(0, 0.0152, 0), 'chip'));
    });
    // 4. rear bearing
    add('bearing', 'Rotor bearing', 'Supports the rotor and eccentric shaft; carries radial load from the discs.', ['Deep-groove ball bearing'], -0.49, 0.09, [R * 0.28, 0.018, 0], (g) => {
      g.add(mesh(ringPart(R * 0.2, R * 0.27, 0.016, 0.021, 0.0004, 40), 'steel'));
      g.add(mesh(ringPart(R * 0.1, R * 0.16, 0.016, 0.021, 0.0004, 40), 'steel'));
      const balls: BufferGeometry[] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        balls.push(new SphereGeometry(R * 0.025, 10, 8).translate(Math.sin(a) * R * 0.18, 0.0185, Math.cos(a) * R * 0.18));
      }
      g.add(mesh(merge(balls), 'steel'));
    });
    // 5. housing (the motor half, finned, bead-blasted), which the stator is bonded into
    const housingTop = L * 0.62;
    add('housing', 'Housing', 'Holds the stator and carries its heat out to the limb structure: copper losses flow winding → stator → housing → frame and air.', ['Aluminium: light and conductive', 'Thermal path ~0.4 K/W winding → housing'], -0.43, 0.12, [R, L * 0.3, 0], (g) => {
      const p = Profile.from(R * 0.9, 0.005).to(R * 0.97, 0.005);
      const pitch = Math.max(0.0028, R * 0.07);
      let y = 0.008;
      p.to(R, y);
      while (y + pitch < L * 0.46) {
        p.to(R, y + pitch * 0.55);
        p.to(R * 0.965, y + pitch * 0.62);
        p.to(R * 0.965, y + pitch * 0.93);
        p.to(R, y + pitch);
        y += pitch;
      }
      p.to(R, housingTop).to(R * 0.9, housingTop).to(R * 0.9, 0.005);
      g.add(mesh(p.build(56), 'alu'));
    });
    // 6. stator: laminations with teeth, copper windings
    add('stator', 'Stator', 'Laminated electrical-steel core with copper windings. Current in the windings makes the rotating magnetic field that pulls the rotor round: τ = Kt · I.', ['36 slots, concentrated windings', 'Class F insulation: 155 °C limit', 'Most of the actuator’s heat is made here (I²R)'], -0.37, 0.15, [statorOut, L * 0.33, 0], (g) => {
      const y0 = 0.022;
      const h = L * 0.3;
      const slots = 36;
      const shape = new Shape();
      shape.absarc(0, 0, statorOut, 0, Math.PI * 2, false);
      const hole = new Path();
      // inner outline with teeth: tooth tips at statorIn, slot bottoms deeper
      const pts: Vector2[] = [];
      for (let i = 0; i < slots; i++) {
        const a0 = (i / slots) * Math.PI * 2;
        const a1 = ((i + 0.62) / slots) * Math.PI * 2;
        const a2 = ((i + 1) / slots) * Math.PI * 2;
        const r1 = statorIn;
        const r2 = statorIn + (statorOut - statorIn) * 0.55;
        pts.push(new Vector2(Math.cos(a0) * r1, Math.sin(a0) * r1), new Vector2(Math.cos(a1) * r1, Math.sin(a1) * r1), new Vector2(Math.cos(a1) * r2, Math.sin(a1) * r2), new Vector2(Math.cos(a2) * r2, Math.sin(a2) * r2));
      }
      hole.setFromPoints(pts);
      shape.holes.push(hole);
      const core = new ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 48 }).rotateX(-Math.PI / 2).translate(0, y0, 0);
      g.add(mesh(core, 'lamination'));
      // windings: copper coil ends above and below the stack, and the copper in the slots
      const coils: BufferGeometry[] = [];
      for (let i = 0; i < slots; i++) {
        const a = ((i + 0.81) / slots) * Math.PI * 2;
        const r = statorIn + (statorOut - statorIn) * 0.3;
        coils.push(new RoundedBoxGeometry(0.0034, h + 0.006, (statorOut - statorIn) * 0.5, 1, 0.0012).translate(0, y0 + h / 2, 0).rotateY(0).translate(Math.cos(a) * r, 0, Math.sin(a) * r));
      }
      const w = merge(coils);
      g.add(mesh(w, 'copper'));
      g.add(mesh(new TorusGeometry(statorIn + (statorOut - statorIn) * 0.3, 0.0022, 8, 72).rotateX(Math.PI / 2).translate(0, y0 - 0.0015, 0), 'copper'));
      g.add(mesh(new TorusGeometry(statorIn + (statorOut - statorIn) * 0.3, 0.0022, 8, 72).rotateX(Math.PI / 2).translate(0, y0 + h + 0.0015, 0), 'copper'));
    });
    // 7. rotor: magnet ring on a hub, with the eccentric shaft for the discs
    this.rotor = add('rotor', 'Rotor', 'Permanent magnets on a steel hub. It spins at motor speed; its shaft carries the eccentric cams that drive the cycloidal discs.', ['NdFeB surface magnets, 20 poles', 'Rotor inertia × N² is what the joint "feels" (reflected inertia)'], -0.3, 0.18, [rotorR, L * 0.36, 0], (g) => {
      const y0 = 0.022;
      const h = L * 0.3;
      g.add(mesh(new CylinderGeometry(rotorR * 0.86, rotorR * 0.86, h, 48).translate(0, y0 + h / 2, 0), 'steelDark'));
      const mags: BufferGeometry[] = [];
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        mags.push(new RoundedBoxGeometry(rotorR * 0.26, h - 0.002, 0.0028, 1, 0.0006).translate(0, y0 + h / 2, 0).rotateY(-a + Math.PI / 2).translate(Math.cos(a) * rotorR * 0.94, 0, Math.sin(a) * rotorR * 0.94));
      }
      g.add(mesh(merge(mags), 'magnet'));
      g.add(mesh(new CylinderGeometry(R * 0.1, R * 0.1, L * 0.72, 24).translate(0, 0.012 + (L * 0.72) / 2, 0), 'steel'));
      // two eccentric cams (180° apart) where the discs sit
      g.add(mesh(new CylinderGeometry(R * 0.17, R * 0.17, 0.006, 32).translate(ecc, housingTop + 0.004, 0), 'steel'));
      g.add(mesh(new CylinderGeometry(R * 0.17, R * 0.17, 0.006, 32).translate(-ecc, housingTop + 0.011, 0), 'steel'));
    });
    // 8. cycloidal discs (two, 180° apart, to balance the eccentric load)
    const discOutline = cycloidProfile(this.N, ringPinR, pinR, ecc);
    const holes = 8;
    const holeR = R * 0.39;
    for (const k of [0, 1]) {
      const disc = add(k === 0 ? 'disc' : 'disc2', k === 0 ? 'Cycloidal discs' : 'Second cycloidal disc', `Each disc has ${N - 1} lobes rolling inside ${N} ring pins. Driven round by the eccentric, a disc turns backwards by one lobe per motor turn: a ${N - 1} : 1 reduction in one compact stage, with many lobes sharing the load.`, [`Ratio = pins − 1 = ${N - 1}`, 'Two discs 180° apart cancel the wobble', `Hardened steel, rolling contact: ~${Math.round(fam.reducer.efficiency * 100)} % efficient`], k === 0 ? -0.24 : -0.21, k === 0 ? 0.21 : 0.24, [ringPinR, housingTop + 0.006, 0], (g) => {
        const sh = new Shape(discOutline);
        for (let i = 0; i < holes; i++) {
          const a = (i / holes) * Math.PI * 2;
          const hp = new Path();
          hp.absarc(Math.cos(a) * holeR, Math.sin(a) * holeR, pinR * 1.9 + ecc, 0, Math.PI * 2, true);
          sh.holes.push(hp);
        }
        const bore = new Path();
        bore.absarc(0, 0, R * 0.17, 0, Math.PI * 2, true);
        sh.holes.push(bore);
        const geo = new ExtrudeGeometry(sh, { depth: 0.0056, bevelEnabled: true, bevelThickness: 0.0003, bevelSize: 0.0003, bevelSegments: 1, curveSegments: 16 }).rotateX(-Math.PI / 2).translate(0, housingTop + 0.001 + k * 0.007, 0);
        g.add(mesh(geo, 'steel'));
      });
      this.discs.push(disc);
    }
    // 9. ring-pin housing (the reducer half of the housing)
    add('ring', 'Ring-pin housing', `The fixed ring of ${N} hardened pins the discs roll against: it takes the reaction torque into the housing.`, [`${N} pins on the pin circle`, 'Forms the front half of the housing'], -0.17, 0.27, [R, housingTop + 0.008, 0], (g) => {
      const top = L * 0.9;
      const p = Profile.from(ringPinR + pinR * 0.6, housingTop).to(R, housingTop).groove(R, L * 0.74, 0.0012, 0.0016).to(R, top - 0.003).chamfer(0.0015).to(R * 0.93, top).to(ringPinR + pinR * 0.6, top).to(ringPinR + pinR * 0.6, housingTop);
      g.add(mesh(p.build(56), 'alu'));
      const pins: BufferGeometry[] = [];
      for (let i = 0; i < this.N; i++) {
        const a = (i / this.N) * Math.PI * 2;
        pins.push(new CylinderGeometry(pinR, pinR, 0.0145, 10).translate(Math.cos(a) * ringPinR, housingTop + 0.0075, -Math.sin(a) * ringPinR));
      }
      g.add(mesh(merge(pins), 'steel'));
    });
    // 10. output: pins through the disc holes, carrier, crossed-roller bearing, torque sensor, flange
    const out1 = add('outpins', 'Output pins and carrier', 'Pins through the discs’ holes pick up only their slow rotation (the holes are larger by twice the eccentricity), turning the output.', ['8 output pins with rollers', 'Output speed = motor speed ÷ 30'], -0.12, 0.3, [holeR, L * 0.8, 0], (g) => {
      const pins: BufferGeometry[] = [];
      for (let i = 0; i < holes; i++) {
        const a = (i / holes) * Math.PI * 2;
        pins.push(new CylinderGeometry(pinR * 1.9, pinR * 1.9, 0.02, 14).translate(Math.cos(a) * holeR, housingTop + 0.008, -Math.sin(a) * holeR));
      }
      g.add(mesh(merge(pins), 'steel'));
      g.add(mesh(ringPart(R * 0.2, R * 0.62, L * 0.8, L * 0.84, 0.0005, 48), 'steelDark'));
    });
    const out2 = add('crb', 'Crossed-roller bearing', 'One bearing that carries the joint’s radial, axial and tipping loads at once: rollers at alternating 90° angles between two rings.', ['Takes the leg’s bending loads', 'Keeps the reducer free of side loads'], -0.08, 0.33, [R * 0.72, L * 0.86, 0], (g) => {
      g.add(mesh(ringPart(R * 0.62, R * 0.7, L * 0.82, L * 0.9, 0.0004, 56), 'steel'));
      g.add(mesh(ringPart(R * 0.76, R * 0.84, L * 0.82, L * 0.9, 0.0004, 56), 'steel'));
      const rollers: BufferGeometry[] = [];
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const c = new CylinderGeometry(R * 0.028, R * 0.028, R * 0.05, 8).rotateZ(i % 2 ? Math.PI / 4 : -Math.PI / 4).translate(Math.cos(a) * R * 0.73, L * 0.86, Math.sin(a) * R * 0.73);
        rollers.push(c);
      }
      g.add(mesh(merge(rollers), 'steel'));
    });
    const out3 = add('torque', 'Torque sensor', 'A spoked flexure between bearing and flange: strain gauges on the spokes measure the output torque directly, for force control and safety.', ['Full-bridge strain gauges on 4 spokes', 'Measures ±400 Nm at 1 kHz'], -0.04, 0.36, [R * 0.6, L * 0.93, 0], (g) => {
      const y = L * 0.905;
      g.add(mesh(ringPart(R * 0.66, R * 0.8, y, y + 0.004, 0.0004, 48), 'titanium'));
      g.add(mesh(ringPart(R * 0.18, R * 0.3, y, y + 0.004, 0.0004, 32), 'titanium'));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const spoke = new RoundedBoxGeometry(R * 0.4, 0.004, R * 0.08, 1, 0.0006).translate(R * 0.48, y + 0.002, 0).rotateY(a);
        g.add(mesh(spoke, 'titanium'));
        g.add(mesh(new RoundedBoxGeometry(R * 0.14, 0.0006, R * 0.05, 1, 0.0002).translate(R * 0.48, y + 0.0043, 0).rotateY(a), 'gold'));
      }
    });
    const out4 = add('flange', 'Output flange', 'Machined flange the limb bolts to. It turns at joint speed with the full output torque.', ['τ_out ≈ τ_motor × N × η', '8 × M5 bolt circle'], 0, 0.38, [R * 0.5, L, 0], (g) => {
      const top = L;
      const fl = Profile.from(R * 0.3, L * 0.93)
        .to(R * 0.84, L * 0.93)
        .to(R * 0.84, top - 0.0012)
        .chamfer(0.001)
        .to(R * 0.8, top)
        .to(R * 0.3, top)
        .to(R * 0.3, L * 0.93)
        .build(56);
      g.add(mesh(fl, 'aluBright'));
      g.add(mesh(discPart(R * 0.3, top - 0.003, top + 0.0005, 0.0006, 24), 'anodized'));
      for (const b of boltCircle(8, R * 0.62, top, 0.0028, Math.PI / 8)) g.add(mesh(b.geo, 'steel'));
    });
    this.output = [out1, out2, out3, out4];
    // rest positions are all zero; explode offsets are applied in update()
  }

  /**
   * Axial offset of a part at an explode amount 0–1. Offsets grow monotonically from the output
   * flange (which stays at the joint) to the rear cover, and rear parts start first, so the gap
   * between any two neighbours only ever grows: nothing passes through anything, and nested
   * parts leave through open ends (the rotor out of the stator, the stator out of the housing,
   * the discs off their pins).
   */
  offsetOf(p: AssemblyPart, explode: number): number {
    const u = Math.min(1, Math.max(0, (explode - p.delay) / (1 - 0.38)));
    const e = u * u * u * (u * (u * 6 - 15) + 10);
    return p.explode * e * this.spread;
  }

  /**
   * Pose the assembly: `explode` 0–1 spreads the parts along the axis (each on its own
   * schedule), `rotor` is the motor angle (rad). The discs orbit and counter-rotate, the output
   * turns at 1/(N − 1).
   */
  update(explode: number, rotorAngle: number) {
    this.rotorAngle = rotorAngle;
    for (const p of this.parts) p.group.position.y = this.offsetOf(p, explode);
    const lobes = this.N - 1;
    this.rotor.rotation.y = rotorAngle;
    const discAngle = -rotorAngle / lobes;
    this.discs.forEach((d, k) => {
      const phase = k === 0 ? 0 : Math.PI;
      d.rotation.y = discAngle;
      // centre orbits the axis at the rotor angle, with the eccentricity
      // the disc geometry is centred on the axis: its centre orbits with the eccentric cam
      const a = rotorAngle + phase;
      d.position.x = this.ecc * Math.cos(a);
      d.position.z = -this.ecc * Math.sin(a);
    });
    for (const o of this.output) o.rotation.y = -rotorAngle / lobes;
  }

  private dim = new Map<string, FabMaterial>();
  private focusId: string | null = null;
  private focusAmt = 0;

  /**
   * Bring one part forward: the others fade to a faint outline of themselves (`amount` 0–1).
   * The focused part also moves a little further out of the stack so it reads on its own.
   */
  setFocus(id: string | null, amount: number) {
    if (id === this.focusId && Math.abs(amount - this.focusAmt) < 1e-4) return;
    this.focusId = id;
    this.focusAmt = amount;
    const focusGroup = id === 'disc' ? ['disc', 'disc2'] : id ? [id] : [];
    for (const p of this.parts) {
      const dimmed = amount > 0.002 && id !== null && !focusGroup.includes(p.id);
      p.group.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const look = m.userData.look as LookName;
        if (!dimmed) {
          m.material = material(look);
          m.castShadow = true;
          return;
        }
        let f = this.dim.get(look);
        if (!f) {
          f = fadeTwin(material(look));
          f.depthWrite = false;
          this.dim.set(look, f);
        }
        f.opacity = 1 - 0.82 * amount;
        m.material = f;
        m.castShadow = false;
      });
    }
  }
}
