/**
 * Manipulation lab: FO-H1 at the cart, picking things up.
 *
 * The hand path is a sequence of waypoints (pre-grasp, grasp, lift, place) joined by quintic
 * moves; each frame the arm IK (position and palm orientation) follows it, the posture solver
 * keeps the whole-body COM over the feet (the torso leans in to reach the tray and straightens
 * with the load), and the grasp simulation (engine/grasp.ts: friction, tactile shear and
 * vibration, slip detection, grip adaptation) decides whether the object stays in the hand.
 * The object is drawn where the simulation puts it: in the hand, sliding in it, or dropped.
 */
import { Quaternion, Vector2, Vector3 } from 'three';
import { DIM, type JointId, type Side } from '../../spec/body';
import { GRAVITY } from '../../spec/motion';
import { GraspSim, OBJECTS } from '../../engine/grasp';
import { solveArm } from '../../engine/ik';
import type { RobotModel } from '../../engine/robot';
import { DEG, Kinematics, Pose } from '../../engine/skeleton';
import { flatFoot, solvePosture } from '../../engine/wholebody';
import { handPoses } from '../../scene/robot/hand';
import { CART, ITEMS, SHELF_SPOT, type ItemId } from '../cart';
import type { FootPose, Held, PoseSource } from '../pose';

export type ManipTask = 'box' | 'vial' | 'tool' | 'cup' | 'wet' | 'shelf';
type Stage = 'rest' | 'reach' | 'approach' | 'close' | 'lift' | 'hold' | 'place' | 'release' | 'retract' | 'dropped';

const DUR: Partial<Record<Stage, number>> = { reach: 1.5, approach: 0.7, close: 0.6, lift: 1.3, place: 1.5, release: 0.5, retract: 1.4 };
const quintic = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** Palm orientation for a side grasp: fingers forward and a little down, thumb up. */
const GRASP_QUAT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -68 * DEG);

const REST_ARM: Partial<Record<JointId, number>> = { L_shoulder_pitch: 5, R_shoulder_pitch: 5, L_shoulder_roll: 7, R_shoulder_roll: 7, L_arm_yaw: -8, R_arm_yaw: -8, L_elbow: 16, R_elbow: 16, L_wrist_yaw: 0, R_wrist_yaw: 0, L_wrist_pitch: 0, R_wrist_pitch: 0, L_wrist_roll: 0, R_wrist_roll: 0, waist_yaw: 0 };

export class ManipSource implements PoseSource {
  id = 'manip';
  pose = new Pose();
  feet: Record<Side, FootPose>;
  held: Held | null = null;
  task: ManipTask = 'box';
  stage: Stage = 'rest';
  sim: GraspSim;
  /** Object centres (world) for the props. */
  objects: Record<ItemId, Vector3>;
  private kin: Kinematics;
  private stand: number;
  private st = 0;
  private t = 0;
  /** Hand targets per side along the path: from → to over the current stage. */
  private from: Record<Side, Vector3> = { L: new Vector3(), R: new Vector3() };
  private to: Record<Side, Vector3> = { L: new Vector3(), R: new Vector3() };
  private restHand: Record<Side, Vector3> = { L: new Vector3(), R: new Vector3() };
  private lean = 0;
  /** Extra mass poured into the beaker (kg) and the rate it is being poured at (kg/s). */
  poured = 0;
  private pourRate = 0;
  private jolt = 0;
  private fallV = 0;
  /** Grip forces for the overlay arrows (world points and vectors, N). */
  forces: { at: Vector3; force: Vector3 }[] = [];
  private queued: 'pick' | 'place' | null = null;

  constructor(
    private model: () => RobotModel,
    kin: Kinematics,
  ) {
    this.kin = kin;
    this.stand = DIM.ankleHeight + (DIM.thigh + DIM.shin) * Math.cos(12 * DEG) - 0.004;
    this.feet = { L: flatFoot(DIM.hipHalfWidth, 0), R: flatFoot(-DIM.hipHalfWidth, 0) };
    this.objects = Object.fromEntries(Object.values(ITEMS).map((i) => [i.id, i.rest.clone()])) as Record<ItemId, Vector3>;
    this.sim = this.makeSim();
  }

  get item() {
    return ITEMS[this.task === 'shelf' ? 'box' : this.task];
  }

  private makeSim(): GraspSim {
    const it = this.item;
    const o = OBJECTS[it.id];
    // the box is carried by two hands: each hand's grasp carries half of it
    const sim = new GraspSim(it.hands === 'both' ? { ...o, mass: o.mass / 2 } : o);
    return sim;
  }

  enter(from: Pose) {
    this.pose.copy(from);
    this.stage = 'rest';
  }

  setTask(t: ManipTask) {
    if (t === this.task) return;
    this.task = t;
    // put everything back where it belongs (the lab resets the cart between tasks)
    for (const i of Object.values(ITEMS)) this.objects[i.id].copy(i.rest);
    this.stage = 'rest';
    this.poured = 0;
    this.pourRate = 0;
    this.sim = this.makeSim();
  }

  /** Visitor actions. */
  pick() {
    if (this.stage === 'rest' || this.stage === 'dropped') {
      if (this.stage === 'dropped') this.reset();
      this.queued = 'pick';
    }
  }
  place() {
    if (this.stage === 'hold') this.queued = 'place';
  }
  pour() {
    if (this.task === 'cup' && this.stage === 'hold') this.pourRate = 0.12;
  }
  shake() {
    if (this.stage === 'hold') this.jolt = 0.3;
  }
  reset() {
    for (const i of Object.values(ITEMS)) this.objects[i.id].copy(i.rest);
    this.poured = 0;
    this.pourRate = 0;
    this.sim = this.makeSim();
    this.stage = 'rest';
  }

  private handsUsed(): Side[] {
    return this.item.hands === 'both' ? ['L', 'R'] : ['R'];
  }

  /** Grasp point of a hand on the object whose centre is c. */
  private graspPoint(side: Side, c: Vector3): Vector3 {
    const it = this.item;
    if (it.hands === 'both') {
      const s = side === 'L' ? 1 : -1;
      return c.clone().add(new Vector3(s * it.grip.x, it.grip.y, it.grip.z));
    }
    // right hand: palm against the object's right side (−X), a little behind its centre line
    const r = it.size.x / 2;
    return c.clone().add(new Vector3(-(r + 0.012), it.grip.y, it.grip.z - 0.005));
  }

  private setStage(s: Stage) {
    this.stage = s;
    this.st = 0;
    for (const side of ['L', 'R'] as Side[]) this.from[side].copy(this.to[side]);
    const it = this.item;
    const c = this.objects[it.id];
    for (const side of this.handsUsed()) {
      const g = this.graspPoint(side, c);
      // pre-grasp: back, up and out to the hand's side of the object
      const pre = g.clone().add(new Vector3(side === 'L' ? 0.05 : -0.05, 0.06, -0.08));
      const holdPt = g.clone().add(new Vector3(0, 0.1, -0.12));
      const dest = this.task === 'shelf' ? this.graspPoint(side, SHELF_SPOT) : this.graspPoint(side, it.rest);
      if (s === 'reach') this.to[side].copy(pre);
      else if (s === 'approach') this.to[side].copy(g);
      else if (s === 'lift') this.to[side].copy(holdPt);
      else if (s === 'place') this.to[side].copy(dest).add(new Vector3(0, 0.004, 0));
      else if (s === 'retract') this.to[side].copy(this.restHand[side]);
      else if (s === 'release') this.to[side].copy(this.from[side]).add(new Vector3(side === 'L' ? 0.015 : -0.015, 0, -0.01));
    }
  }

  update(dt: number) {
    this.t += dt;
    this.st += dt;
    const model = this.model();
    const it = this.item;
    const hands = this.handsUsed();
    const dur = DUR[this.stage] ?? 1;
    const u = quintic(this.st / dur);
    // stage transitions
    if (this.stage === 'rest' && this.queued === 'pick') {
      this.queued = null;
      this.setStage('reach');
    } else if (this.stage === 'reach' && this.st >= dur) this.setStage('approach');
    else if (this.stage === 'approach' && this.st >= dur) {
      this.setStage('close');
      this.sim.close();
    } else if (this.stage === 'close' && this.st >= dur && this.sim.phase === 'holding') this.setStage('lift');
    else if (this.stage === 'lift' && this.st >= dur) this.setStage('hold');
    else if (this.stage === 'hold' && this.queued === 'place') {
      this.queued = null;
      this.setStage('place');
    } else if (this.stage === 'place' && this.st >= dur) {
      this.setStage('release');
      this.sim.release();
    } else if (this.stage === 'release' && this.st >= dur) this.setStage('retract');
    else if (this.stage === 'retract' && this.st >= dur) this.stage = 'rest';

    // grasp physics: the hand's vertical acceleration while lifting, pours, jolts
    const moving = this.stage === 'lift' || this.stage === 'place';
    const d = DUR[this.stage] ?? 1;
    const x = Math.min(1, this.st / d);
    const accProfile = moving ? (60 * x - 180 * x * x + 120 * x * x * x) / (d * d) : 0; // d²/dt² of the quintic
    const dy = this.to.R.y - this.from.R.y;
    let jolt = 0;
    if (this.jolt > 0) {
      this.jolt -= dt;
      jolt = 7 * Math.sin((0.3 - this.jolt) * Math.PI * 2 * 3.3);
    }
    this.sim.handAcc = (hands.length ? accProfile * dy : 0) + jolt;
    if (this.pourRate > 0) {
      const add = Math.min(this.pourRate * dt, 0.3 - this.poured);
      this.poured += add;
      this.sim.mass += add;
      if (this.poured >= 0.3) this.pourRate = 0;
    }
    // the weight transfers from the tray to the hand over the first part of the lift, and back
    // to the tray (or shelf) at the end of the placing move
    const lifting = this.stage === 'lift' ? Math.min(1, this.st / 0.55) : this.stage === 'hold' ? 1 : this.stage === 'place' ? Math.min(1, (dur - this.st) / 0.3) : 0;
    this.sim.support = this.stage === 'close' ? 0 : Math.max(0, lifting);
    if (this.stage !== 'rest' && this.stage !== 'reach' && this.stage !== 'approach') this.sim.step(dt);
    if (this.sim.phase === 'dropped' && this.stage !== 'dropped' && this.stage !== 'retract' && this.stage !== 'rest') {
      this.stage = 'dropped';
      this.st = 0;
      this.fallV = 0;
      for (const side of ['L', 'R'] as Side[]) this.from[side].copy(this.to[side]);
      for (const side of hands) this.to[side].copy(this.restHand[side]);
    }

    // posture: lean in to reach the tray, straighten with the load held close
    const reachFrac = this.stage === 'reach' ? u : this.stage === 'approach' || this.stage === 'close' ? 1 : this.stage === 'lift' ? 1 - 0.7 * u : this.stage === 'hold' ? 0.3 : this.stage === 'place' ? 0.3 + 0.7 * u : this.stage === 'release' ? 1 : this.stage === 'retract' || this.stage === 'dropped' ? 1 - u : 0;
    const leanT = (this.task === 'shelf' && (this.stage === 'place' || this.stage === 'release') ? 6 : 14) * reachFrac;
    this.lean += (leanT - this.lean) * Math.min(1, dt * 4);
    const upper = { ...REST_ARM };
    const heldPos = this.stage === 'close' || this.stage === 'lift' || this.stage === 'hold' || this.stage === 'place' ? this.objects[it.id] : undefined;
    const heldMass = this.sim.mass * (it.hands === 'both' ? 2 : 1);
    solvePosture(model, this.kin, this.pose, { com: new Vector2(0, 0.045), pelvisHeight: this.stand - 0.012 * reachFrac, pelvisPitch: (1.5 + this.lean) * DEG, feet: this.feet, upper, iterations: 3, payloadPos: heldPos, });
    // where the hands rest (for the retract move)
    this.kin.update(this.pose);
    for (const side of ['L', 'R'] as Side[]) this.restHand[side].copy(this.kin.palm(side));
    if (this.stage === 'rest') for (const side of ['L', 'R'] as Side[]) this.to[side].copy(this.restHand[side]);
    // arms along the path
    if (this.stage !== 'rest') {
      for (const side of hands) {
        const target = this.from[side].clone().lerp(this.to[side], this.stage === 'close' || this.stage === 'hold' ? 1 : u);
        const w = this.stage === 'retract' || this.stage === 'dropped' ? 1 - u : 1;
        const q0 = Float64Array.from(this.pose.q);
        solveArm(this.pose, side, target, this.kin, { iterations: 22, orientation: GRASP_QUAT });
        if (w < 1) for (let i = 0; i < q0.length; i++) this.pose.q[i] = q0[i] + (this.pose.q[i] - q0[i]) * w;
      }
      if ((this.stage === 'retract' || this.stage === 'dropped') && u >= 1 && this.stage === 'retract') this.stage = 'rest';
    }
    // fingers
    const closing = this.stage === 'close' ? Math.min(1, this.st / 0.45) : this.stage === 'lift' || this.stage === 'hold' || this.stage === 'place' ? 1 : this.stage === 'release' ? 1 - Math.min(1, this.st / 0.35) : 0;
    for (const side of ['L', 'R'] as Side[]) {
      const hp = handPoses[side];
      const on = hands.includes(side) ? closing : 0;
      const c = it.closure * on;
      const open = 0.14;
      hp.fingers = it.pinch ? [open + (c - open) * 1, 0.62 * on + open * (1 - on), 0.7 * on + open * (1 - on), 0.72 * on + open * (1 - on)] : [open + (c - open) * on, open + (c - open) * on, open + (c + 0.04 - open) * on, open + (c + 0.06 - open) * on];
      hp.thumbFlex = 0.2 + 0.45 * on;
      hp.thumbOpp = 0.3 + 0.5 * on;
    }
    // the object: in the hand (plus any slip), falling, or resting
    this.kin.update(this.pose);
    const c = this.objects[it.id];
    const inHand = this.stage === 'lift' || this.stage === 'hold' || this.stage === 'place' || (this.stage === 'close' && this.sim.phase === 'holding');
    if (inHand) {
      const grasp = it.hands === 'both' ? this.kin.palm('L').add(this.kin.palm('R')).multiplyScalar(0.5) : this.kin.palm('R');
      const off = it.hands === 'both' ? new Vector3(0, -it.grip.y, -it.grip.z) : new Vector3(it.size.x / 2 + 0.012, -it.grip.y, -it.grip.z + 0.005);
      c.copy(grasp).add(off);
      c.y -= this.sim.slip;
      this.held = { pos: c.clone(), mass: heldMass, hands: it.hands === 'both' ? 'both' : 'R' };
    } else if (this.stage === 'dropped') {
      this.held = null;
      // falls onto the tray (or the floor if it is off the tray)
      const onTray = Math.abs(c.x - CART.pos.x) < CART.deckW / 2 && Math.abs(c.z - CART.pos.z) < CART.deckD / 2;
      const floor = (onTray ? CART.deckY : 0) + it.size.y / 2;
      if (c.y > floor) {
        this.fallV += GRAVITY * dt;
        c.y = Math.max(floor, c.y - this.fallV * dt);
      }
    } else this.held = null;
    // grip force arrows at the contacts
    this.forces = [];
    if (this.sim.normal > 0.2 && inHand) {
      for (const side of hands) {
        const tip = this.kin.palm(side);
        const inward = it.hands === 'both' ? new Vector3(side === 'L' ? -1 : 1, 0, 0) : new Vector3(1, 0, 0);
        this.forces.push({ at: tip.clone().addScaledVector(inward, -0.04), force: inward.clone().multiplyScalar(this.sim.normal) });
      }
      this.forces.push({ at: c.clone(), force: new Vector3(0, -heldMass * GRAVITY, 0) });
    }
    // head: look at the object
    const head = this.kin.point('neck', [0, DIM.neckLength, 0]);
    const dd = c.clone().sub(head);
    this.pose.set('neck_yaw', Math.max(-0.9, Math.min(0.9, Math.atan2(dd.x, dd.z))) * 0.8);
    this.pose.set('neck_pitch', Math.max(-0.4, Math.min(0.6, -Math.atan2(dd.y, Math.hypot(dd.x, dd.z)) - this.lean * DEG * 0.8)));
  }

  readouts(r: Record<string, number | string | boolean>) {
    const s = this.sim;
    r.mStage = this.stage;
    r.mPhase = s.phase;
    r.mNormal = s.normal;
    r.mShear = s.shear;
    r.mLoad = s.load;
    r.mRequired = s.holdingNormal;
    r.mRequiredNow = s.minimumNormal;
    r.mMuHat = s.muHat;
    r.mMu = s.mu;
    r.mSlip = s.slip * 1000;
    r.mVibration = s.vibration;
    r.mDetections = s.detections;
    r.mSlipDetected = s.slipDetected;
    r.mCrushed = s.crushed;
    r.mMass = s.mass * (this.item.hands === 'both' ? 2 : 1);
    r.mPoured = this.poured;
    r.mBeyond = s.beyondLimit;
    r.mHands = this.item.hands;
  }
}
