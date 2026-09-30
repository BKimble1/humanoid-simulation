import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Profile, discPart, ringPart } from './lathe';
import { loft } from './loft';
import type { BufferGeometry } from 'three';

/** Every triangle's winding normal points the same way as its vertex normals (outward). */
function windingAgrees(g: BufferGeometry): number {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const idx = g.getIndex()!;
  let bad = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const na = new Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    const [i0, i1, i2] = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    a.fromBufferAttribute(p, i0);
    b.fromBufferAttribute(p, i1);
    c.fromBufferAttribute(p, i2);
    const fn = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (fn.lengthSq() < 1e-16) continue;
    na.fromBufferAttribute(n, i0).add(new Vector3().fromBufferAttribute(n, i1)).add(new Vector3().fromBufferAttribute(n, i2));
    if (fn.dot(na) < 0) bad++;
  }
  return bad / (idx.count / 3);
}

describe('procedural geometry', () => {
  it('lofts a closed tube with outward normals', () => {
    const g = loft(
      [
        { y: 0, w: 0.05, d: 0.04, n: 3 },
        { y: 0.2, w: 0.06, d: 0.05, n: 3 },
        { y: 0.4, w: 0.04, d: 0.035, n: 2.5 },
      ],
      { capBottom: 'flat', capTop: { dome: 0.02 } },
    );
    expect(windingAgrees(g)).toBeLessThan(0.01);
    // the vertex furthest along +X has a normal pointing +X
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    let best = 0;
    for (let i = 1; i < p.count; i++) if (p.getX(i) > p.getX(best)) best = i;
    expect(n.getX(best)).toBeGreaterThan(0.5);
  });

  it('lofts a partial shell with thickness, consistently wound', () => {
    const g = loft(
      [
        { y: 0, w: 0.05, d: 0.04 },
        { y: 0.3, w: 0.05, d: 0.04 },
      ],
      { arc: [0.05, 0.45], thickness: 0.004 },
    );
    expect(windingAgrees(g)).toBeLessThan(0.02);
  });

  it('turns machined profiles with outward normals', () => {
    for (const g of [ringPart(0.02, 0.04, 0, 0.01), discPart(0.03, 0, 0.005), Profile.from(0, 0).to(0.03, 0).fillet(0.004).to(0.03, 0.02).chamfer(0.002).to(0.02, 0.03).to(0, 0.03).build()]) {
      expect(windingAgrees(g)).toBeLessThan(0.01);
    }
  });
});
