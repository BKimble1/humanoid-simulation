/**
 * The laboratory: a dark, quiet robotics test hall. The robot stands on an in-ground,
 * force-instrumented treadmill (flush with the floor, as in gait laboratories) under a safety
 * gantry. Equipment around the edges stays in the dark so the robot stays the subject.
 *
 * Lights are fixed in number (changing the count of lights recompiles every lit material):
 * one shadow-casting key, two rims, a hemisphere fill, and the rig light for the joint bench.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SpotLight,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { merge as mergeGeometries } from '../geo/merge';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { material, noiseTexture } from '../materials';

export const TREADMILL = { width: 1.05, front: 1.15, back: -1.35 } as const;

function floorTexture(): { color: Texture; rough: Texture } {
  const n = noiseTexture(512, 6, 9);
  n.repeat.set(10, 10);
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  // polished epoxy: near-black with faint mottling and a few trowel sweeps
  g.fillStyle = '#1a1c1f';
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  let s = 5;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (rnd() - 0.5) * 6;
    img.data[i] += v;
    img.data[i + 1] += v;
    img.data[i + 2] += v;
  }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.05;
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = rnd() > 0.5 ? '#2a2c30' : '#141517';
    g.lineWidth = 20 + rnd() * 60;
    g.beginPath();
    const x = rnd() * size;
    const y = rnd() * size;
    g.arc(x, y, 80 + rnd() * 300, rnd() * 6, rnd() * 6 + 1.2);
    g.stroke();
  }
  const color = new CanvasTexture(c);
  color.colorSpace = SRGBColorSpace;
  color.wrapS = color.wrapT = RepeatWrapping;
  color.repeat.set(6, 6);
  color.anisotropy = 8;
  return { color, rough: n };
}

/** Floor markings: the test cell outline, a faint measurement grid, a heading arrow. */
function markingsTexture(): Texture {
  const size = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  const m = size / 6; // 6 m square
  const px = (x: number) => size / 2 + x * m;
  const pz = (z: number) => size / 2 - z * m;
  // faint grid, 0.5 m
  g.strokeStyle = 'rgba(210,214,222,0.07)';
  g.lineWidth = 2;
  for (let i = -6; i <= 6; i++) {
    g.beginPath();
    g.moveTo(px(i * 0.5), pz(-3));
    g.lineTo(px(i * 0.5), pz(3));
    g.stroke();
    g.beginPath();
    g.moveTo(px(-3), pz(i * 0.5));
    g.lineTo(px(3), pz(i * 0.5));
    g.stroke();
  }
  // cell outline with corner marks
  g.strokeStyle = 'rgba(226,228,232,0.32)';
  g.lineWidth = 5;
  g.strokeRect(px(-2.6), pz(2.6), 5.2 * m, 5.2 * m);
  g.strokeStyle = 'rgba(226,228,232,0.6)';
  g.lineWidth = 9;
  for (const [x, z, dx, dz] of [
    [-2.6, 2.6, 1, -1],
    [2.6, 2.6, -1, -1],
    [-2.6, -2.6, 1, 1],
    [2.6, -2.6, -1, 1],
  ]) {
    g.beginPath();
    g.moveTo(px(x + dx * 0.35), pz(z));
    g.lineTo(px(x), pz(z));
    g.lineTo(px(x), pz(z + dz * 0.35));
    g.stroke();
  }
  // labels
  g.fillStyle = 'rgba(226,228,232,0.34)';
  g.font = `600 ${m * 0.075}px 'Archivo Variable', system-ui, sans-serif`;
  g.fillText('TEST CELL 01', px(-2.5), pz(-2.42));
  g.textAlign = 'right';
  g.fillText('+Z  FORWARD', px(2.5), pz(2.42));
  return new CanvasTexture(c);
}

function beltTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#101113';
  g.fillRect(0, 0, 64, 256);
  // fine transverse ribs (the direction of travel is along the texture's V)
  for (let y = 0; y < 256; y += 8) {
    g.fillStyle = '#1b1c1f';
    g.fillRect(0, y, 64, 3);
  }
  // one reference stripe so the motion reads
  g.fillStyle = '#3a3c41';
  g.fillRect(0, 120, 64, 5);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class Lab {
  group = new Group();
  belt: Mesh;
  beltTex: Texture;
  /** Belt travel so far, m (the belt texture offset follows it exactly). */
  beltOffset = 0;
  key: SpotLight;
  rimL: SpotLight;
  rimR: SpotLight;
  rigLight: SpotLight;
  hemi: HemisphereLight;
  monitorScreen: Mesh;
  private beltRepeat: number;

  constructor() {
    const g = this.group;
    // floor
    const { color, rough } = floorTexture();
    void rough;
    const floorMat = new MeshStandardMaterial({ map: color, roughness: 0.58, metalness: 0.0, envMapIntensity: 0.28 });
    const floor = new Mesh(new PlaneGeometry(40, 40), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'floor';
    g.add(floor);
    const marks = new Mesh(new PlaneGeometry(6, 6), new MeshBasicMaterial({ map: markingsTexture(), transparent: true, depthWrite: false, toneMapped: true, opacity: 0.9 }));
    marks.rotation.x = -Math.PI / 2;
    marks.position.y = 0.0015;
    marks.renderOrder = 1;
    g.add(marks);

    // in-ground treadmill: steel surround plates flush with the floor, the belt in a recess
    const T = TREADMILL;
    const len = T.front - T.back;
    const surround = material('steelDark');
    const plates: Mesh[] = [];
    const plateGeo = [
      new BoxGeometry(0.16, 0.02, len + 0.32).translate(-(T.width / 2 + 0.08), -0.009, (T.front + T.back) / 2),
      new BoxGeometry(0.16, 0.02, len + 0.32).translate(T.width / 2 + 0.08, -0.009, (T.front + T.back) / 2),
      new BoxGeometry(T.width, 0.02, 0.16).translate(0, -0.009, T.front + 0.08),
      new BoxGeometry(T.width, 0.02, 0.16).translate(0, -0.009, T.back - 0.08),
    ];
    const surroundMesh = new Mesh(mergeGeometries(plateGeo), surround);
    surroundMesh.receiveShadow = true;
    plates.push(surroundMesh);
    g.add(surroundMesh);
    // a thin dark gap line around the belt
    const gap = new Mesh(new BoxGeometry(T.width + 0.012, 0.002, len + 0.012).translate(0, -0.0008, (T.front + T.back) / 2), new MeshBasicMaterial({ color: '#050506' }));
    g.add(gap);
    this.beltTex = beltTexture();
    this.beltRepeat = len / 0.25;
    this.beltTex.repeat.set(4, this.beltRepeat);
    const beltMat = new MeshStandardMaterial({ map: this.beltTex, roughness: 0.9, metalness: 0, envMapIntensity: 0.12 });
    this.belt = new Mesh(new PlaneGeometry(T.width, len), beltMat);
    this.belt.rotation.x = -Math.PI / 2;
    this.belt.position.set(0, 0.0004, (T.front + T.back) / 2);
    this.belt.receiveShadow = true;
    this.belt.name = 'belt';
    g.add(this.belt);
    // force-plate label on the front plate
    const label = document.createElement('canvas');
    label.width = 1024;
    label.height = 64;
    const lg = label.getContext('2d')!;
    lg.fillStyle = 'rgba(220,222,226,0.55)';
    lg.font = "600 30px 'Archivo Variable', system-ui, sans-serif";
    (lg as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '6px';
    lg.fillText('INSTRUMENTED TREADMILL  ·  SPLIT BELT  ·  2 × 6-AXIS FORCE PLATES', 8, 42);
    const lt = new CanvasTexture(label);
    lt.colorSpace = SRGBColorSpace;
    const lm = new Mesh(new PlaneGeometry(0.96, 0.06), new MeshBasicMaterial({ map: lt, transparent: true, depthWrite: false }));
    lm.rotation.x = -Math.PI / 2;
    lm.position.set(0, 0.0015, T.front + 0.08);
    g.add(lm);

    // safety rail overhead: a ceiling-mounted beam along the treadmill, a trolley, a stowed
    // fall-arrest strap (it clips to the robot's back when a new controller is tested)
    const gantry = new Group();
    const frame = material('anodized');
    const parts = [
      new RoundedBoxGeometry(0.16, 0.12, 6.0, 2, 0.01).translate(0, 4.2, -0.4),
      new BoxGeometry(0.04, 0.5, 0.04).translate(0, 4.5, 2.2),
      new BoxGeometry(0.04, 0.5, 0.04).translate(0, 4.5, -3.0),
    ];
    const gm = new Mesh(mergeGeometries(parts), frame);
    gantry.add(gm);
    const trolley = new Mesh(new RoundedBoxGeometry(0.2, 0.1, 0.24, 2, 0.01).translate(0, 4.09, -0.35), material('alu'));
    gantry.add(trolley);
    const strap = new Mesh(new CylinderGeometry(0.01, 0.01, 1.2, 10).translate(0, 3.45, -0.35), material('shellDark'));
    gantry.add(strap);
    const clip = new Mesh(new RoundedBoxGeometry(0.05, 0.09, 0.02, 2, 0.006).translate(0, 2.82, -0.35), material('steel'));
    gantry.add(clip);
    g.add(gantry);

    // walls and ceiling: dark acoustic panels, a control-room window, light strips
    const wallMat = new MeshStandardMaterial({ color: new Color('#15171a'), roughness: 0.9, metalness: 0 });
    const walls = new Group();
    const back = new Mesh(new PlaneGeometry(22, 6), wallMat);
    back.position.set(0, 3, -6.5);
    walls.add(back);
    const left = new Mesh(new PlaneGeometry(18, 6), wallMat);
    left.position.set(-9, 3, 0);
    left.rotation.y = Math.PI / 2;
    walls.add(left);
    const right = left.clone();
    right.position.x = 9;
    right.rotation.y = -Math.PI / 2;
    walls.add(right);
    // vertical panel seams on the back wall
    const seams: ReturnType<typeof BoxGeometry.prototype.clone>[] = [];
    for (let x = -10; x <= 10; x += 1.2) seams.push(new BoxGeometry(0.015, 6, 0.02).translate(x, 3, -6.49));
    walls.add(new Mesh(mergeGeometries(seams), new MeshStandardMaterial({ color: '#0d0e10', roughness: 0.9 })));
    // control-room window: dark glass with warm, dim interior light
    const win = new Mesh(new PlaneGeometry(6.5, 1.3), new MeshBasicMaterial({ color: new Color('#2a2118') }));
    win.position.set(-3.2, 2.1, -6.47);
    walls.add(win);
    const winFrame = new Mesh(new BoxGeometry(6.7, 1.5, 0.04).translate(-3.2, 2.1, -6.49), new MeshStandardMaterial({ color: '#0a0b0c', roughness: 0.6 }));
    walls.add(winFrame);
    // light strips: soft vertical LED bars on the back wall
    const stripMat = new MeshBasicMaterial({ color: new Color('#cfd8ea').multiplyScalar(0.9) });
    for (const x of [2.4, 5.8, -7.6]) {
      const s = new Mesh(new BoxGeometry(0.06, 3.6, 0.02), stripMat);
      s.position.set(x, 2.2, -6.45);
      walls.add(s);
    }
    // ceiling light over the test cell (seen in reflections and when the camera looks up)
    const ceilingLight = new Mesh(new BoxGeometry(2.4, 0.03, 0.5), new MeshBasicMaterial({ color: new Color('#f3f0ea').multiplyScalar(1.6) }));
    ceilingLight.position.set(0, 4.6, 0.6);
    walls.add(ceilingLight);
    const ceiling = new Mesh(new PlaneGeometry(22, 18), new MeshStandardMaterial({ color: '#0e0f11', roughness: 1 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 4.8;
    walls.add(ceiling);
    g.add(walls);

    // equipment at the edges (kept in shadow)
    const equip = new Group();
    const dark = material('shellDark');
    const bench = new Mesh(
      mergeGeometries([
        new RoundedBoxGeometry(1.8, 0.05, 0.75, 2, 0.01).translate(0, 0.9, 0),
        new BoxGeometry(0.05, 0.9, 0.05).translate(-0.85, 0.45, -0.32),
        new BoxGeometry(0.05, 0.9, 0.05).translate(0.85, 0.45, -0.32),
        new BoxGeometry(0.05, 0.9, 0.05).translate(-0.85, 0.45, 0.32),
        new BoxGeometry(0.05, 0.9, 0.05).translate(0.85, 0.45, 0.32),
        new RoundedBoxGeometry(1.7, 0.4, 0.62, 2, 0.01).translate(0, 0.28, 0),
      ]),
      dark,
    );
    bench.position.set(-4.2, 0, -3.4);
    bench.rotation.y = 0.35;
    bench.castShadow = true;
    bench.receiveShadow = true;
    equip.add(bench);
    // a tall equipment rack with status lights
    const rack = new Mesh(new RoundedBoxGeometry(0.62, 2.0, 0.8, 2, 0.012), dark);
    rack.position.set(5.6, 1.0, -4.8);
    rack.rotation.y = -0.4;
    rack.castShadow = true;
    equip.add(rack);
    const leds = new Mesh(new BoxGeometry(0.3, 0.012, 0.004), new MeshBasicMaterial({ color: new Color('#7a6cff').multiplyScalar(0.8) }));
    leds.position.set(0.12, 0.6, 0.402);
    rack.add(leds);
    for (let i = 0; i < 5; i++) {
      const l = new Mesh(new BoxGeometry(0.02, 0.012, 0.004), new MeshBasicMaterial({ color: new Color(i % 2 ? '#39c28a' : '#d7dbe4') }));
      l.position.set(-0.22, 0.75 - i * 0.12, 0.402);
      rack.add(l);
    }
    // telemetry monitor on a stand, facing the cell
    const stand = new Mesh(mergeGeometries([new CylinderGeometry(0.02, 0.02, 1.35, 12).translate(0, 0.675, 0), new CylinderGeometry(0.22, 0.24, 0.03, 24).translate(0, 0.015, 0)]), material('anodized'));
    stand.position.set(3.1, 0, -2.2);
    equip.add(stand);
    const screenBack = new Mesh(new RoundedBoxGeometry(0.9, 0.54, 0.04, 2, 0.01), dark);
    screenBack.position.set(3.1, 1.55, -2.2);
    screenBack.rotation.y = -0.7;
    equip.add(screenBack);
    this.monitorScreen = new Mesh(new PlaneGeometry(0.86, 0.5), new MeshBasicMaterial({ color: new Color('#0f1218') }));
    this.monitorScreen.position.set(0, 0, 0.021);
    screenBack.add(this.monitorScreen);
    g.add(equip);

    // lights
    this.key = new SpotLight(new Color('#fff3e4'), 150, 0, 0.5, 0.9, 2);
    this.key.position.set(-2.6, 5.4, 3.8);
    this.key.target.position.set(0, 0.9, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.near = 3;
    this.key.shadow.camera.far = 12;
    this.key.shadow.bias = -0.00015;
    this.key.shadow.normalBias = 0.015;
    g.add(this.key, this.key.target);
    this.rimL = new SpotLight(new Color('#d5e1ff'), 90, 0, 0.55, 0.9, 2);
    this.rimL.position.set(-3.4, 3.4, -3.8);
    this.rimL.target.position.set(0, 1.1, 0);
    g.add(this.rimL, this.rimL.target);
    this.rimR = new SpotLight(new Color('#dfe8ff'), 110, 0, 0.55, 0.9, 2);
    this.rimR.position.set(3.6, 3.9, -3.3);
    this.rimR.target.position.set(0, 1.1, 0);
    g.add(this.rimR, this.rimR.target);
    this.rigLight = new SpotLight(new Color('#fff1e0'), 0, 0, 0.45, 0.8, 2);
    this.rigLight.position.set(4.4, 3.6, 2.8);
    this.rigLight.target.position.set(3.2, 0.9, 0.2);
    g.add(this.rigLight, this.rigLight.target);
    this.hemi = new HemisphereLight(new Color('#c7d0e0'), new Color('#1a1714'), 0.18);
    g.add(this.hemi);
  }

  /** Move the belt by d metres (towards −Z when positive), with its texture exactly in step. */
  moveBelt(d: number) {
    this.beltOffset += d;
    const len = TREADMILL.front - TREADMILL.back;
    // V runs along the belt's length; one repeat spans len / beltRepeat metres
    // the plane's V axis points to −Z in the world, so moving the surface towards −Z lowers the
    // texture offset
    this.beltTex.offset.y = -((this.beltOffset / len) * this.beltRepeat) % 1;
  }

  add(o: Object3D) {
    this.group.add(o);
  }
}
