/**
 * Opening the torso to show the battery: the graphite abdomen plate lifts off forward and a
 * little down, then the chest plate forward and a little up, then the battery's front cover.
 * Each moves straight out along the torso's forward axis (nothing sits in front of them, and
 * their side wraps clear the internals by construction), and fades as it goes, so the view
 * into the torso is clean. Closing runs the same paths backwards.
 */
import type { Object3D } from 'three';
import type { Feature, World } from '../world';

const smooth = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

interface Moving {
  obj: Object3D;
  /** Stage start and end within the channel's 0 … 1. */
  from: number;
  to: number;
  dz: number;
  dy: number;
  channel: 'chestOpen' | 'batteryOpen';
}

export class Openings implements Feature {
  private items: Moving[] = [];
  /** Current opening of each part, 0 … 1 (read by the cover fading). */
  open = new Map<string, number>();

  init(w: World) {
    const add = (part: string, channel: Moving['channel'], from: number, to: number, dz: number, dy: number) => {
      const obj = w.rig.parts.get(part);
      if (obj) this.items.push({ obj, from, to, dz, dy, channel });
    };
    add('abdomen', 'chestOpen', 0, 0.7, 0.15, -0.025);
    add('chest', 'chestOpen', 0.3, 1, 0.17, 0.02);
    add('batteryLid', 'batteryOpen', 0, 1, 0.1, 0.0);
  }

  update(w: World) {
    for (const m of this.items) {
      const v = w.ch.get(m.channel);
      const u = smooth((v - m.from) / (m.to - m.from));
      m.obj.position.set(0, m.dy * u, m.dz * u);
      this.open.set(m.obj.name, u);
    }
  }

  opening(part: string | undefined): number {
    return part ? (this.open.get(part) ?? 0) : 0;
  }
}
