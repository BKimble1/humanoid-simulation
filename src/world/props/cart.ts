/**
 * The autonomous cart: a low mobile base (lidar at the front, a status strip), a tray at
 * working height and a shelf on a mast. It drives into the cell when a scene needs it and
 * drives away afterwards (never while a hand is still over its tray). Its items are drawn
 * where the manipulation lab says they are.
 */
import { BoxGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshPhysicalMaterial, Vector3, type BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { merge } from '../../scene/geo/merge';
import { material, materialInstance, type LookName } from '../../scene/materials';
import { CART, ITEMS, type ItemId } from '../cart';
import type { World } from '../world';

function mesh(g: BufferGeometry, look: LookName | MeshPhysicalMaterial, shadow = true): Mesh {
  const m = new Mesh(g, typeof look === 'string' ? material(look) : look);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

const UP = new Vector3(0, 1, 0);

const glass = () =>
  new MeshPhysicalMaterial({ color: '#dfe9ef', metalness: 0, roughness: 0.04, transparent: true, opacity: 0.28, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6, side: DoubleSide, depthWrite: false });

export class CartProp {
  root = new Group();
  body = new Group();
  items = {} as Record<ItemId, Group>;
  liquid: Mesh;
  /** Docked amount 0 (away) … 1 (in place), eased. */
  dock = 0;

  constructor() {
    this.root.name = 'cart';
    const c = CART;
    const b = this.body;
    const w = c.deckW;
    const dd = c.deckD;
    const tote = materialInstance('shellDark', 'tote');
    tote.color.set('#27394a');
    // base
    b.add(mesh(new RoundedBoxGeometry(w, c.baseH - 0.04, dd + 0.04, 3, 0.03).translate(0, 0.04 + (c.baseH - 0.04) / 2, 0), 'shellDark'));
    b.add(mesh(new RoundedBoxGeometry(w - 0.03, 0.012, dd + 0.01, 2, 0.005).translate(0, c.baseH + 0.004, 0), 'shell'));
    b.add(mesh(new BoxGeometry(w * 0.7, 0.008, 0.004).translate(0, c.baseH * 0.55, dd / 2 + 0.021), 'statusDim', false));
    b.add(mesh(new CylinderGeometry(0.038, 0.042, 0.035, 32).translate(0, c.baseH + 0.028, dd / 2 - 0.05), 'shellDark'));
    b.add(mesh(new CylinderGeometry(0.036, 0.036, 0.014, 32).translate(0, c.baseH + 0.03, dd / 2 - 0.05), 'lens'));
    for (const [x, z] of [
      [w / 2 - 0.07, dd / 2 - 0.06],
      [-w / 2 + 0.07, dd / 2 - 0.06],
      [w / 2 - 0.07, -dd / 2 + 0.06],
      [-w / 2 + 0.07, -dd / 2 + 0.06],
    ])
      b.add(mesh(new CylinderGeometry(0.035, 0.035, 0.03, 20).rotateZ(Math.PI / 2).translate(x, 0.035, z), 'rubber'));
    // tray on four posts, with a rim
    const posts: BufferGeometry[] = [];
    for (const [x, z] of [
      [w / 2 - 0.03, dd / 2 - 0.03],
      [-w / 2 + 0.03, dd / 2 - 0.03],
      [w / 2 - 0.03, -dd / 2 + 0.03],
      [-w / 2 + 0.03, -dd / 2 + 0.03],
    ])
      posts.push(new BoxGeometry(0.026, c.deckY - c.baseH, 0.026).translate(x, (c.deckY + c.baseH) / 2, z));
    b.add(mesh(merge(posts), 'alu'));
    b.add(mesh(new RoundedBoxGeometry(w, 0.022, dd, 2, 0.006).translate(0, c.deckY - 0.013, 0), 'anodized'));
    b.add(mesh(new BoxGeometry(w - 0.03, 0.004, dd - 0.03).translate(0, c.deckY, 0), 'rubber'));
    const rim: BufferGeometry[] = [
      new BoxGeometry(w, 0.02, 0.01).translate(0, c.deckY + 0.008, dd / 2 - 0.005),
      new BoxGeometry(w, 0.02, 0.01).translate(0, c.deckY + 0.008, -dd / 2 + 0.005),
      new BoxGeometry(0.01, 0.02, dd).translate(w / 2 - 0.005, c.deckY + 0.008, 0),
      new BoxGeometry(0.01, 0.02, dd).translate(-w / 2 + 0.005, c.deckY + 0.008, 0),
    ];
    b.add(mesh(merge(rim), 'alu'));
    // mast and shelf at the back
    const back = dd / 2 - 0.02;
    const mast = [new BoxGeometry(0.03, c.shelfY - c.deckY + 0.06, 0.03).translate(w / 2 - 0.03, (c.shelfY + c.deckY) / 2, back), new BoxGeometry(0.03, c.shelfY - c.deckY + 0.06, 0.03).translate(-w / 2 + 0.03, (c.shelfY + c.deckY) / 2, back)];
    b.add(mesh(merge(mast), 'alu'));
    const shelfZ = back - c.shelfD / 2 + 0.02;
    b.add(mesh(new RoundedBoxGeometry(w, 0.02, c.shelfD, 2, 0.006).translate(0, c.shelfY - 0.01, shelfZ), 'anodized'));
    b.add(mesh(new BoxGeometry(w - 0.02, 0.004, c.shelfD - 0.02).translate(0, c.shelfY + 0.001, shelfZ), 'rubber'));
    // vial rack on the tray (it stays)
    const vr = ITEMS.vial.rest;
    b.add(mesh(new RoundedBoxGeometry(0.1, 0.035, 0.05, 2, 0.005).translate(vr.x - CART.pos.x, c.deckY + 0.0175, vr.z - CART.pos.z), 'shell'));
    b.position.set(0, 0, 0);
    this.root.add(b);

    // items (their groups are placed in world coordinates each frame)
    for (const it of Object.values(ITEMS)) {
      const g = new Group();
      g.name = `item:${it.id}`;
      const s = it.size;
      if (it.shape === 'tote') {
        const t = 0.006;
        g.add(mesh(merge([new BoxGeometry(s.x, t, s.z).translate(0, -s.y / 2 + t / 2, 0), new BoxGeometry(t, s.y, s.z).translate(-s.x / 2 + t / 2, 0, 0), new BoxGeometry(t, s.y, s.z).translate(s.x / 2 - t / 2, 0, 0), new BoxGeometry(s.x, s.y, t).translate(0, 0, -s.z / 2 + t / 2), new BoxGeometry(s.x, s.y, t).translate(0, 0, s.z / 2 - t / 2)]), tote));
        const parts: BufferGeometry[] = [];
        for (let i = 0; i < 7; i++) parts.push(new CylinderGeometry(0.012, 0.012, 0.05, 14).rotateZ(Math.PI / 2).translate(-0.1 + i * 0.03, -s.y / 2 + 0.025, -0.04 + (i % 2) * 0.06));
        g.add(mesh(merge(parts), 'steel'));
        g.add(mesh(new RoundedBoxGeometry(0.1, 0.04, 0.07, 2, 0.006).translate(0.07, -s.y / 2 + 0.03, 0.03), 'alu'));
        g.add(mesh(new BoxGeometry(0.08, 0.02, 0.002).translate(0, s.y / 2 - 0.03, s.z / 2 + 0.0011), 'marking', false));
      } else if (it.shape === 'vial') {
        g.add(mesh(new CylinderGeometry(s.x / 2, s.x / 2, s.y - 0.016, 24, 1, true).translate(0, -0.008, 0), glass(), false));
        g.add(mesh(new CylinderGeometry(s.x / 2 + 0.002, s.x / 2 + 0.002, 0.018, 24).translate(0, s.y / 2 - 0.009, 0), 'shellDark'));
        g.add(mesh(new CylinderGeometry(s.x / 2 - 0.002, s.x / 2 - 0.002, 0.03, 20).translate(0, -s.y / 2 + 0.02, 0), new MeshPhysicalMaterial({ color: '#c0492f', roughness: 0.2, transparent: true, opacity: 0.8 }), false));
      } else if (it.shape === 'beaker') {
        g.add(mesh(new CylinderGeometry(s.x / 2, s.x / 2, s.y, 36, 1, true), glass(), false));
        g.add(mesh(new CylinderGeometry(s.x / 2, s.x / 2, 0.003, 36).translate(0, -s.y / 2 + 0.0015, 0), glass(), false));
        const ticks: BufferGeometry[] = [];
        for (let i = 1; i < 5; i++) ticks.push(new BoxGeometry(0.012, 0.0012, 0.0012).translate(0, -s.y / 2 + i * 0.022, s.x / 2 + 0.0005));
        g.add(mesh(merge(ticks), 'marking', false));
      } else if (it.shape === 'driver') {
        g.add(mesh(new RoundedBoxGeometry(0.058, 0.045, 0.085, 2, 0.008).translate(0, -s.y / 2 + 0.0225, 0.0), 'anodized'));
        g.add(mesh(new RoundedBoxGeometry(0.034, 0.11, 0.042, 2, 0.012).translate(0, -s.y / 2 + 0.1, -0.005), 'rubber'));
        g.add(mesh(new CylinderGeometry(0.03, 0.032, 0.14, 28).rotateX(Math.PI / 2).translate(0, s.y / 2 - 0.035, 0.01), 'shellDark'));
        g.add(mesh(new CylinderGeometry(0.012, 0.018, 0.04, 20).rotateX(Math.PI / 2).translate(0, s.y / 2 - 0.035, 0.1), 'steel'));
        g.add(mesh(new BoxGeometry(0.012, 0.02, 0.01).translate(0, s.y / 2 - 0.075, 0.02), 'shell'));
      } else if (it.shape === 'bottle') {
        const pl = new MeshPhysicalMaterial({ color: '#7fae95', metalness: 0, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.75, envMapIntensity: 1.4 });
        g.add(mesh(new CylinderGeometry(s.x / 2, s.x / 2, s.y * 0.75, 32).translate(0, -s.y * 0.125, 0), pl));
        g.add(mesh(new CylinderGeometry(s.x * 0.2, s.x / 2, s.y * 0.15, 32).translate(0, s.y * 0.325, 0), pl));
        g.add(mesh(new CylinderGeometry(s.x * 0.2, s.x * 0.2, s.y * 0.08, 20).translate(0, s.y * 0.44, 0), 'shellDark'));
        g.add(mesh(new CylinderGeometry(s.x / 2 + 0.0008, s.x / 2 + 0.0008, 0.05, 32, 1, true).translate(0, -0.03, 0), 'marking'));
      }
      this.items[it.id] = g;
      this.root.add(g);
    }
    // beaker liquid (rises when water is poured in)
    this.liquid = mesh(new CylinderGeometry(ITEMS.cup.size.x / 2 - 0.003, ITEMS.cup.size.x / 2 - 0.003, 1, 32).translate(0, 0.5, 0), new MeshPhysicalMaterial({ color: '#8cc6e6', roughness: 0.05, transparent: true, opacity: 0.45, depthWrite: false }), false);
    this.items.cup.add(this.liquid);
    this.root.visible = false;
  }

  update(w: World, dt: number) {
    const want = w.ch.get('cart') > 0.5 ? 1 : 0;
    // never drive away while a hand is over the tray
    let blocked = false;
    if (want === 0 && this.dock > 0) {
      for (const s of ['L', 'R'] as const) {
        const p = w.kin.palm(s);
        if (p.z > CART.pos.z - CART.deckD / 2 - 0.1 && p.y > CART.baseH) blocked = true;
      }
    }
    if (!blocked) this.dock += Math.sign(want - this.dock) * Math.min(Math.abs(want - this.dock), dt / 2.4);
    this.root.visible = this.dock > 0.001;
    if (!this.root.visible) return;
    const u = this.dock;
    const e = u * u * u * (u * (u * 6 - 15) + 10);
    // drives in from the right of the cell, turning onto its spot
    const off = (1 - e) * 3.2;
    this.body.position.set(CART.pos.x + off, 0, CART.pos.z + (1 - e) * (1 - e) * 0.5);
    this.body.rotation.y = (1 - e) * 0.35;
    const m = w.manip;
    for (const it of Object.values(ITEMS)) {
      const g = this.items[it.id];
      const p = m.objects[it.id];
      const atRest = p.distanceTo(it.rest) < 1e-4;
      if (atRest) {
        // ride on the cart
        g.position.copy(it.rest).sub(CART.pos);
        g.position.applyAxisAngle(UP, this.body.rotation.y);
        g.position.add(this.body.position);
        g.rotation.y = this.body.rotation.y;
      } else {
        g.position.copy(p);
        g.rotation.y = 0;
      }
    }
    const level = 0.035 + (m.poured / 0.3) * 0.05;
    this.liquid.scale.y = level;
    this.liquid.position.y = -ITEMS.cup.size.y / 2 + 0.003;
  }
}
