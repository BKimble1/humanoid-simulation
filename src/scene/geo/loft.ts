/**
 * Lofted surfaces: a tube along +Y through superellipse cross-sections whose half-width,
 * half-depth, roundness and centre vary smoothly (Catmull–Rom between the given sections).
 * This is how the covers and casings are shaped: a rounded rectangle at n ≈ 3–5, an ellipse at
 * n = 2. Rings are resampled by arc length so vertices line up from ring to ring, and the tube
 * wraps without a seam. Optional: a partial arc (a cover that only wraps the front), a wall
 * thickness (inner surface and rims, so an opened cover shows its edge), rounded end caps.
 */
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';

export interface Section {
  y: number;
  /** Half-width along X and half-depth along Z. */
  w: number;
  d: number;
  /** Superellipse exponent (2 = ellipse; larger = squarer). */
  n?: number;
  cx?: number;
  cz?: number;
  /** Extra depth for the front half only (z > 0), for asymmetric shapes like a chest. */
  front?: number;
}

export interface LoftOptions {
  radial?: number;
  /** Rings between two given sections. */
  perSpan?: number;
  /** Partial arc [start, end] in turns (0 = +X, 0.25 = +Z front, 0.5 = −X, 0.75 = back). */
  arc?: [number, number];
  /** Wall thickness (m): adds an inner surface and rims. */
  thickness?: number;
  /** Close the ends: 'flat', 'round' (a dome of the given height), or none. */
  capBottom?: 'flat' | 'none' | { dome: number };
  capTop?: 'flat' | 'none' | { dome: number };
}

const TAU = Math.PI * 2;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function interpSections(secs: Section[], perSpan: number): Required<Section>[] {
  const full = secs.map((s) => ({ y: s.y, w: s.w, d: s.d, n: s.n ?? 2.6, cx: s.cx ?? 0, cz: s.cz ?? 0, front: s.front ?? 0 }));
  if (full.length < 2) return full;
  const out: Required<Section>[] = [];
  const keys: (keyof Required<Section>)[] = ['y', 'w', 'd', 'n', 'cx', 'cz', 'front'];
  for (let i = 0; i < full.length - 1; i++) {
    const a = full[Math.max(0, i - 1)];
    const b = full[i];
    const c = full[i + 1];
    const d = full[Math.min(full.length - 1, i + 2)];
    for (let k = 0; k < perSpan; k++) {
      const t = k / perSpan;
      const s = {} as Required<Section>;
      for (const key of keys) s[key] = catmull(a[key], b[key], c[key], d[key], t);
      // keep sizes positive and y monotonic-ish
      s.w = Math.max(1e-5, s.w);
      s.d = Math.max(1e-5, s.d);
      s.n = Math.max(1.6, s.n);
      out.push(s);
    }
  }
  out.push(full[full.length - 1]);
  return out;
}

/** Points of a superellipse ring, resampled by arc length, from turn a0 to a1. */
function ring(s: Required<Section>, count: number, a0: number, a1: number, closed: boolean): [number, number][] {
  const dense = 360;
  const pts: [number, number][] = [];
  for (let i = 0; i <= dense; i++) {
    const th = (a0 + ((a1 - a0) * i) / dense) * TAU;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const e = 2 / s.n;
    const x = s.w * Math.sign(c) * Math.pow(Math.abs(c), e);
    const dz = sn > 0 ? s.d + s.front : s.d;
    const z = dz * Math.sign(sn) * Math.pow(Math.abs(sn), e);
    pts.push([x + s.cx, z + s.cz]);
  }
  const len: number[] = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[len.length - 1];
  const out: [number, number][] = [];
  const n = closed ? count : count + 1;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / count;
    while (j < len.length - 2 && len[j + 1] < target) j++;
    const f = (target - len[j]) / Math.max(1e-12, len[j + 1] - len[j]);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f]);
  }
  return out;
}

interface Grid {
  rings: Vector3[][];
  closed: boolean;
}

function buildGrid(secs: Required<Section>[], radial: number, a0: number, a1: number, closed: boolean): Grid {
  return {
    closed,
    rings: secs.map((s) => ring(s, radial, a0, a1, closed).map(([x, z]) => new Vector3(x, s.y, z))),
  };
}

/** Triangulate a grid of rings into positions and indices (smooth normals computed after). */
function gridToGeometry(grids: { grid: Grid; flip: boolean }[], extra: { pos: number[]; idx: number[] }[] = []): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const { grid, flip } of grids) {
    const base = pos.length / 3;
    const rows = grid.rings.length;
    const cols = grid.rings[0].length;
    for (const r of grid.rings) for (const v of r) pos.push(v.x, v.y, v.z);
    const segs = grid.closed ? cols : cols - 1;
    for (let i = 0; i < rows - 1; i++)
      for (let j = 0; j < segs; j++) {
        const a = base + i * cols + j;
        const b = base + i * cols + ((j + 1) % cols);
        const c = base + (i + 1) * cols + j;
        const d = base + (i + 1) * cols + ((j + 1) % cols);
        // outward winding for rings going counter-clockwise seen from +Y
        if (!flip) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
  }
  for (const e of extra) {
    const base = pos.length / 3;
    pos.push(...e.pos);
    for (const i of e.idx) idx.push(base + i);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A cap fan closing a ring (flat) or a dome of rings rising to a point (round). */
function capRings(last: Required<Section>, radial: number, a0: number, a1: number, closed: boolean, dir: 1 | -1, dome: number): Required<Section>[] {
  const out: Required<Section>[] = [];
  const steps = 7;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const ang = (t * Math.PI) / 2;
    const f = Math.cos(ang);
    out.push({ ...last, y: last.y + dir * dome * Math.sin(ang), w: Math.max(1e-4, last.w * f), d: Math.max(1e-4, last.d * f), front: last.front * f });
  }
  void radial;
  void a0;
  void a1;
  void closed;
  return out;
}

export function loft(sections: Section[], opts: LoftOptions = {}): BufferGeometry {
  const radial = opts.radial ?? 48;
  const perSpan = opts.perSpan ?? 6;
  const [a0, a1] = opts.arc ?? [0, 1];
  const closed = !opts.arc;
  let secs = interpSections(sections, perSpan);
  // round caps become extra rings
  if (opts.capBottom && typeof opts.capBottom === 'object') secs = [...capRings(secs[0], radial, a0, a1, closed, -1, opts.capBottom.dome).reverse(), ...secs];
  if (opts.capTop && typeof opts.capTop === 'object') secs = [...secs, ...capRings(secs[secs.length - 1], radial, a0, a1, closed, 1, opts.capTop.dome)];
  const outer = buildGrid(secs, radial, a0, a1, closed);
  const grids: { grid: Grid; flip: boolean }[] = [{ grid: outer, flip: false }];
  const extra: { pos: number[]; idx: number[] }[] = [];
  const t = opts.thickness ?? 0;
  if (t > 0) {
    const inner = buildGrid(
      secs.map((s) => ({ ...s, w: Math.max(1e-4, s.w - t), d: Math.max(1e-4, s.d - t), front: Math.max(0, s.front - t * 0.3) })),
      radial,
      a0,
      a1,
      closed,
    );
    grids.push({ grid: inner, flip: true });
    // rims joining outer and inner at the first and last rings, and along the arc's ends
    const rim = (ro: Vector3[], ri: Vector3[], flip: boolean) => {
      const pos: number[] = [];
      const idx: number[] = [];
      const cols = ro.length;
      for (const v of ro) pos.push(v.x, v.y, v.z);
      for (const v of ri) pos.push(v.x, v.y, v.z);
      const segs = closed ? cols : cols - 1;
      for (let j = 0; j < segs; j++) {
        const a = j;
        const b = (j + 1) % cols;
        const c = cols + j;
        const d = cols + ((j + 1) % cols);
        if (!flip) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
      extra.push({ pos, idx });
    };
    rim(outer.rings[0], inner.rings[0], false);
    rim(outer.rings[outer.rings.length - 1], inner.rings[inner.rings.length - 1], true);
    if (!closed) {
      const edge = (col: number, flip: boolean) => {
        const ro = outer.rings.map((r) => r[col]);
        const ri = inner.rings.map((r) => r[col]);
        const pos: number[] = [];
        const idx: number[] = [];
        for (const v of ro) pos.push(v.x, v.y, v.z);
        for (const v of ri) pos.push(v.x, v.y, v.z);
        const n = ro.length;
        for (let i = 0; i < n - 1; i++) {
          const a = i;
          const b = i + 1;
          const c = n + i;
          const d = n + i + 1;
          if (!flip) idx.push(a, c, b, b, c, d);
          else idx.push(a, b, c, b, d, c);
        }
        extra.push({ pos, idx });
      };
      edge(0, false);
      edge(outer.rings[0].length - 1, true);
    }
  } else {
    const flatCap = (r: Vector3[], y: number, up: boolean) => {
      const pos: number[] = [];
      const idx: number[] = [];
      let cx = 0;
      let cz = 0;
      for (const v of r) (cx += v.x), (cz += v.z);
      cx /= r.length;
      cz /= r.length;
      pos.push(cx, y, cz);
      for (const v of r) pos.push(v.x, v.y, v.z);
      const n = r.length;
      const segs = closed ? n : n - 1;
      for (let j = 0; j < segs; j++) {
        const a = 1 + j;
        const b = 1 + ((j + 1) % n);
        if (up) idx.push(0, b, a);
        else idx.push(0, a, b);
      }
      extra.push({ pos, idx });
    };
    if (opts.capBottom === 'flat') flatCap(outer.rings[0], secs[0].y, false);
    if (opts.capTop === 'flat') flatCap(outer.rings[outer.rings.length - 1], secs[secs.length - 1].y, true);
  }
  const g = gridToGeometry(grids, extra);
  // Flat caps and rims share vertices with nothing: their normals come out flat, as wanted.
  return g;
}
