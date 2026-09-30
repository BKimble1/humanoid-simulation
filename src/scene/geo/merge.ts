import { BufferAttribute, BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Normalise a geometry for merging: position and normal only, indexed. */
export function clean(g: BufferGeometry): BufferGeometry {
  const out = new BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  out.setAttribute('normal', g.getAttribute('normal'));
  if (g.index) out.setIndex(g.index);
  else {
    const n = g.getAttribute('position').count;
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    out.setIndex(new BufferAttribute(idx, 1));
  }
  return out;
}

/** Merge geometries of any origin into one (positions and normals). */
export function merge(geos: BufferGeometry[]): BufferGeometry {
  return mergeGeometries(geos.map(clean), false)!;
}
