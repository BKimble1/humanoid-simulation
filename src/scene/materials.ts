/**
 * Materials. Physically based (metalness/roughness), lit by the studio environment map and a
 * few lights. Every robot material is a MeshPhysicalMaterial extended in its shader with:
 *
 *   - surface variation: a subtle object-space noise on roughness, so machined and molded
 *     surfaces do not look CG-perfect;
 *   - a highlight term (hover and selection: a soft rim and tint, never a glow);
 *   - an optional "heat" colour (thermal view) mixed over the base colour.
 *
 * Variants of the same look (opaque, fading, x-ray ghost) are separate material instances so
 * their shader programs can be compiled before they are needed.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  FrontSide,
  LinearFilter,
  LinearMipMapLinearFilter,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  NormalBlending,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  type Side,
  type Texture,
} from 'three';

export interface SurfaceUniforms {
  uHighlight: { value: number };
  uHighlightColor: { value: Color };
  uHeat: { value: number };
  uHeatColor: { value: Color };
  uNoise: { value: number };
  uNoiseScale: { value: number };
}

export type FabMaterial = MeshPhysicalMaterial & { userData: { fab: SurfaceUniforms; key: string } };

const NOISE_GLSL = /* glsl */ `
float fabHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fabNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fabHash(i + vec3(0,0,0)), fabHash(i + vec3(1,0,0)), f.x), mix(fabHash(i + vec3(0,1,0)), fabHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fabHash(i + vec3(0,0,1)), fabHash(i + vec3(1,0,1)), f.x), mix(fabHash(i + vec3(0,1,1)), fabHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

/** Patch a physical material with the FAB surface extensions. */
export function extendSurface(m: MeshPhysicalMaterial, key: string, noise = 0.06, noiseScale = 180): FabMaterial {
  const u: SurfaceUniforms = {
    uHighlight: { value: 0 },
    uHighlightColor: { value: new Color('#b9b2ff') },
    uHeat: { value: 0 },
    uHeatColor: { value: new Color('#000000') },
    uNoise: { value: noise },
    uNoiseScale: { value: noiseScale },
  };
  m.userData.fab = u;
  m.userData.key = key;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFabPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFabPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vFabPos;
uniform float uHighlight; uniform vec3 uHighlightColor; uniform float uHeat; uniform vec3 uHeatColor;
uniform float uNoise; uniform float uNoiseScale;
${NOISE_GLSL}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float fabN = fabNoise(vFabPos * uNoiseScale) * 0.6 + fabNoise(vFabPos * uNoiseScale * 0.23) * 0.4;
roughnessFactor = clamp(roughnessFactor + (fabN - 0.5) * uNoise * 2.0, 0.03, 1.0);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, uHeatColor, uHeat);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += uHeatColor * uHeat * 0.55;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  float fres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.5);
  outgoingLight = mix(outgoingLight, outgoingLight * 0.6 + uHighlightColor * (0.18 + 0.55 * fres), uHighlight * 0.55);
}
#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'fab-surface';
  return m as FabMaterial;
}

/**
 * The robot's shared surface: one material whose colour, roughness, metalness, clearcoat and
 * emission come from vertex attributes, so a segment made of aluminium, steel, rubber and
 * painted covers is still one draw call. The attribute values come from LOOKS.
 */
export function robotSurface(key: string): FabMaterial {
  const m = new MeshPhysicalMaterial({ vertexColors: true, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 1 });
  const u: SurfaceUniforms = {
    uHighlight: { value: 0 },
    uHighlightColor: { value: new Color('#b9b2ff') },
    uHeat: { value: 0 },
    uHeatColor: { value: new Color('#000000') },
    uNoise: { value: 1 },
    uNoiseScale: { value: 1 },
  };
  m.userData.fab = u;
  m.userData.key = key;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aPbr; attribute vec3 aEmit; attribute vec2 aNoise;\nvarying vec4 vPbr; varying vec3 vEmit; varying vec2 vNoiseP; varying vec3 vFabPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = aPbr; vEmit = aEmit; vNoiseP = aNoise; vFabPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec4 vPbr; varying vec3 vEmit; varying vec2 vNoiseP; varying vec3 vFabPos;
uniform float uHighlight; uniform vec3 uHighlightColor; uniform float uHeat; uniform vec3 uHeatColor;
uniform float uNoise; uniform float uNoiseScale;
${NOISE_GLSL}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float fabN = fabNoise(vFabPos * vNoiseP.y) * 0.6 + fabNoise(vFabPos * vNoiseP.y * 0.23) * 0.4;
roughnessFactor = clamp(vPbr.x + (fabN - 0.5) * vNoiseP.x * 2.0 * uNoise, 0.03, 1.0);`,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vPbr.y;')
      .replace('material.clearcoat = clearcoat;', 'material.clearcoat = vPbr.z;')
      .replace('material.clearcoatRoughness = clearcoatRoughness;', 'material.clearcoatRoughness = vPbr.w;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, uHeatColor, uHeat);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance = vEmit * (1.0 - uHeat) + uHeatColor * uHeat * 0.55;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  float fres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.5);
  outgoingLight = mix(outgoingLight, outgoingLight * 0.6 + uHighlightColor * (0.18 + 0.55 * fres), uHighlight * 0.55);
}
#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'fab-robot-surface';
  return m as FabMaterial;
}

/** Per-vertex attribute values of a look (linear colour, PBR, emission, noise). */
export function lookAttributes(name: LookName): { color: Color; pbr: [number, number, number, number]; emit: Color; noise: [number, number] } {
  const l: Look = LOOKS[name];
  const color = new Color(l.color);
  const emit = l.emissive ? new Color(l.emissive).multiplyScalar(l.emissiveIntensity ?? 1) : new Color(0, 0, 0);
  return { color, pbr: [l.roughness, l.metalness, l.clearcoat ?? 0, l.clearcoatRoughness ?? 0.5], emit, noise: [l.noise ?? 0.05, l.noiseScale ?? 200] };
}

export interface Look {
  color: string;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  noise?: number;
  noiseScale?: number;
  envMapIntensity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  sheen?: number;
  side?: Side;
}

/** The palette. Colours are chosen for a believable prototype, not a render showcase. */
export const LOOKS = {
  // molded and painted covers: warm light grey, satin
  shell: { color: '#d6d4ce', metalness: 0, roughness: 0.46, clearcoat: 0.22, clearcoatRoughness: 0.45, noise: 0.05, noiseScale: 140 },
  // printed/molded secondary covers and insets: graphite, matte
  shellDark: { color: '#2a2c30', metalness: 0, roughness: 0.62, clearcoat: 0.08, clearcoatRoughness: 0.6, noise: 0.07, noiseScale: 220 },
  // black-anodised aluminium structure
  anodized: { color: '#34373d', metalness: 1, roughness: 0.4, noise: 0.08, noiseScale: 300 },
  // bead-blasted natural aluminium housings
  alu: { color: '#a3a7ad', metalness: 1, roughness: 0.4, noise: 0.07, noiseScale: 420 },
  // turned / machined bright aluminium
  aluBright: { color: '#c6c9ce', metalness: 1, roughness: 0.22, noise: 0.05, noiseScale: 900 },
  steel: { color: '#8f9398', metalness: 1, roughness: 0.3, noise: 0.05, noiseScale: 600 },
  steelDark: { color: '#3d3f43', metalness: 1, roughness: 0.34, noise: 0.05 },
  titanium: { color: '#8a8580', metalness: 1, roughness: 0.34, noise: 0.06 },
  rubber: { color: '#151617', metalness: 0, roughness: 0.88, noise: 0.05, noiseScale: 800 },
  silicone: { color: '#1f2023', metalness: 0, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.5, noise: 0.04 },
  visor: { color: '#050607', metalness: 0.1, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04, noise: 0.0, envMapIntensity: 1.3 },
  lens: { color: '#0a0c14', metalness: 0.3, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, noise: 0 },
  copper: { color: '#b86a3e', metalness: 1, roughness: 0.34, noise: 0.08, noiseScale: 1200 },
  lamination: { color: '#5b5f66', metalness: 1, roughness: 0.46, noise: 0.1, noiseScale: 1500 },
  magnet: { color: '#aeb1b5', metalness: 1, roughness: 0.25, noise: 0.03 },
  pcb: { color: '#18261f', metalness: 0.1, roughness: 0.55, noise: 0.05 },
  pcbBlack: { color: '#141517', metalness: 0.1, roughness: 0.5, noise: 0.05 },
  chip: { color: '#1b1c1f', metalness: 0.2, roughness: 0.4, noise: 0.02 },
  gold: { color: '#c9a45c', metalness: 1, roughness: 0.3, noise: 0.03 },
  cable: { color: '#121315', metalness: 0, roughness: 0.6, noise: 0.05 },
  cableGrey: { color: '#4a4d52', metalness: 0, roughness: 0.55, noise: 0.05 },
  cell: { color: '#2f4a55', metalness: 0.3, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3, noise: 0.03 },
  cellTop: { color: '#b0b3b8', metalness: 1, roughness: 0.3, noise: 0.03 },
  busbar: { color: '#c08a55', metalness: 1, roughness: 0.28, noise: 0.05 },
  nickel: { color: '#b5b7ba', metalness: 1, roughness: 0.3, noise: 0.04 },
  thermalPad: { color: '#7a7f86', metalness: 0, roughness: 0.8, noise: 0.05 },
  fan: { color: '#1a1b1e', metalness: 0, roughness: 0.5, noise: 0.03 },
  // quiet status light (FAB / ONE violet), used sparingly
  status: { color: '#1a1830', metalness: 0, roughness: 0.3, emissive: '#7a6cff', emissiveIntensity: 1.1, noise: 0 },
  statusDim: { color: '#16151f', metalness: 0, roughness: 0.3, emissive: '#5a4fd0', emissiveIntensity: 0.35, noise: 0 },
  marking: { color: '#e9e7e2', metalness: 0, roughness: 0.5, noise: 0 },
} satisfies Record<string, Look>;

export type LookName = keyof typeof LOOKS;

const cache = new Map<string, FabMaterial>();

function physical(l: Look): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: new Color(l.color),
    metalness: l.metalness,
    roughness: l.roughness,
    clearcoat: l.clearcoat ?? 0,
    clearcoatRoughness: l.clearcoatRoughness ?? 0,
    envMapIntensity: l.envMapIntensity ?? 1,
    side: l.side ?? FrontSide,
  });
  if (l.emissive) {
    m.emissive = new Color(l.emissive);
    m.emissiveIntensity = l.emissiveIntensity ?? 1;
  }
  return m;
}

/** The shared opaque material of a look. */
export function material(name: LookName): FabMaterial {
  if (cache.has(name)) return cache.get(name)!;
  const l: Look = LOOKS[name];
  const fm = extendSurface(physical(l), name, l.noise ?? 0.05, l.noiseScale ?? 200);
  cache.set(name, fm);
  return fm;
}

/** A private copy of a look with its own uniforms (it shares the compiled program). */
export function materialInstance(name: LookName, key: string): FabMaterial {
  const l: Look = LOOKS[name];
  return extendSurface(physical(l), `${name}:${key}`, l.noise ?? 0.05, l.noiseScale ?? 200);
}

/** The transparent twin of an opaque material (for fades), with the same uniforms. */
export function fadeTwin(m: FabMaterial): FabMaterial {
  const f = m.clone() as FabMaterial;
  f.transparent = true;
  f.depthWrite = true;
  f.opacity = 1;
  f.userData.fab = m.userData.fab;
  f.onBeforeCompile = m.onBeforeCompile;
  f.customProgramCacheKey = m.customProgramCacheKey;
  return f;
}

/**
 * X-ray ghost: an unlit fresnel shell, as in a technical illustration: faint where the surface
 * faces the viewer, stronger at silhouettes. Depth-tested but not written, so internal parts
 * stay fully visible.
 */
export function ghostMaterial(color = '#c9cdd6', strength = 1): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uOpacity: { value: 0 }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; uniform float uStrength;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = (0.035 + 0.55 * pow(f, 3.0)) * uStrength;
        gl_FragColor = vec4(uColor, a * uOpacity);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
  });
}

/** Flat colour for overlays (vectors, polygons, markers), unaffected by lighting. */
export function overlayMaterial(color: string, opacity = 1, additive = false): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity, depthWrite: false, blending: additive ? AdditiveBlending : NormalBlending, toneMapped: false });
}

// ───────────────────────────── procedural textures ─────────────────────────────

/** A text / marking decal texture (restrained engineering markings). */
export function markingTexture(lines: { text: string; size: number; weight?: number; tracking?: number; y: number; x?: number; align?: CanvasTextAlign; color?: string; font?: string }[], w = 512, h = 128): Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  for (const l of lines) {
    g.fillStyle = l.color ?? '#e9e7e2';
    g.font = `${l.weight ?? 600} ${l.size}px ${l.font ?? "'Archivo Variable', 'Inter Variable', system-ui, sans-serif"}`;
    g.textAlign = l.align ?? 'left';
    g.textBaseline = 'middle';
    // letter spacing where supported
    (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${l.tracking ?? 0}px`;
    g.fillText(l.text, l.x ?? 0, l.y);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = LinearMipMapLinearFilter;
  t.magFilter = LinearFilter;
  return t;
}

/** Tileable value-noise texture (grey), for floors and walls. */
export function noiseTexture(size = 256, octaves = 4, seed = 3): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  let s = seed;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const grids: number[][] = [];
  for (let o = 0; o < octaves; o++) {
    const n = 4 << o;
    const grid: number[] = [];
    for (let i = 0; i < n * n; i++) grid.push(rand());
    grids.push(grid);
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.5;
      let tot = 0;
      for (let o = 0; o < octaves; o++) {
        const n = 4 << o;
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const gr = grids[o];
        const at = (i: number, j: number) => gr[((j % n) + n) % n * n + (((i % n) + n) % n)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        v += (a + (b - a) * sy) * amp;
        tot += amp;
        amp *= 0.5;
      }
      const k = (y * size + x) * 4;
      const val = Math.round((v / tot) * 255);
      img.data[k] = img.data[k + 1] = img.data[k + 2] = val;
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export { DoubleSide };
