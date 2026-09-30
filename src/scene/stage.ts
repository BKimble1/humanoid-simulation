/**
 * The renderer: one WebGL context, one scene, one camera, a post-processing chain chosen by the
 * quality tier, and the frame loop hooks. Nothing here decides what is shown; the World does.
 *
 *   high / medium   render → ambient occlusion (N8AO) → bloom (subtle) → AgX tone mapping →
 *                   vignette, with 4× MSAA on the scene target
 *   low             direct render with AgX tone mapping (software renderers, weak devices)
 */
import { EffectComposer, EffectPass, RenderPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, SMAAEffect, SMAAPreset } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import {
  AgXToneMapping,
  Color,
  HalfFloatType,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Texture,
} from 'three';
import { buildEnvironment } from './env';
import { FrameMonitor, TIERS, initialTier, useQuality, type Tier } from './quality';
import { CAPTURE } from './time';

export class Stage {
  renderer: WebGLRenderer;
  scene = new Scene();
  camera = new PerspectiveCamera(32, 16 / 9, 0.02, 80);
  env: Texture;
  private composer: EffectComposer | null = null;
  private ao: N8AOPostPass | null = null;
  private tier: Tier;
  private monitor = new FrameMonitor();
  width = 1;
  height = 1;
  canvas: HTMLCanvasElement;
  private unsub: () => void;
  /** Draw calls and triangles of the last frame (diagnostics and tests). */
  stats = { calls: 0, triangles: 0 };
  exposure = 1;
  onResize?: (w: number, h: number) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: CAPTURE,
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.info.autoReset = false;
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    const nav = navigator as Navigator & { deviceMemory?: number };
    this.tier = initialTier(rendererName, navigator.hardwareConcurrency || 4, nav.deviceMemory, matchMedia('(pointer: coarse)').matches, window.devicePixelRatio || 1);
    useQuality.setState({ tier: this.tier, renderer: rendererName, reason: useQuality.getState().reason === 'default' ? 'device' : useQuality.getState().reason });
    this.scene.background = new Color('#0a0b0d');
    this.env = buildEnvironment(this.renderer);
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.55;
    this.applyTier(this.tier);
    this.unsub = useQuality.subscribe((s) => {
      if (s.tier !== this.tier) this.applyTier(s.tier);
    });
  }

  private applyTier(t: Tier) {
    this.tier = t;
    const spec = TIERS[t];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, spec.dprMax));
    this.scene.traverse((o) => {
      const l = o as unknown as { isLight?: boolean; castShadow?: boolean; shadow?: { mapSize: { set(a: number, b: number): void }; map: { dispose(): void } | null } };
      if (l.isLight && l.castShadow && l.shadow) {
        l.shadow.mapSize.set(spec.shadowMap, spec.shadowMap);
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    });
    this.composer?.dispose();
    this.composer = null;
    this.ao = null;
    if (spec.ao || spec.bloom) {
      this.renderer.toneMapping = NoToneMapping;
      // recordings (software renderer, frame by frame) use SMAA: the same edges for a quarter of the fill
      const msaa = CAPTURE ? 0 : spec.msaa;
      const composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType, multisampling: msaa });
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (spec.ao) {
        const ao = new N8AOPostPass(this.scene, this.camera, this.width, this.height);
        ao.configuration.aoRadius = 0.22;
        ao.configuration.distanceFalloff = 0.6;
        ao.configuration.intensity = 2.2;
        ao.configuration.halfRes = true;
        ao.configuration.depthAwareUpsampling = true;
        ao.configuration.gammaCorrection = false;
        ao.setQualityMode('Medium');
        composer.addPass(ao);
        this.ao = ao;
      }
      const effects = [];
      if (spec.bloom) effects.push(new BloomEffect({ intensity: 0.35, luminanceThreshold: 0.92, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.55 }));
      effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
      effects.push(new VignetteEffect({ offset: 0.32, darkness: 0.42 }));
      if (!msaa) effects.push(new SMAAEffect({ preset: SMAAPreset.HIGH }));
      composer.addPass(new EffectPass(this.camera, ...effects));
      this.composer = composer;
    } else {
      this.renderer.toneMapping = AgXToneMapping;
      this.renderer.toneMappingExposure = this.exposure;
    }
    this.resize(this.width, this.height);
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.onResize?.(this.width, this.height);
    this.composer?.setSize(this.width, this.height);
    this.ao?.setSize(this.width, this.height);
  }

  render(dt: number) {
    this.monitor.update(dt);
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
  }

  /** Compile every material in the scene before it is first drawn (no hitch mid-move). */
  async prewarm() {
    const r = this.renderer as WebGLRenderer & { compileAsync?: (s: Scene, c: PerspectiveCamera) => Promise<unknown> };
    if (r.compileAsync) await r.compileAsync(this.scene, this.camera);
    else this.renderer.compile(this.scene, this.camera);
  }

  get currentTier(): Tier {
    return this.tier;
  }

  dispose() {
    this.unsub();
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
