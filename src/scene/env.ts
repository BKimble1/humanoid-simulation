/**
 * The reflection environment: a small virtual studio rendered once into a cube map and
 * prefiltered (PMREM). Dark walls, a large soft key panel overhead-front, two tall strip
 * lights behind (rims on metal edges) and a faint warm bounce from the floor. It is what the
 * metal and the glossy covers reflect, so it is designed like a product-photography set rather
 * than a room; it matches the lab's actual light positions.
 */
import {
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';

function panel(w: number, h: number, color: string, intensity: number): Mesh {
  const m = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), side: 2 });
  return new Mesh(new PlaneGeometry(w, h), m);
}

export function buildEnvironment(renderer: WebGLRenderer): Texture {
  const scene = new Scene();
  scene.background = new Color('#0c0d10');
  // room shell
  const room = new Mesh(new BoxGeometry(16, 7, 16), new MeshBasicMaterial({ color: new Color('#16181c'), side: BackSide }));
  room.position.y = 3.2;
  scene.add(room);
  // floor bounce (slightly warm, dim)
  const floor = panel(16, 16, '#2a2622', 0.55);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.2;
  scene.add(floor);
  // key: a large softbox above and in front, like the lab's key light
  const key = panel(3.6, 2.2, '#fff6ea', 5.2);
  key.position.set(-1.6, 4.6, 3.2);
  key.lookAt(0, 1.1, 0);
  scene.add(key);
  // top fill: a wide dim ceiling panel
  const top = panel(6, 3, '#dfe6f2', 1.5);
  top.position.set(0, 6.4, 0);
  top.rotation.x = Math.PI / 2;
  scene.add(top);
  // rim strips behind, left and right (cool)
  for (const x of [-3.2, 3.4]) {
    const s = panel(0.45, 4.2, '#dfe9ff', 6.5);
    s.position.set(x, 2.3, -3.8);
    s.lookAt(0, 1.2, 0);
    scene.add(s);
  }
  // a side strip at camera right for a long highlight along limbs
  const side = panel(0.35, 3.6, '#ffffff', 3.2);
  side.position.set(4.6, 2.2, 1.6);
  side.lookAt(0, 1.2, 0);
  scene.add(side);
  // a faint violet accent far behind: never visible directly, only as a whisper on chrome
  const accent = panel(1.5, 0.3, '#6a5af9', 1.2);
  accent.position.set(0.8, 1.2, -7.5);
  accent.lookAt(0, 1.2, 0);
  scene.add(accent);

  const pmrem = new PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 30);
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
  });
  return rt.texture;
}
