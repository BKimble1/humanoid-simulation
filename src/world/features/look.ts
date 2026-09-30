/**
 * Scene-wide looks driven by channels: the thermal view (every actuator housing, the battery,
 * the computers and the power converter as heat sources on the robot's surface, the lab
 * dimmed like a thermal camera's view), and the joint-test rig's work light.
 */
import { Vector3 } from 'three';
import { JOINTS } from '../../spec/body';
import { HEAT, HEAT_MAX } from '../../scene/materials';
import type { Feature, World } from '../world';

/** Where each joint's actuator body sits (anchors where it is not on the joint axis). */
const BODY_ANCHOR: Record<string, string> = {
  L_knee: 'kneeActL',
  R_knee: 'kneeActR',
  L_ankle_pitch: 'ankleActL',
  R_ankle_pitch: 'ankleActR',
  L_elbow: 'elbowActL',
  R_elbow: 'elbowActR',
};

export class Look implements Feature {
  private base: { key: number; rimL: number; rimR: number; hemi: number; env: number } | null = null;
  private tmp = new Vector3();

  update(w: World) {
    const lab = w.lab;
    if (!this.base) this.base = { key: lab.key.intensity, rimL: lab.rimL.intensity, rimR: lab.rimR.intensity, hemi: lab.hemi.intensity, env: w.stage.scene.environmentIntensity };
    const b = this.base;
    const th = w.ch.get('thermal');
    const dim = 1 - 0.72 * th;
    lab.key.intensity = b.key * dim;
    lab.rimL.intensity = b.rimL * (1 - 0.5 * th);
    lab.rimR.intensity = b.rimR * (1 - 0.5 * th);
    lab.hemi.intensity = b.hemi * dim;
    w.stage.scene.environmentIntensity = b.env * (1 - 0.6 * th);
    lab.rigLight.intensity = 70 * w.ch.get('rigLight');
    // robot materials: thermal mix
    for (const rm of w.rig.meshes) rm.solid.userData.fab.uHeat.value = th;
    if (th < 0.001) return;
    const e = w.energy;
    const src = HEAT.uHeatSrc.value;
    const amb = e.ambient;
    HEAT.uHeatAmbient.value = amb;
    let k = 0;
    JOINTS.forEach((j, i) => {
      if (k >= HEAT_MAX) return;
      let T: number | null = null;
      if (e.thermal[i]) T = e.thermal[i]!.Th * 0.6 + e.thermal[i]!.Tw * 0.4;
      else if (j.id === 'L_ankle_pitch' || j.id === 'R_ankle_pitch') {
        const o = j.id.startsWith('L') ? 0 : 2;
        T = Math.max(e.ankleThermal[o].Th, e.ankleThermal[o + 1].Th);
      }
      if (T === null) return;
      const p = BODY_ANCHOR[j.id] ? w.anchor(BODY_ANCHOR[j.id], this.tmp) : w.kin.jointPos[i];
      src[k++].set(p.x, p.y, p.z, Math.max(0, T - amb));
    });
    const extra: [string, number][] = [
      ['cells', e.pack.tempC],
      ['perceptionPC', e.computeT],
      ['dcdc', amb + 8 + e.summary.lv * 0.05],
      ['rtController', amb + 14],
    ];
    for (const [name, T] of extra) {
      if (k >= HEAT_MAX) break;
      const p = w.anchor(name, this.tmp);
      src[k++].set(p.x, p.y, p.z, Math.max(0, T - amb));
    }
    for (; k < HEAT_MAX; k++) src[k].set(0, -10, 0, 0);
  }
}
