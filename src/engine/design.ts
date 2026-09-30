/**
 * Engineer mode's analysis of a configuration: masses and centre of mass, joint torques and
 * speeds in six tasks against each actuator's limits, walking energy and runtime, heat, and a
 * list of the limits the design breaks, with what would fix them.
 *
 * Tasks
 *   stand       quiet standing, knees slightly bent                          (statics)
 *   carry       standing, payload held at hip height in both hands           (statics)
 *   squat       deep squat reaching the payload at knee height               (statics)
 *   single      standing on one leg                                          (statics)
 *   stepUp      one leg lifting the whole robot onto an 18 cm step, knee 70° (statics ×1.15)
 *   walk        1.0 m/s on the treadmill; with a payload, 0.5 m/s carrying it (dynamics, 2 s)
 */
import { Quaternion, Vector2, Vector3 } from 'three';
import { WINDING } from '../spec/actuators';
import { DIM, JOINTS } from '../spec/body';
import { GAITS, GRAVITY, LOCOMOTION, PAYLOAD } from '../spec/motion';
import { torqueAvailable } from './actuator';
import { convexHull, footPolygon, signedDistance } from './balance';
import { runtimeHours } from './battery';
import { GaitGenerator } from './gait';
import { MotionDynamics, flatContact } from './motionDynamics';
import { BodyEnergy, ankleCapability } from './power';
import { RobotModel, memberReport, type RobotConfig } from './robot';
import { DEG, Kinematics, NJ, Pose } from './skeleton';
import { carryArms, flatFoot, poseFromGait, solvePosture } from './wholebody';

export type TaskId = 'stand' | 'carry' | 'squat' | 'single' | 'stepUp' | 'walk';

export const TASK_LABEL: Record<TaskId, string> = {
  stand: 'Standing',
  carry: 'Carrying the payload',
  squat: 'Squat and lift',
  single: 'One-leg stance',
  stepUp: 'Step up 18 cm',
  walk: 'Walking',
};

/** A task's name for a configuration (walking is slower with a payload). */
export function taskLabel(id: TaskId, config: RobotConfig): string {
  if (id !== 'walk') return TASK_LABEL[id];
  return config.payload > 0 ? `Walking ${GAITS.slow.speed} m/s with the payload` : `Walking ${GAITS.normal.speed} m/s`;
}

export interface JointLoad {
  /** Peak |torque| and RMS torque in the task, Nm. */
  peak: number;
  rms: number;
  /** Peak |speed|, rad/s. */
  speed: number;
}

export interface TaskResult {
  id: TaskId;
  loads: JointLoad[];
  /** COM margin to the support polygon edge (static tasks), m. */
  margin: number;
  pose: Pose;
}

export interface JointCheck {
  joint: number;
  label: string;
  task: TaskId;
  /** Required torque (peak) and the actuator's peak at that speed. */
  required: number;
  available: number;
  /** Required RMS (sustained) and the continuous rating. */
  sustained: number;
  continuous: number;
  peakRatio: number;
  contRatio: number;
}

export interface Finding {
  severity: 'limit' | 'warning' | 'note';
  title: string;
  detail: string;
  remedies: string[];
  /** Joints the finding is about (highlighted on the model). */
  joints: number[];
}

export interface DesignReport {
  config: RobotConfig;
  robotMass: number;
  totalMass: number;
  bySubsystem: Record<string, number>;
  comHeight: number;
  comHeightFraction: number;
  tasks: Record<TaskId, TaskResult>;
  checks: JointCheck[];
  /** Worst check per joint group for display. */
  worst: JointCheck[];
  walk: {
    power: number;
    mechanicalPower: number;
    copper: number;
    costOfTransport: number;
    energyPerKm: number;
    standingPower: number;
    hottestJoint: string;
    hottestSteadyC: number;
  };
  runtime: { walking: number; standing: number; mixed: number };
  battery: { energyWh: number; mass: number; voltage: number; maxV: number; elv: boolean };
  reach: { arm: number; legLength: number; stepMax: number };
  stability: { carryMargin: number; standMargin: number };
  members: ReturnType<typeof memberReport>;
  kneeActuator: ReturnType<RobotModel['actuatorRatings']['at']> & object;
  findings: Finding[];
}

const Y = new Vector3(0, 1, 0);

function staticTask(model: RobotModel, kin: Kinematics, id: TaskId, pose: Pose, feet: ('L' | 'R')[], payloadPos: Vector3 | null, factor = 1): TaskResult {
  const md = new MotionDynamics(model);
  const contacts = feet.map((s) => {
    const a = kin.update(pose).point(`${s}_foot`, [0, 0, 0]);
    return flatContact(s, a, 0);
  });
  const r = md.update(pose, 0.01, contacts, payloadPos);
  const loads = JOINTS.map((_, i) => ({ peak: Math.abs(r.tau[i]) * factor, rms: Math.abs(r.tau[i]) * factor, speed: 0 }));
  const poly = convexHull(contacts.flatMap((c) => c.polygon));
  const margin = signedDistance(poly, new Vector2(r.com.x, r.com.z));
  return { id, loads, margin, pose: pose.clone() };
}

export function analyzeDesign(config: RobotConfig): DesignReport {
  const model = new RobotModel(config);
  const kin = new Kinematics(config.scale);
  const hw = DIM.hipHalfWidth;
  const legLen = DIM.thigh * config.scale.thigh + DIM.shin * config.scale.shin;
  const standH = legLen * Math.cos(12 * DEG) + DIM.ankleHeight - 0.004;
  const feet = { L: flatFoot(hw, 0), R: flatFoot(-hw, 0) };
  const comMid = new Vector2(0, 0.035);

  // stand
  const standPose = new Pose();
  solvePosture(model, kin, standPose, { com: comMid, pelvisHeight: standH, feet, upper: { L_elbow: 14, R_elbow: 14, L_shoulder_roll: 7, R_shoulder_roll: 7 } });
  const noPayload = new RobotModel({ ...config, payload: 0 });
  const stand = staticTask(noPayload, kin, 'stand', standPose, ['L', 'R'], null);

  // carry: payload between the palms
  const carryPose = new Pose();
  let payloadPos = new Vector3(0, standH + PAYLOAD.carryHeight, PAYLOAD.carryReach);
  for (let i = 0; i < 3; i++) {
    const res = solvePosture(model, kin, carryPose, { com: comMid, pelvisHeight: standH, pelvisPitch: -2 * DEG, feet, upper: carryArms(), payloadPos });
    kin.update(res.pose);
    payloadPos = kin.palm('L').add(kin.palm('R')).multiplyScalar(0.5);
  }
  const carry = staticTask(model, kin, 'carry', carryPose, ['L', 'R'], config.payload > 0 ? payloadPos : null);

  // squat: thighs near horizontal, torso forward, payload at knee height
  const squatPose = new Pose();
  const squatH = DIM.ankleHeight + legLen * 0.56;
  let squatPay = new Vector3(0, 0.45, 0.3);
  for (let i = 0; i < 3; i++) {
    const res = solvePosture(model, kin, squatPose, {
      com: comMid,
      pelvisHeight: squatH,
      pelvisPitch: 38 * DEG,
      feet,
      upper: { L_shoulder_pitch: 55, R_shoulder_pitch: 55, L_elbow: 30, R_elbow: 30, L_shoulder_roll: 12, R_shoulder_roll: 12, L_arm_yaw: 10, R_arm_yaw: 10 },
      payloadPos: squatPay,
    });
    kin.update(res.pose);
    squatPay = kin.palm('L').add(kin.palm('R')).multiplyScalar(0.5);
  }
  const squat = staticTask(model, kin, 'squat', squatPose, ['L', 'R'], config.payload > 0 ? squatPay : null);

  // single-leg stance on the left foot, right foot lifted 10 cm
  const singlePose = new Pose();
  const liftR = { ankle: new Vector3(-hw - 0.02, DIM.ankleHeight + 0.1, 0.05), quat: new Quaternion() };
  // the torso leans a little over the stance leg, as people do, to unload the hip roll
  solvePosture(noPayload, kin, singlePose, { com: new Vector2(hw, 0.04), pelvisHeight: standH, pelvisRoll: -5 * DEG, feet: { L: feet.L, R: liftR } });
  const single = staticTask(noPayload, kin, 'single', singlePose, ['L'], null);

  // step-up: left foot on an 18 cm step ahead, knee ~70°, COM over it, pushing up (×1.15 dynamic)
  const stepPose = new Pose();
  const stepFoot = { ankle: new Vector3(hw, DIM.ankleHeight + 0.18, 0.32), quat: new Quaternion() };
  const behindR = { ankle: new Vector3(-hw, DIM.ankleHeight + 0.06, -0.12), quat: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.35) };
  solvePosture(model, kin, stepPose, { com: new Vector2(hw * 0.9, 0.36), pelvisHeight: 0.18 + DIM.ankleHeight + legLen * 0.8, pelvisPitch: 12 * DEG, feet: { L: stepFoot, R: behindR }, upper: config.payload > 0 ? carryArms() : undefined, payloadPos: config.payload > 0 ? payloadPos.clone().add(new Vector3(0, 0.1, 0.32)) : undefined });
  kin.update(stepPose);
  const stepUp = staticTask(model, kin, 'stepUp', stepPose, ['L'], config.payload > 0 ? kin.palm('L').add(kin.palm('R')).multiplyScalar(0.5) : null, 1.15);

  // walking (dynamics), carrying the payload if any
  const gen = new GaitGenerator(undefined, LOCOMOTION.comHeight - 0.015);
  const md = new MotionDynamics(model);
  const energy = new BodyEnergy(model);
  const walkPose = new Pose();
  const loads: JointLoad[] = JOINTS.map(() => ({ peak: 0, rms: 0, speed: 0 }));
  const sumSq = new Float64Array(NJ);
  // carrying, FO-H1 walks at its slow gait (as people do with a heavy load)
  const walkGait = config.payload > 0 ? GAITS.slow : GAITS.normal;
  gen.walk(walkGait);
  let samples = 0;
  let pWalk = 0;
  let pMech = 0;
  let pCu = 0;
  const carrying = config.payload > 0;
  for (let i = 0; i < 480; i++) {
    gen.tick();
    const f = gen.frame;
    const res = poseFromGait(model, kin, walkPose, f, { carry: carrying });
    kin.update(res.pose);
    const pay = carrying ? kin.palm('L').add(kin.palm('R')).multiplyScalar(0.5) : null;
    const contacts = (['L', 'R'] as const).map((s) => ({
      side: s,
      ankle: f.feet[s].ankle.clone(),
      polygon: f.feet[s].contact === 'air' ? [] : footPolygon(f.feet[s].step.x, f.feet[s].step.z, f.feet[s].step.yaw),
    }));
    const r = md.update(res.pose, gen.dt, contacts, pay);
    if (i < 280) continue; // settle into the gait
    samples++;
    for (let j = 0; j < NJ; j++) {
      const t = Math.abs(r.tau[j]);
      loads[j].peak = Math.max(loads[j].peak, t);
      loads[j].speed = Math.max(loads[j].speed, Math.abs(r.qd[j]));
      sumSq[j] += r.tau[j] * r.tau[j];
    }
    energy.step(gen.dt, r.tau, r.qd);
    pWalk += energy.summary.battery;
    pMech += Math.max(0, energy.summary.jointsMech);
    pCu += energy.summary.copper;
  }
  for (let j = 0; j < NJ; j++) loads[j].rms = Math.sqrt(sumSq[j] / Math.max(1, samples));
  pWalk /= samples;
  pMech /= samples;
  pCu /= samples;
  const walk: TaskResult = { id: 'walk', loads, margin: 0, pose: walkPose.clone() };

  // standing power
  const standEnergy = new BodyEnergy(noPayload);
  const q0 = new Float64Array(NJ);
  const t0 = Float64Array.from(stand.loads.map((l, i) => l.peak * Math.sign(1) * (i >= 0 ? 1 : 1)));
  standEnergy.step(1, t0, q0);
  const standingPower = standEnergy.summary.battery;

  const tasks: Record<TaskId, TaskResult> = { stand, carry, squat, single, stepUp, walk };

  // checks against every actuator
  const checks: JointCheck[] = [];
  const ankle = ankleCapability(model.pack.nominalV);
  for (let j = 0; j < NJ; j++) {
    const act = model.actuators[j];
    const rt = model.actuatorRatings[j];
    for (const id of Object.keys(tasks) as TaskId[]) {
      const l = tasks[id].loads[j];
      if (l.peak < 0.5) continue;
      let available: number;
      let continuous: number;
      if (act && rt) {
        available = torqueAvailable(act, l.speed, 90);
        continuous = rt.continuousTorque;
      } else {
        const isPitch = JOINTS[j].id.endsWith('pitch');
        available = isPitch ? ankle.pitchTorque : ankle.rollTorque;
        continuous = isPitch ? ankle.pitchContinuous : ankle.rollContinuous;
      }
      // brief efforts (a step up, a squat-lift) only need peak torque; held postures and
      // walking need it continuously
      const brief = id === 'stepUp' || id === 'squat';
      const sustained = id === 'walk' ? l.rms : brief ? 0 : l.peak;
      checks.push({
        joint: j,
        label: JOINTS[j].label,
        task: id,
        required: l.peak,
        available,
        sustained,
        continuous,
        peakRatio: l.peak / Math.max(1e-6, available),
        contRatio: sustained / Math.max(1e-6, continuous),
      });
    }
  }
  const worstByJoint = new Map<number, JointCheck>();
  for (const c of checks) {
    const w = worstByJoint.get(c.joint);
    const score = Math.max(c.peakRatio, c.contRatio);
    if (!w || score > Math.max(w.peakRatio, w.contRatio)) worstByJoint.set(c.joint, c);
  }
  const worst = [...worstByJoint.values()].sort((a, b) => Math.max(b.peakRatio, b.contRatio) - Math.max(a.peakRatio, a.contRatio));

  // COM
  kin.update(standPose);
  const comStand = noPayload.com(kin);
  const standPoly = convexHull([...footPolygon(hw, 0), ...footPolygon(-hw, 0)]);
  kin.update(carryPose);
  const comCarry = model.com(kin, payloadPos);

  const pack = model.pack;
  const mixedPower = 0.5 * pWalk + 0.5 * standingPower;
  const runtime = { walking: runtimeHours(pack, pWalk), standing: runtimeHours(pack, standingPower), mixed: runtimeHours(pack, mixedPower) };
  const speed = walkGait.speed;
  const cot = pWalk / (model.totalMass * GRAVITY * speed);

  // steady-state winding temperature for walking duty, from RMS current
  let hottest = { joint: -1, T: 0 };
  for (let j = 0; j < NJ; j++) {
    const act = model.actuators[j];
    if (!act) continue;
    const I = loads[j].rms / (act.ratio * act.eta * act.motor.kt);
    // T = Ta + I²·R20·(1 + α(T − 20))·Rth, solved for T; when I²R20·α·Rth ≥ 1 there is no
    // steady state (resistance rises faster than the heat can leave): thermal runaway
    const k = I * I * act.motor.r20 * (act.motor.rwh + act.motor.rha);
    const den = 1 - k * WINDING.alphaCu;
    const T = den > 0.02 ? (32 + k * (1 - 20 * WINDING.alphaCu)) / den : 999;
    if (T > hottest.T) hottest = { joint: j, T };
  }

  const findings = buildFindings(model, worst, { comCarry, standPoly, runtime, pack, hottest, config });

  return {
    config,
    robotMass: model.robotMass,
    totalMass: model.totalMass,
    bySubsystem: model.bySubsystem(),
    comHeight: comStand.y,
    comHeightFraction: comStand.y / DIM.height,
    tasks,
    checks,
    worst,
    walk: {
      power: pWalk,
      mechanicalPower: pMech,
      copper: pCu,
      costOfTransport: cot,
      energyPerKm: (pWalk * (1000 / speed)) / 3600,
      standingPower,
      hottestJoint: hottest.joint >= 0 ? JOINTS[hottest.joint].label : '',
      hottestSteadyC: hottest.T,
    },
    runtime,
    battery: { energyWh: pack.energyWh, mass: pack.mass, voltage: pack.nominalV, maxV: pack.maxV, elv: pack.elv },
    reach: { arm: DIM.upperArm * config.scale.upperArm + DIM.forearm * config.scale.forearm + DIM.palm, legLength: legLen, stepMax: LOCOMOTION.maxStep * (legLen / (DIM.thigh + DIM.shin)) },
    stability: {
      carryMargin: signedDistance(standPoly, new Vector2(comCarry.x, comCarry.z)),
      standMargin: signedDistance(standPoly, new Vector2(comStand.x, comStand.z)),
    },
    members: memberReport(config),
    kneeActuator: model.actuatorRatings[JOINTS.findIndex((j) => j.id === 'L_knee')]!,
    findings,
  };
}

function groupLabel(label: string) {
  return label.toUpperCase();
}

function buildFindings(
  model: RobotModel,
  worst: JointCheck[],
  ctx: { comCarry: Vector3; standPoly: ReturnType<typeof convexHull>; runtime: { walking: number; mixed: number }; pack: RobotModel['pack']; hottest: { joint: number; T: number }; config: RobotConfig },
): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const c of worst) {
    const key = c.label;
    if (seen.has(key)) continue;
    const task = taskLabel(c.task, model.config).toLowerCase();
    if (c.peakRatio > 1) {
      seen.add(key);
      out.push({
        severity: 'limit',
        title: `${groupLabel(c.label)} ACTUATOR LIMIT`,
        detail: `${task}: needs ${c.required.toFixed(0)} Nm, the actuator can give ${c.available.toFixed(0)} Nm at that speed (${Math.round(c.peakRatio * 100)} %).`,
        remedies: remediesFor(c, model),
        joints: JOINTS.map((j, i) => (j.label === c.label ? i : -1)).filter((i) => i >= 0),
      });
    } else if (c.contRatio > 1) {
      seen.add(key);
      out.push({
        severity: 'limit',
        title: `${groupLabel(c.label)} THERMAL LIMIT`,
        detail: `${task}: sustains ${c.sustained.toFixed(0)} Nm; the actuator's continuous (thermal) rating is ${c.continuous.toFixed(0)} Nm. It would overheat and derate.`,
        remedies: remediesFor(c, model, true),
        joints: JOINTS.map((j, i) => (j.label === c.label ? i : -1)).filter((i) => i >= 0),
      });
    } else if (Math.max(c.peakRatio, c.contRatio) > 0.85) {
      seen.add(key);
      out.push({
        severity: 'warning',
        title: `${c.label}: little margin`,
        detail: `${task} uses ${Math.round(Math.max(c.peakRatio, c.contRatio) * 100)} % of its ${c.contRatio > c.peakRatio ? 'continuous' : 'peak'} rating.`,
        remedies: [],
        joints: JOINTS.map((j, i) => (j.label === c.label ? i : -1)).filter((i) => i >= 0),
      });
    }
  }
  const carryMargin = signedDistance(ctx.standPoly, new Vector2(ctx.comCarry.x, ctx.comCarry.z));
  if (carryMargin < 0.03)
    out.push({
      severity: carryMargin < 0 ? 'limit' : 'warning',
      title: carryMargin < 0 ? 'STABILITY LIMIT' : 'Stability margin small',
      detail: `Carrying ${ctx.config.payload} kg puts the centre of mass ${Math.abs(carryMargin * 100).toFixed(1)} cm ${carryMargin < 0 ? 'outside' : 'inside'} the edge of the feet.`,
      remedies: ['Hold the payload closer to the body', 'Lean the torso back (the controller does this within limits)', 'Widen or lengthen the feet'],
      joints: [],
    });
  if (!ctx.pack.elv)
    out.push({
      severity: 'note',
      title: 'Battery above 60 V',
      detail: `${ctx.pack.series} cells in series charge to ${ctx.pack.maxV.toFixed(1)} V: beyond extra-low voltage. Motors gain top speed, but insulation, connectors and service rules get stricter.`,
      remedies: ['Keep 14 cells in series to stay under 60 V'],
      joints: [],
    });
  if (ctx.runtime.mixed < 2)
    out.push({
      severity: 'warning',
      title: 'Short runtime',
      detail: `About ${ctx.runtime.mixed.toFixed(1)} h of mixed work on a charge.`,
      remedies: ['More cells in parallel (adds mass)', 'Lighter structure', 'Less payload'],
      joints: [],
    });
  if (ctx.hottest.T > WINDING.derateStart)
    out.push({
      severity: 'warning',
      title: 'Hot actuator when walking',
      detail: `${JOINTS[ctx.hottest.joint].label} windings settle near ${ctx.hottest.T.toFixed(0)} °C in continuous walking; derating starts at ${WINDING.derateStart} °C.`,
      remedies: ['Larger motor (longer stack)', 'Higher gear ratio (less current per Nm)', 'Rest periods'],
      joints: [ctx.hottest.joint],
    });
  for (const m of memberReport(ctx.config))
    if (m.result.safetyFactor < 1.5)
      out.push({
        severity: m.result.safetyFactor < 1 ? 'limit' : 'warning',
        title: m.result.safetyFactor < 1 ? 'STRUCTURAL LIMIT' : 'Low structural margin',
        detail: `${m.spec.label} in ${m.result.material.label}: ${m.result.stress.toFixed(0)} MPa under the design load, safety factor ${m.result.safetyFactor.toFixed(2)}.`,
        remedies: ['A stronger material', 'A larger or thicker tube'],
        joints: [],
      });
  return out;
}

function remediesFor(c: JointCheck, model: RobotModel, thermal = false): string[] {
  const j = JOINTS[c.joint];
  const r: string[] = [];
  if (j.actuator === 'A100') {
    r.push(thermal ? 'Longer motor stack (more torque per amp, more heat capacity)' : 'Larger actuator or longer motor stack');
    r.push(thermal ? 'Higher gear ratio: less current for the same torque (slower joint)' : 'Higher gear ratio (trades top speed)');
  } else r.push('Larger actuator for this joint');
  if (model.config.payload > 0) r.push('Reduce the payload');
  r.push(c.task === 'squat' || c.task === 'stepUp' ? 'Different motion: shallower squat, lift closer to the body' : 'Slower or shorter motion profile');
  return r;
}

export { Y };
