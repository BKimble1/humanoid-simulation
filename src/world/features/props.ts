/**
 * The lab's props: the autonomous cart and its items, the payload crates and the lift
 * platform, the joint test stand, and the kinematics lab's target and workspace.
 */
import { Group } from 'three';
import { CartProp } from '../props/cart';
import { IkProp } from '../props/ik';
import { PayloadProp } from '../props/payload';
import { RigProp } from '../props/rig';
import type { Feature, World } from '../world';

export class Props implements Feature {
  group = new Group();
  cart = new CartProp();
  payload = new PayloadProp();
  rig = new RigProp();
  ik = new IkProp();

  constructor() {
    this.group.name = 'props';
    this.group.add(this.cart.root, this.payload.root, this.rig.root, this.ik.root);
  }

  update(w: World, dt: number) {
    this.cart.update(w, dt);
    this.payload.update(w, dt);
    this.rig.update(w, dt);
    this.ik.update(w);
  }

  readouts(r: Record<string, number | string | boolean>, w: World) {
    if (w.sceneId !== 'sim.joint') return;
    const g = this.rig.rig;
    const deg = (v: number) => (v * 180) / Math.PI;
    r.jQ = deg(g.q);
    r.jQRef = deg(g.qRef);
    r.jErr = deg(g.qRef - g.q);
    r.jQd = deg(g.qd);
    r.jCurrent = g.current;
    r.jCurrentCmd = g.currentCmd;
    r.jTauMotor = g.tauMotor;
    r.jTauOut = g.tauOut;
    r.jTauGravity = g.tauGravity;
    r.jMotorRpm = g.motorRpm;
    r.jVoltage = g.voltage;
    r.jPElec = g.pElec;
    r.jPMech = g.pMech;
    r.jPCopper = g.pCopper;
    r.jEff = g.efficiency ?? -1;
    r.jTw = g.thermal.Tw;
    r.jLimitedI = g.currentLimited;
    r.jLimitedV = g.voltageLimited;
    r.jRatio = g.act.ratio;
    r.jEta = g.act.eta;
    r.jEtaBack = g.act.etaBack;
    r.jReflected = g.reflectedInertia;
    r.jLinkInertia = g.linkInertia;
    r.jPeakCurrent = g.act.peakCurrent;
    r.jKt = g.act.motor.kt;
  }

  dispose() {
    this.ik.dispose();
  }
}
