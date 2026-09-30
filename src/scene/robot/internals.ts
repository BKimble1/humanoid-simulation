/**
 * What is inside the torso: the battery pack (126 cells in 7 modules, with busbars, the BMS,
 * a removable front cover), power distribution (contactors, fuse, pre-charge, DC/DC), and the
 * computers in the backpack (perception computer on a finned heat sink with a fan, the
 * real-time controller, the safety controller, the EtherCAT hub).
 */
import { BoxGeometry, CylinderGeometry, Matrix4, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PACK } from '../../spec/power';
import type { SegmentId } from '../../spec/body';
import { discPart } from '../geo/lathe';
import { cable, plate } from './parts';
import type { RobotRig } from './rig';
import { T } from './build';

/** Battery geometry in the torso frame. */
export const BATTERY = {
  centre: new Vector3(0, 0.162, 0.008),
  size: new Vector3(0.212, 0.168, 0.162),
  cellPitch: 0.0222,
  cellH: 0.07,
};

export function buildBattery(rig: RobotRig, seg: SegmentId, parallel = PACK.parallel) {
  const c = BATTERY.centre;
  const sz = BATTERY.size;
  // enclosure: a dark tray (back, sides, bottom), and a separate front cover
  const tray = [
    plate(sz.x, sz.y, 0.004, 0.002).translate(c.x, c.y, c.z - sz.z / 2),
    plate(0.004, sz.y, sz.z, 0.002).translate(c.x - sz.x / 2, c.y, c.z),
    plate(0.004, sz.y, sz.z, 0.002).translate(c.x + sz.x / 2, c.y, c.z),
    plate(sz.x, 0.004, sz.z, 0.002).translate(c.x, c.y - sz.y / 2, c.z),
    plate(sz.x, 0.004, sz.z, 0.002).translate(c.x, c.y + sz.y / 2, c.z),
  ];
  for (const g of tray) rig.add(seg, 'anodized', 'power', g);
  const lid = rig.holder(seg, 'batteryLid');
  rig.addTo(lid, seg, 'shellDark', 'power', new RoundedBoxGeometry(sz.x + 0.006, sz.y + 0.006, 0.006, 2, 0.003).translate(c.x, c.y, c.z + sz.z / 2 + 0.003), 'batteryLid');
  // a small label on the lid
  rig.addTo(lid, seg, 'marking', 'power', new BoxGeometry(0.05, 0.008, 0.0008).translate(c.x - 0.06, c.y + 0.06, c.z + sz.z / 2 + 0.0065), 'batteryLid');
  rig.addTo(lid, seg, 'status', 'power', new BoxGeometry(0.012, 0.003, 0.001).translate(c.x + 0.075, c.y + 0.065, c.z + sz.z / 2 + 0.0065), 'batteryLid');
  // cells: two layers of 9 × 7 standing cells (14S9P = 126), holders and nickel strips
  const cells = rig.holder(seg, 'cells');
  const p = BATTERY.cellPitch;
  const cols = 9;
  const rows = 7;
  const cellBody = new CylinderGeometry(0.0104, 0.0104, BATTERY.cellH - 0.002, 12);
  const cellTop = discPart(0.0068, 0, 0.0012, 0.0003, 10);
  const shown = Math.min(parallel, 14);
  const layerY = [c.y - sz.y / 2 + 0.006 + BATTERY.cellH / 2, c.y - sz.y / 2 + 0.014 + BATTERY.cellH * 1.5];
  let count = 0;
  for (const ly of layerY)
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        // cells beyond the configured parallel count are left out (the pack shrinks with P)
        if (count >= 14 * shown) continue;
        count++;
        const x = c.x + (i - (cols - 1) / 2) * p;
        const z = c.z + (j - (rows - 1) / 2) * p;
        rig.addTo(cells, seg, 'cell', 'power', cellBody.clone().translate(x, ly, z), 'cells');
        rig.addTo(cells, seg, 'cellTop', 'power', cellTop.clone().translate(x, ly + BATTERY.cellH / 2 - 0.001, z), 'cells');
      }
  // holders between the layers and nickel strips joining each 9-cell parallel group
  for (const ly of layerY) {
    rig.addTo(cells, seg, 'shellDark', 'power', new BoxGeometry(sz.x - 0.01, 0.004, sz.z - 0.01).translate(c.x, ly - BATTERY.cellH / 2 - 0.002, c.z), 'cells');
    for (let j = 0; j < rows; j++) rig.addTo(cells, seg, 'nickel', 'power', new BoxGeometry(cols * p - 0.004, 0.0008, 0.007).translate(c.x, ly + BATTERY.cellH / 2 + 0.0008, c.z + (j - (rows - 1) / 2) * p), 'cells');
  }
  // BMS board on the pack's side, with its balance leads
  const bms = new Matrix4().makeRotationY(Math.PI / 2).premultiply(T(c.x + sz.x / 2 + 0.006, c.y, c.z));
  rig.add(seg, 'pcb', 'power', plate(0.13, 0.12, 0.0016, 0.002), { m: bms });
  for (let i = 0; i < 8; i++) rig.add(seg, 'chip', 'power', new BoxGeometry(0.012, 0.008, 0.002), { m: T(0, -0.04 + i * 0.012, 0.0015).premultiply(bms) });
  rig.add(seg, 'chip', 'power', new BoxGeometry(0.02, 0.02, 0.0025), { m: T(0.03, 0.02, 0.0015).premultiply(bms) });
  // main busbars out of the pack's top to the distribution below (copper, insulated sleeves)
  rig.add(seg, 'busbar', 'power', new BoxGeometry(0.01, 0.004, 0.06).translate(0.07, c.y + sz.y / 2 + 0.004, c.z));
  rig.add(seg, 'cableGrey', 'power', cable([new Vector3(0.07, c.y + sz.y / 2 + 0.004, c.z - 0.03), new Vector3(0.1, c.y + sz.y / 2 - 0.02, c.z - 0.09), new Vector3(0.104, 0.1, -0.06), new Vector3(0.085, 0.045, -0.02)], 0.0055, 40, 8));
  rig.add(seg, 'cableGrey', 'power', cable([new Vector3(-0.07, c.y + sz.y / 2 + 0.004, c.z - 0.03), new Vector3(-0.1, c.y + sz.y / 2 - 0.02, c.z - 0.09), new Vector3(-0.104, 0.1, -0.06), new Vector3(-0.085, 0.045, -0.02)], 0.0055, 40, 8));
  // power distribution beside the waist actuator: two contactors, fuse, pre-charge, DC/DC
  for (const z of [-0.012, 0.022]) {
    rig.add(seg, 'shellDark', 'power', new CylinderGeometry(0.013, 0.013, 0.036, 20), { m: T(0.082, 0.045, z) });
    rig.add(seg, 'busbar', 'power', discPart(0.004, 0, 0.004, 0.0005, 12), { m: T(0.082, 0.063, z) });
  }
  rig.add(seg, 'marking', 'power', new RoundedBoxGeometry(0.016, 0.03, 0.012, 2, 0.002), { m: T(0.108, 0.045, 0.005) });
  const dcdc = new RoundedBoxGeometry(0.036, 0.05, 0.07, 2, 0.003);
  rig.add(seg, 'alu', 'power', dcdc, { m: T(-0.09, 0.045, 0.004) });
  for (let i = 0; i < 6; i++) rig.add(seg, 'alu', 'power', new BoxGeometry(0.046, 0.0018, 0.074), { m: T(-0.09, 0.024 + i * 0.0085, 0.004) });
  rig.anchor('bms', seg, [c.x + sz.x / 2 + 0.008, c.y, c.z]);
  rig.anchor('contactors', seg, [0.082, 0.045, 0.005]);
  rig.anchor('dcdc', seg, [-0.09, 0.045, 0.004]);
  rig.anchor('cells', seg, [c.x, c.y + 0.03, c.z + sz.z / 2]);
}

export function buildCompute(rig: RobotRig, seg: SegmentId) {
  // backpack interior, behind the spine plate
  const z = -0.118;
  // perception computer: a module on a finned heat sink, a blower fan
  rig.add(seg, 'pcbBlack', 'compute', plate(0.12, 0.1, 0.004, 0.003), { m: T(0, 0.29, z + 0.022) });
  rig.add(seg, 'chip', 'compute', new RoundedBoxGeometry(0.1, 0.087, 0.012, 2, 0.003), { m: T(0, 0.29, z + 0.012) });
  for (let i = 0; i < 12; i++) rig.add(seg, 'alu', 'compute', new BoxGeometry(0.0015, 0.086, 0.018), { m: T(-0.045 + i * 0.0082, 0.29, z - 0.004) });
  rig.add(seg, 'fan', 'compute', discPart(0.022, 0, 0.012, 0.002, 32).rotateX(Math.PI / 2), { m: T(0.0, 0.21, z - 0.01) });
  // real-time controller and safety controller boards, EtherCAT hub
  rig.add(seg, 'pcb', 'compute', plate(0.1, 0.06, 0.0016, 0.002), { m: T(0, 0.195, z + 0.028) });
  for (let i = 0; i < 5; i++) rig.add(seg, 'chip', 'compute', new BoxGeometry(0.014, 0.014, 0.003), { m: T(-0.035 + i * 0.017, 0.2, z + 0.0265) });
  rig.add(seg, 'pcb', 'compute', plate(0.05, 0.035, 0.0016, 0.002), { m: T(0.06, 0.15, z + 0.032) });
  rig.add(seg, 'gold', 'compute', new BoxGeometry(0.012, 0.004, 0.003), { m: T(0.06, 0.14, z + 0.0305) });
  rig.add(seg, 'shellDark', 'compute', new RoundedBoxGeometry(0.05, 0.03, 0.02, 2, 0.003), { m: T(-0.055, 0.15, z + 0.03) });
  rig.anchor('perceptionPC', seg, [0, 0.29, z - 0.04]);
  rig.anchor('rtController', seg, [0, 0.195, z - 0.03]);
  rig.anchor('safety', seg, [0.06, 0.15, z - 0.03]);
  rig.anchor('ethercat', seg, [-0.055, 0.15, z - 0.03]);
}
