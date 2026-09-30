/**
 * Development harness: the lab and the robot with orbit controls, and hooks for stills
 * (scripts/stills.mjs). Loaded with ?dev=1 in development builds only.
 */
import { Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { restPose } from '../engine/skeleton';
import { solveLeg, ankleFromSole } from '../engine/ik';
import { Stage } from '../scene/stage';
import { Lab } from '../scene/lab/lab';
import { buildRobot } from '../scene/robot/build';
import { UNIT_SCALE } from '../engine/skeleton';
import { Quaternion } from 'three';
import { DIM } from '../spec/body';

export function startHarness(canvas: HTMLCanvasElement) {
  const stage = new Stage(canvas);
  const lab = new Lab();
  stage.scene.add(lab.group);
  const rig = buildRobot({ scale: UNIT_SCALE, parallel: 9 });
  stage.scene.add(rig.root);
  const pose = restPose();
  pose.pelvisPos.set(0, 0.89, 0);
  const q = new Quaternion();
  solveLeg(pose, 'L', ankleFromSole(new Vector3(DIM.hipHalfWidth, 0, 0.0), q), q, UNIT_SCALE);
  solveLeg(pose, 'R', ankleFromSole(new Vector3(-DIM.hipHalfWidth, 0, 0.0), q), q, UNIT_SCALE);
  rig.apply(pose);
  const cam = stage.camera;
  cam.position.set(1.6, 1.35, 3.4);
  const controls = new OrbitControls(cam, canvas);
  controls.target.set(0, 1.0, 0);
  controls.update();
  const resize = () => stage.resize(canvas.clientWidth, canvas.clientHeight);
  resize();
  window.addEventListener('resize', resize);
  let running = true;
  const loop = () => {
    if (!running) return;
    controls.update();
    stage.render(1 / 60);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const w = window as unknown as Record<string, unknown>;
  w.__dev = {
    stage,
    rig,
    pose,
    lab,
    view(px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov = 32) {
      cam.position.set(px, py, pz);
      controls.target.set(tx, ty, tz);
      cam.fov = fov;
      cam.updateProjectionMatrix();
      controls.update();
      stage.render(1 / 60);
    },
    stop() {
      running = false;
    },
    render() {
      stage.render(1 / 60);
    },
    stats: () => ({ ...stage.stats, meshes: rig.meshes.length }),
  };
  return stage;
}
