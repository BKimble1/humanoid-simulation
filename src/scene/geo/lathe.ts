/**
 * Turned parts: a profile of (radius, y) points revolved about Y, with crisp edges where the
 * profile has a corner and smooth shading along curves. A small path builder makes machined
 * profiles (chamfers, fillets, grooves, steps) readable in code.
 */
import { BufferAttribute, BufferGeometry } from 'three';

export interface PPoint {
  r: number;
  y: number;
  /** A crisp edge at this point (the normal is not averaged across it). */
  sharp?: boolean;
}

/** Revolve a profile (listed from bottom to top along the outside). */
export function lathe(profile: PPoint[], segments = 64, phiStart = 0, phiLength = Math.PI * 2): BufferGeometry {
  // split into runs at sharp points; each run gets its own vertices
  const runs: PPoint[][] = [];
  let cur: PPoint[] = [profile[0]];
  for (let i = 1; i < profile.length; i++) {
    cur.push(profile[i]);
    if (profile[i].sharp && i < profile.length - 1) {
      runs.push(cur);
      cur = [profile[i]];
    }
  }
  runs.push(cur);
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const full = Math.abs(phiLength - Math.PI * 2) < 1e-6;
  const cols = full ? segments : segments + 1;
  for (const run of runs) {
    if (run.length < 2) continue;
    // 2-D normals of the run's vertices (outward: rotate the tangent by −90°)
    const n2: [number, number][] = run.map((p, i) => {
      const a = run[Math.max(0, i - 1)];
      const b = run[Math.min(run.length - 1, i + 1)];
      let tx = b.r - a.r;
      let ty = b.y - a.y;
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      void p;
      return [ty, -tx];
    });
    const base = pos.length / 3;
    for (let i = 0; i < run.length; i++) {
      const p = run[i];
      for (let j = 0; j < cols; j++) {
        const phi = phiStart + (phiLength * j) / segments;
        const s = Math.sin(phi);
        const c = Math.cos(phi);
        pos.push(p.r * s, p.y, p.r * c);
        nor.push(n2[i][0] * s, n2[i][1], n2[i][0] * c);
      }
    }
    for (let i = 0; i < run.length - 1; i++)
      for (let j = 0; j < segments; j++) {
        const a = base + i * cols + j;
        const b = base + i * cols + ((j + 1) % cols);
        const c = base + (i + 1) * cols + j;
        const d = base + (i + 1) * cols + ((j + 1) % cols);
        idx.push(a, b, c, b, d, c);
      }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}

/**
 * Profile path builder. Coordinates are (r, y). `fillet(radius)` rounds the corner at the
 * current point before the next segment; `chamfer(size)` cuts it.
 */
export class Profile {
  pts: PPoint[] = [];
  private pendingFillet = 0;
  private pendingChamfer = 0;

  static from(r: number, y: number): Profile {
    const p = new Profile();
    p.pts.push({ r, y, sharp: true });
    return p;
  }

  to(r: number, y: number): this {
    const prev = this.pts[this.pts.length - 1];
    if (this.pendingFillet > 0 && this.pts.length >= 2) this.roundCorner(r, y, this.pendingFillet);
    else if (this.pendingChamfer > 0 && this.pts.length >= 2) this.cutCorner(r, y, this.pendingChamfer);
    else if (prev) prev.sharp = true;
    this.pendingFillet = 0;
    this.pendingChamfer = 0;
    this.pts.push({ r, y, sharp: true });
    return this;
  }

  fillet(radius: number): this {
    this.pendingFillet = radius;
    return this;
  }

  chamfer(size: number): this {
    this.pendingChamfer = size;
    return this;
  }

  /** Replace the last point (a corner between prev→corner→next) by an arc. */
  private roundCorner(nr: number, ny: number, rad: number) {
    const c = this.pts.pop()!;
    const p = this.pts[this.pts.length - 1];
    const v1 = [p.r - c.r, p.y - c.y];
    const v2 = [nr - c.r, ny - c.y];
    const l1 = Math.hypot(v1[0], v1[1]);
    const l2 = Math.hypot(v2[0], v2[1]);
    const d = Math.min(rad, l1 * 0.49, l2 * 0.49);
    const a = { r: c.r + (v1[0] / l1) * d, y: c.y + (v1[1] / l1) * d };
    const b = { r: c.r + (v2[0] / l2) * d, y: c.y + (v2[1] / l2) * d };
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // quadratic Bézier through the corner: a smooth, tangent-continuous round
      const r = (1 - t) * (1 - t) * a.r + 2 * (1 - t) * t * c.r + t * t * b.r;
      const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y;
      this.pts.push({ r, y, sharp: false });
    }
    this.pts[this.pts.length - 1 - steps].sharp = false;
  }

  private cutCorner(nr: number, ny: number, size: number) {
    const c = this.pts.pop()!;
    const p = this.pts[this.pts.length - 1];
    const v1 = [p.r - c.r, p.y - c.y];
    const v2 = [nr - c.r, ny - c.y];
    const l1 = Math.hypot(v1[0], v1[1]);
    const l2 = Math.hypot(v2[0], v2[1]);
    const d = Math.min(size, l1 * 0.49, l2 * 0.49);
    this.pts.push({ r: c.r + (v1[0] / l1) * d, y: c.y + (v1[1] / l1) * d, sharp: true });
    this.pts.push({ r: c.r + (v2[0] / l2) * d, y: c.y + (v2[1] / l2) * d, sharp: true });
  }

  /** A V-groove cut into a cylindrical face at height y (depth, width). */
  groove(r: number, y: number, depth: number, width: number): this {
    this.to(r, y - width / 2);
    this.to(r - depth, y);
    this.to(r, y + width / 2);
    return this;
  }

  build(segments = 64, phiStart = 0, phiLength = Math.PI * 2): BufferGeometry {
    return lathe(this.pts, segments, phiStart, phiLength);
  }
}

/** A ring (tube-shaped part) with inner and outer radius, from y0 to y1, chamfered edges. */
export function ringPart(rIn: number, rOut: number, y0: number, y1: number, ch = 0.0008, segments = 64): BufferGeometry {
  const p = Profile.from(rIn, y0 + ch)
    .chamfer(ch)
    .to(rIn, y0)
    .to(rOut - ch, y0)
    .to(rOut, y0 + ch)
    .to(rOut, y1 - ch)
    .to(rOut - ch, y1)
    .to(rIn + ch, y1)
    .to(rIn, y1 - ch)
    .to(rIn, y0 + ch);
  return p.build(segments);
}

/** A solid disc / short cylinder with chamfered edges, from y0 to y1. */
export function discPart(r: number, y0: number, y1: number, ch = 0.0008, segments = 64): BufferGeometry {
  return Profile.from(0, y0).to(r - ch, y0).to(r, y0 + ch).to(r, y1 - ch).to(r - ch, y1).to(0, y1).build(segments);
}
