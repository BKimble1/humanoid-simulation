/**
 * The numbers the panels show, gathered from the world about ten times a second into the app
 * store (the interface never reads the simulation directly). Features and labs add their own
 * through `Feature.readouts`.
 */
import { JOINTS } from '../spec/body';
import { runtimeHours } from '../engine/battery';
import { useApp } from '../state/store';
import type { World } from './world';

export type Readouts = Record<string, number | string | boolean>;

export function publishReadouts(w: World) {
  const r: Readouts = {};
  const b = w.body;
  const e = w.energy;
  const s = e.summary;
  r.mass = w.model.robotMass;
  r.totalMass = w.model.totalMass;
  r.comX = b.com.x;
  r.comY = b.com.y;
  r.comZ = b.com.z;
  r.margin = b.margin;
  r.supportPts = b.support.length;
  r.loadL = b.grf?.L.load ?? 0;
  r.loadR = b.grf?.R.load ?? 0;
  r.grfL = b.grf ? b.grf.L.force.length() : 0;
  r.grfR = b.grf ? b.grf.R.force.length() : 0;
  // power
  r.batteryW = s.battery;
  r.batteryA = s.batteryCurrent;
  r.batteryV = s.batteryVoltage;
  r.soc = s.soc;
  r.jointsW = s.jointsElec;
  r.mechW = s.jointsMech;
  r.copperW = s.copper;
  r.regenW = s.regenerated;
  r.lvW = s.lv;
  r.standbyW = s.driveStandby;
  r.runtimeH = runtimeHours(w.model.pack, Math.max(60, e.avgPower));
  r.packC = e.pack.tempC;
  r.computeC = e.computeT;
  const hot = e.hottest();
  r.hottestJoint = hot.joint >= 0 ? JOINTS[hot.joint].label : '';
  r.hottestC = hot.Tw;
  r.derating = hot.derating;
  // selected actuator (Explore → Actuators): the walking duty cycle through its model
  const a = w.actuatorLive;
  if (a.op) {
    const op = a.op;
    const cfg = w.model.actuators[a.joint]!;
    r.actJoint = JOINTS[a.joint].label;
    r.ratio = cfg.ratio;
    r.reducer = cfg.reducer;
    r.motorRpm = (op.omegaMotor * 60) / (2 * Math.PI);
    r.outRpm = (op.omegaOut * 60) / (2 * Math.PI);
    r.outDegS = (op.omegaOut * 180) / Math.PI;
    r.tauOut = op.tauOut;
    r.tauMotor = op.tauMotor;
    r.current = op.current;
    r.voltage = op.voltage;
    r.pElec = op.pElec;
    r.pMech = op.pMech;
    r.pLoss = op.pCopper + op.pFriction;
    r.efficiency = Math.abs(op.pElec) > 1 && !op.regenerating ? Math.max(0, op.pMech / op.pElec) : -1;
    r.regenerating = op.regenerating;
    r.limited = op.currentLimited || op.voltageLimited;
    r.actTemp = a.temperature;
    r.slow = 8;
  }
  for (const f of w.features) f.readouts?.(r, w);
  useApp.setState({ readouts: r });
}
