/**
 * Callouts: a small dot on the robot, a hairline leader, and a short name (with a number when
 * it helps). They follow their anchor every frame, sit on the side of the robot their anchor
 * is on, and are pushed apart vertically so they never overlap. Each fades in and out on its
 * own when the scene changes; all of them follow the `labels` channel and the visitor's
 * overlay switch. Plain DOM, positioned with transforms (no layout per frame).
 */
import { Vector3 } from 'three';
import { useApp } from '../../state/store';
import { labelsFor, type LabelDef } from '../labelDefs';
import type { Feature, World } from '../world';

interface Live {
  def: LabelDef;
  el: HTMLDivElement;
  line: HTMLDivElement;
  box: HTMLDivElement;
  title: HTMLSpanElement;
  value: HTMLSpanElement;
  a: number;
  want: number;
  x: number;
  y: number;
  side: number;
  ty: number;
  visible: boolean;
}

const V = new Vector3();

export class Labels implements Feature {
  root: HTMLDivElement;
  private live = new Map<string, Live>();
  private sceneKey = '';

  constructor(host: HTMLElement, before: Element) {
    this.root = document.createElement('div');
    this.root.className = 'labels';
    this.root.setAttribute('aria-hidden', 'true');
    host.insertBefore(this.root, before.nextSibling);
  }

  private make(def: LabelDef): Live {
    const el = document.createElement('div');
    el.className = 'lbl';
    const dot = document.createElement('i');
    dot.className = 'lbl__dot';
    const line = document.createElement('div');
    line.className = 'lbl__line';
    const box = document.createElement('div');
    box.className = 'lbl__box';
    const title = document.createElement('span');
    title.className = 'lbl__title';
    const value = document.createElement('span');
    value.className = 'lbl__value num';
    box.append(title, value);
    el.append(line, dot, box);
    this.root.append(el);
    title.textContent = def.title;
    return { def, el, line, box, title, value, a: 0, want: 1, x: 0, y: 0, side: 1, ty: 0, visible: false };
  }

  update(w: World, dt: number) {
    const key = `${w.sceneId}|${useApp.getState().part ?? ''}|${useApp.getState().actuator}`;
    if (key !== this.sceneKey) {
      this.sceneKey = key;
      const defs = labelsFor(w);
      const ids = new Set(defs.map((d) => d.id));
      for (const l of this.live.values()) l.want = ids.has(l.def.id) ? 1 : 0;
      for (const d of defs) {
        let l = this.live.get(d.id);
        if (!l) {
          l = this.make(d);
          this.live.set(d.id, l);
        }
        l.def = d;
        l.title.textContent = d.title;
        l.want = 1;
      }
    }
    const show = (useApp.getState().overlays ? 1 : 0) * w.ch.get('labels');
    const cam = w.stage.camera;
    const W = w.director.viewW;
    const H = w.director.viewH;
    const compact = w.director.compact;
    const panelEdge = compact ? W : W - 400;
    // the robot's screen centre decides which side a callout goes
    const centre = w.anchor('torso').project(cam);
    const cx = (centre.x * 0.5 + 0.5) * W;
    const placed: Live[] = [];
    for (const [id, l] of this.live) {
      l.a += (l.want - l.a) * Math.min(1, dt * 5);
      if (l.want === 0 && l.a < 0.01) {
        l.el.remove();
        this.live.delete(id);
        continue;
      }
      const p = l.def.at(w, V);
      const inFront = p.clone().sub(cam.position).dot(cam.getWorldDirection(new Vector3())) > 0;
      p.project(cam);
      l.x = (p.x * 0.5 + 0.5) * W;
      l.y = (-p.y * 0.5 + 0.5) * H;
      const onScreen = inFront && l.x > 8 && l.x < panelEdge - 40 && l.y > 60 && l.y < H - 20;
      const alpha = l.a * show * (onScreen ? 1 : 0) * (compact && !l.def.key ? 0 : 1);
      l.visible = alpha > 0.01;
      l.el.style.opacity = alpha.toFixed(3);
      if (!l.visible) {
        l.el.style.visibility = 'hidden';
        continue;
      }
      l.el.style.visibility = 'visible';
      l.side = l.def.side ?? (l.x >= cx ? 1 : -1);
      // no room on the right before the panel: go left
      if (l.side > 0 && l.x + 190 > panelEdge) l.side = -1;
      if (l.side < 0 && l.x - 190 < 150 && !compact) l.side = 1;
      l.ty = l.y + (l.def.dy ?? 0);
      placed.push(l);
      if (l.def.value) l.value.textContent = l.def.value(w);
      else l.value.textContent = '';
    }
    // push apart vertically, per side
    for (const side of [-1, 1]) {
      const col = placed.filter((l) => l.side === side).sort((a, b) => a.ty - b.ty);
      for (let i = 1; i < col.length; i++) if (col[i].ty < col[i - 1].ty + 36) col[i].ty = col[i - 1].ty + 36;
    }
    for (const l of placed) {
      const dx = (l.def.dx ?? 64) * l.side;
      const tx = l.x + dx;
      const ty = l.ty;
      l.el.style.transform = `translate3d(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px, 0)`;
      const lx = tx - l.x;
      const ly = ty - l.y;
      const len = Math.hypot(lx, ly);
      l.line.style.width = `${len.toFixed(1)}px`;
      l.line.style.transform = `rotate(${Math.atan2(ly, lx).toFixed(4)}rad)`;
      l.box.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0) translate(${l.side > 0 ? '6px' : 'calc(-100% - 6px)'}, -50%)`;
      l.box.style.textAlign = l.side > 0 ? 'left' : 'right';
    }
  }

  dispose() {
    this.root.remove();
  }
}
