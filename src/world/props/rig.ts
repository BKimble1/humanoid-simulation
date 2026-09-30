/**
 * The joint test stand: FO-H1's knee actuator on a rigid column, a thigh fixture held
 * horizontal, and a shin-and-foot link with a payload cuff. The link turns to the angle the
 * 10 kHz joint simulation (engine/jointLab.ts) computes; a violet hairline shows the
 * commanded angle, so tracking error and overshoot are visible directly on the dial.
 */
import { BoxGeometry, CylinderGeometry, Group, Line, LineBasicMaterial, LineSegments, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, RingGeometry, Vector3, DoubleSide } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ACTUATORS } from '../../spec/actuators';
import { CUFF_R, DEFAULT_RIG, JointRig } from '../../engine/jointLab';
import { alongAxis, actuatorExterior } from '../../scene/robot/parts';
import { merge } from '../../scene/geo/merge';
import { material, type LookName } from '../../scene/materials';
import { useLab } from '../../state/store';
import type { World } from '../world';
import type { BufferGeometry as BG } from 'three';

export const RIG_PIVOT = new Vector3(3.15, 0.98, 0.12);

/** Scenes in which the test stand runs. */
export const RIG_SCENES = new Set(['sim.joint', 'sim.limits.torque', 'sim.limits.current']);

function mesh(g: BG, look: LookName, shadow = true): Mesh {
  const m = new Mesh(g, material(look));
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

export class RigProp {
  root = new Group();
  link = new Group();
  rig: JointRig;
  private plates = new Group();
  private cmdLine: Line;
  private active = 0;
  private lastTarget = NaN;
  private platesFor = -1;

  constructor() {
    this.root.name = 'jointRig';
    this.rig = new JointRig(DEFAULT_RIG);
    const P = RIG_PIVOT;
    const fam = ACTUATORS.A100;
    const L = fam.housingLength;
    // floor plate, column and a diagonal brace
    this.root.add(mesh(new RoundedBoxGeometry(0.62, 0.025, 0.7, 2, 0.006).translate(P.x, 0.0125, P.z - 0.22), 'anodized'));
    this.root.add(mesh(new BoxGeometry(0.09, P.y + 0.05, 0.09).translate(P.x - 0.06, (P.y + 0.05) / 2, P.z - 0.46), 'alu'));
    this.root.add(mesh(new BoxGeometry(0.05, 0.05, 0.5).rotateX(-0.9).translate(P.x - 0.06, 0.26, P.z - 0.28), 'alu'));
    // thigh fixture: horizontal member from the column to the knee
    this.root.add(mesh(new CylinderGeometry(0.026, 0.026, 0.46, 28).rotateX(Math.PI / 2).translate(P.x - 0.06, P.y, P.z - 0.23), 'alu'));
    this.root.add(mesh(new RoundedBoxGeometry(0.12, 0.1, 0.07, 2, 0.008).translate(P.x - 0.06, P.y, P.z - 0.44), 'anodized'));
    this.root.add(mesh(new RoundedBoxGeometry(0.08, 0.09, 0.09, 2, 0.008).translate(P.x - 0.06, P.y, P.z - 0.03), 'anodized'));
    // the actuator, axis along +X, output face towards +X
    const ext = actuatorExterior(fam.housingOD, L, 'cycloidal');
    const m = alongAxis(new Vector3(1, 0, 0), new Vector3(P.x - L / 2 + 0.01, P.y, P.z));
    const housing = ext.housing.map((p) => ({ geo: p.geo.clone().applyMatrix4(m), look: p.look }));
    const byLook = new Map<LookName, BG[]>();
    for (const h of housing) byLook.set(h.look, [...(byLook.get(h.look) ?? []), h.geo]);
    for (const [look, geos] of byLook) this.root.add(mesh(merge(geos), look));
    // the rotating link: output flange, shin tube, foot block, payload peg
    this.link.position.copy(P);
    const out = ext.output.map((p) => ({ geo: p.geo.clone().applyMatrix4(alongAxis(new Vector3(1, 0, 0), new Vector3(-L / 2 + 0.01, 0, 0))), look: p.look }));
    for (const o of out) this.link.add(mesh(o.geo, o.look));
    const x0 = L / 2 + 0.03;
    this.link.add(mesh(new RoundedBoxGeometry(0.03, 0.1, 0.1, 2, 0.01).translate(x0, 0, 0.02), 'aluBright'));
    this.link.add(mesh(new CylinderGeometry(0.022, 0.022, CUFF_R, 24).rotateX(Math.PI / 2).translate(x0, 0, CUFF_R / 2 + 0.03), 'alu'));
    this.link.add(mesh(new RoundedBoxGeometry(0.06, 0.07, 0.24, 2, 0.012).translate(x0, -0.02, CUFF_R + 0.08), 'shell'));
    this.link.add(mesh(new RoundedBoxGeometry(0.07, 0.02, 0.26, 2, 0.006).translate(x0, -0.06, CUFF_R + 0.08), 'rubber'));
    this.link.add(mesh(new CylinderGeometry(0.012, 0.012, 0.16, 16).rotateZ(Math.PI / 2).translate(x0 + 0.08, 0, CUFF_R), 'steel'));
    this.plates.position.set(x0 + 0.05, 0, CUFF_R);
    this.link.add(this.plates);
    this.root.add(this.link);
    // dial: an arc 0 … 120° with ticks every 15°, just outside the link's plane
    const dial = new Group();
    dial.position.set(P.x + L / 2 + 0.075, P.y, P.z);
    dial.rotation.y = Math.PI / 2;
    const arc = new Mesh(new RingGeometry(0.235, 0.238, 96, 1, 0, (120 * Math.PI) / 180), new MeshBasicMaterial({ color: '#c9cdd6', transparent: true, opacity: 0.55, side: DoubleSide, toneMapped: false }));
    // ring angle θ measured in the dial's plane: rotate so 0° is the horizontal (link along +Z)
    arc.rotation.z = Math.PI;
    dial.add(arc);
    const ticks: number[] = [];
    for (let a = 0; a <= 120; a += 15) {
      const r = (a * Math.PI) / 180;
      const r0 = a % 45 === 0 ? 0.22 : 0.227;
      ticks.push(-Math.cos(r) * r0, -Math.sin(r) * r0, 0, -Math.cos(r) * 0.238, -Math.sin(r) * 0.238, 0);
    }
    const tg = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(ticks, 3));
    dial.add(new LineSegments(tg, new LineBasicMaterial({ color: '#c9cdd6', transparent: true, opacity: 0.6, toneMapped: false })));
    this.root.add(dial);
    const cg = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0.3], 3));
    this.cmdLine = new Line(cg, new LineBasicMaterial({ color: '#9b8fff', transparent: true, opacity: 0.9, toneMapped: false }));
    this.cmdLine.position.set(P.x + L / 2 + 0.076, P.y, P.z);
    this.root.add(this.cmdLine);
  }

  private setPlates(kg: number) {
    if (kg === this.platesFor) return;
    this.platesFor = kg;
    this.plates.clear();
    // 2.5 kg steel plates (Ø 120 mm × 28 mm) and a 1.25 kg half plate for the remainder
    let left = kg;
    let x = 0;
    while (left > 0.01) {
      const m = left >= 2.5 ? 2.5 : 1.25;
      const t = m >= 2.5 ? 0.028 : 0.014;
      this.plates.add(mesh(new CylinderGeometry(0.06, 0.06, t, 40).rotateZ(Math.PI / 2).translate(x + t / 2, 0, 0), 'steelDark'));
      x += t + 0.001;
      left -= m;
    }
  }

  update(w: World, dt: number) {
    const on = RIG_SCENES.has(w.sceneId) ? 1 : 0;
    this.active += (on - this.active) * Math.min(1, dt * 2);
    const l = useLab.getState();
    const s = this.rig.s;
    if (s.ratio !== l.jointRatio || s.reducer !== l.jointReducer || s.payload !== l.jointPayload || s.speed !== l.jointSpeed) this.rig.update({ ratio: l.jointRatio, reducer: l.jointReducer, payload: l.jointPayload, speed: l.jointSpeed });
    if (l.jointTarget !== this.lastTarget) {
      this.lastTarget = l.jointTarget;
      this.rig.moveTo(l.jointTarget);
    }
    this.setPlates(Math.round(l.jointPayload / 1.25) * 1.25);
    // the simulation runs while the lab is open (and holds position otherwise)
    if (this.active > 0.01) this.rig.step(Math.min(dt, 1 / 20));
    this.link.rotation.x = this.rig.q;
    this.cmdLine.rotation.x = this.rig.qRef;
    this.cmdLine.visible = this.active > 0.05;
  }
}

