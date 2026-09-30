/**
 * Payload boxes: the crate FO-H1 carries when the Engineer payload is set (or when the walk
 * lab asks it to carry), sized by its mass and held between the palms; and the balance lab's
 * 10 kg box on a platform that rises out of the floor for the lift task.
 */
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { material, markingTexture } from '../../scene/materials';
import { LIFT_BOX } from '../sources/balance';
import type { World } from '../world';

function crate(label: string): { g: Group; mats: MeshPhysicalMaterial[] } {
  const g = new Group();
  const body = new MeshPhysicalMaterial({ color: '#3b4048', roughness: 0.62, metalness: 0, clearcoat: 0.1, transparent: true, opacity: 1 });
  const trim = new MeshPhysicalMaterial({ color: '#a3a7ad', roughness: 0.38, metalness: 1, transparent: true, opacity: 1 });
  const tex = markingTexture(
    [
      { text: label, size: 54, weight: 600, y: 48, x: 24 },
      { text: 'PAYLOAD', size: 26, weight: 500, tracking: 6, y: 100, x: 26, color: '#b7bbc4' },
    ],
    512,
    128,
  );
  const lab = new MeshPhysicalMaterial({ map: tex, transparent: true, roughness: 0.5, opacity: 1, depthWrite: false });
  const bm = new Mesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.02), body);
  bm.castShadow = true;
  bm.receiveShadow = true;
  g.add(bm);
  const t1 = new Mesh(new BoxGeometry(1.004, 0.06, 1.004), trim);
  t1.position.y = 0.44;
  const t2 = t1.clone();
  t2.position.y = -0.44;
  g.add(t1, t2);
  const lb = new Mesh(new BoxGeometry(0.5, 0.2, 0.001), lab);
  lb.position.set(0, 0.1, 0.502);
  g.add(lb);
  return { g, mats: [body, trim, lab] };
}

export class PayloadProp {
  root = new Group();
  private carried: { g: Group; mats: MeshPhysicalMaterial[] };
  private carriedLabel = '';
  private liftBox: { g: Group; mats: MeshPhysicalMaterial[] };
  private stand = new Group();
  private alpha = 0;
  private rise = 0;
  private size = new Vector3(0.3, 0.2, 0.26);

  constructor() {
    this.root.name = 'payload';
    this.carried = crate('10 kg');
    this.root.add(this.carried.g);
    this.carried.g.visible = false;
    this.liftBox = crate(`${LIFT_BOX.mass} kg`);
    this.liftBox.g.scale.copy(LIFT_BOX.size);
    this.root.add(this.liftBox.g);
    // the platform: a steel top on a scissor-lift column, flush with the floor when down
    const top = new Mesh(new RoundedBoxGeometry(0.4, 0.03, 0.34, 2, 0.006), material('anodized'));
    top.castShadow = top.receiveShadow = true;
    const col = new Mesh(new BoxGeometry(0.26, 1, 0.22), material('alu'));
    col.castShadow = true;
    col.name = 'column';
    this.stand.add(top, col);
    this.root.add(this.stand);
    this.stand.visible = false;
  }

  private label(g: { g: Group; mats: MeshPhysicalMaterial[] }, text: string) {
    if (text === this.carriedLabel) return;
    this.carriedLabel = text;
    const old = this.carried;
    this.root.remove(old.g);
    this.carried = crate(text);
    this.root.add(this.carried.g);
    void g;
  }

  update(w: World, dt: number) {
    // carried crate (idle, walking, balance lift: whatever holds with both hands)
    const src = w.driver.source;
    const held = src && src !== w.manip && src !== w.balance && src !== w.exercise ? src.held : null;
    const want = held && held.hands === 'both' ? 1 : 0;
    this.alpha += (want - this.alpha) * Math.min(1, dt * 5);
    const c = this.carried;
    c.g.visible = this.alpha > 0.01;
    if (held) this.label(c, `${held.mass.toFixed(held.mass % 1 ? 1 : 0)} kg`);
    if (this.carried.g.visible) {
      const pl = w.kin.palm('L');
      const pr = w.kin.palm('R');
      const span = pl.distanceTo(pr);
      const mass = held?.mass ?? 10;
      const width = Math.max(0.18, span - 0.035);
      const depth = 0.26;
      const h = Math.min(0.42, Math.max(0.12, mass / (900 * width * depth)));
      this.size.set(width, h, depth);
      const g = this.carried.g;
      g.scale.copy(this.size);
      g.position.copy(pl).add(pr).multiplyScalar(0.5);
      g.position.y -= 0.02;
      g.rotation.set(0, Math.atan2(-(pl.z - pr.z), pl.x - pr.x), 0);
      for (const m of this.carried.mats) m.opacity = this.alpha;
      for (const m of this.carried.mats) m.depthWrite = this.alpha > 0.98 && m.map === null;
    }
    // the balance lab's lift box and its platform
    const b = w.balance;
    const inLab = w.sceneId === 'sim.balance' && w.driver.source === b;
    const wantStand = inLab && (b.task === 'lift' || b.liftProgress > 0) ? 1 : b.liftProgress > 0 ? 1 : 0;
    this.rise += Math.sign(wantStand - this.rise) * Math.min(Math.abs(wantStand - this.rise), dt / 1.4);
    const e = this.rise * this.rise * (3 - 2 * this.rise);
    const topY = LIFT_BOX.rest.y - LIFT_BOX.size.y / 2;
    const y = e * topY;
    this.stand.visible = this.rise > 0.001;
    this.stand.position.set(LIFT_BOX.rest.x, 0, LIFT_BOX.rest.z);
    const top = this.stand.children[0];
    top.position.y = y - 0.015;
    const col = this.stand.children[1];
    col.scale.y = Math.max(0.001, y - 0.03);
    col.position.y = (y - 0.03) / 2;
    const lb = this.liftBox.g;
    lb.visible = this.rise > 0.001 || b.liftProgress > 0;
    if (b.liftProgress >= 0.5 && w.driver.source === b) lb.position.copy(b.box);
    else lb.position.set(LIFT_BOX.rest.x, y + LIFT_BOX.size.y / 2, LIFT_BOX.rest.z);
    if (b.liftProgress >= 0.5) {
      const pl = w.kin.palm('L');
      const pr = w.kin.palm('R');
      lb.rotation.set(0, Math.atan2(-(pl.z - pr.z), pl.x - pr.x), 0);
    } else lb.rotation.set(0, 0, 0);
  }
}
