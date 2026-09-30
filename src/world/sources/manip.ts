/**
 * Manipulation lab: FO-H1 at the cart, picking things up.
 *
 * A pick is a sequence of stages — reach to a pre-grasp point with the wrist turning to the
 * grasp orientation, approach, close the fingers until they touch and grip, lift while the
 * weight transfers from the tray to the hand, hold, place, release, retract. Each stage is a
 * quintic move of the palm (position and orientation) from where the hand actually is when
 * the stage begins; each frame the arm IK follows it, the posture solver keeps the whole-body
 * COM over the feet (the torso leans in to reach the tray and straightens with the load), and
 * the grasp simulation (engine/grasp.ts: friction, tactile shear and vibration, slip
 * detection, grip adaptation) decides whether the object stays in the hand.
 *
 * Stage changes are exact: time past a stage's end carries into the next one (several in one
 * frame if the frame is long), and the pose of the frame is sampled from the stage it ends in.
 * The object is attached with the offset it has from the hand at the moment the grip closes,
 * so it never jumps when it is picked up; slip moves it down the grasp (drawn magnified, as
 * the panel says). Asked to leave, the source first finishes or undoes what it is doing: an
 * object in the hand is put back, a grasp not yet closed is abandoned and the hand withdrawn.
 */
import { Quaternion, Vector2, Vector3 } from 'three';
import { DIM, type JointId, type Side } from '../../spec/body';
import { GRAVITY } from '../../spec/motion';
import { GraspSim, OBJECTS } from '../../engine/grasp';
import { ARM_JOINTS, solveArm } from '../../engine/ik';
import type { RobotModel } from '../../engine/robot';
import { DEG, JOINT_INDEX, Kinematics, Pose } from '../../engine/skeleton';
import { solvePosture, standHeight } from '../../engine/wholebody';
import { CART, ITEMS, SHELF_SPOT, type ItemId } from '../cart';
import { bothHands, relax } from '../handPose';
import type { DisplayState, FootPose, Held, PoseSource } from '../pose';
import { StanceKeeper, homeStance, newFeet } from '../stance';

export type ManipTask = 'box' | 'vial' | 'tool' | 'cup' | 'wet' | 'shelf';
export type Stage = 'rest' | 'reach' | 'approach' | 'close' | 'lift' | 'hold' | 'place' | 'release' | 'retract' | 'dropped';

export const STAGE_DUR: Partial<Record<Stage, number>> = { reach: 1.5, approach: 0.8, close: 0.75, lift: 1.3, place: 1.5, release: 0.65, retract: 1.4, dropped: 1.2 };
/** The fingers close in, and open in (s): about what a six-motor hand of this size manages. */
const CLOSE_T = 0.6;
const OPEN_T = 0.55;
const quintic = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** Palm orientation for a side grasp: fingers forward and a little down, thumb up. */
const GRASP_QUAT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -68 * DEG);
const ARM_IDX: Record<Side, number[]> = { L: ARM_JOINTS('L').map((id) => JOINT_INDEX[id]), R: ARM_JOINTS('R').map((id) => JOINT_INDEX[id]) };

/** How much the slip is magnified in the drawing (it is millimetres). */
export const SLIP_SHOWN = 4;

const REST_ARM: Partial<Record<JointId, number>> = { L_shoulder_pitch: 5, R_shoulder_pitch: 5, L_shoulder_roll: 7, R_shoulder_roll: 7, L_arm_yaw: -8, R_arm_yaw: -8, L_elbow: 16, R_elbow: 16, L_wrist_yaw: 0, R_wrist_yaw: 0, L_wrist_pitch: 0, R_wrist_pitch: 0, L_wrist_roll: 0, R_wrist_roll: 0, waist_yaw: 0 };

export class ManipSource implements PoseSource {
  id = 'manip';
  pose = new Pose();
  feet: Record<Side, FootPose> = newFeet();
  hands = bothHands();
  held: Held | null = null;
  task: ManipTask = 'box';
  stage: Stage = 'rest';
  sim: GraspSim;
  /** Object centres (world) for the props. */
  objects: Record<ItemId, Vector3>;
  /** An object is off its resting place (moved, dropped): put back when out of view. */
  disturbed = false;
  private kin: Kinematics;
  private stand: number;
  private st = 0;
  private t = 0;
  /** Palm path per side over the current stage: position and orientation, from → to. */
  private from: Record<Side, Vector3> = { L: new Vector3(), R: new Vector3() };
  private to: Record<Side, Vector3> = { L: new Vector3(), R: new Vector3() };
  private fromQ: Record<Side, Quaternion> = { L: new Quaternion(), R: new Quaternion() };
  private toQ: Record<Side, Quaternion> = { L: new Quaternion(), R: new Quaternion() };
  /** Where each palm is, and how it is turned, in the last solved pose. */
  private palmNow: Record<Side, Vector3> = { L: new Vector3(), R: new Vector3() };
  private palmQ: Record<Side, Quaternion> = { L: new Quaternion(), R: new Quaternion() };
  private restHand: Record<Side, Vector3> = { L: new Vector3(), R: new Vector3() };
  private restQ: Record<Side, Quaternion> = { L: new Quaternion(), R: new Quaternion() };
  /** Offset of the object's centre from the grasp point, taken when the grip closes. */
  private graspOffset = new Vector3();
  private attached = false;
  private lean = 0;
  /** Extra mass poured into the beaker (kg) and the rate it is being poured at (kg/s). */
  poured = 0;
  private pourRate = 0;
  private jolt = 0;
  private fallV = 0;
  /** Grip forces for the overlay arrows (world points and vectors, N). */
  forces: { at: Vector3; force: Vector3 }[] = [];
  private queued: 'pick' | 'place' | null = null;
  private stance = new StanceKeeper();
  private leaving = false;
  private scratch = new Pose();
  /** Each arm's last solution (joint angles), where the next frame's IK starts: a warm start
   * follows the moving target smoothly, where a cold start from the resting arm would converge
   * a little differently every frame (a visible chatter at the elbow). */
  private warm: Record<Side, number[] | null> = { L: null, R: null };

  constructor(
    private model: () => RobotModel,
    kin: Kinematics,
  ) {
    this.kin = kin;
    this.stand = standHeight(kin);
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
    return new GraspSim(it.hands === 'both' ? { ...o, mass: o.mass / 2 } : o);
  }

  enter(from: DisplayState) {
    this.pose.copy(from.pose);
    this.leaving = false;
    this.warm = { L: null, R: null };
    this.kin.update(from.pose);
    const com = this.model().com(this.kin);
    this.stance.begin(from.feet, homeStance(), new Vector2(com.x, com.z));
    for (const s of ['L', 'R'] as Side[]) {
      this.kin.point(`${s}_hand`, PALM, this.palmNow[s]);
      this.palmQ[s].setFromRotationMatrix(this.kin.frames.get(`${s}_hand`)!);
    }
    if (this.stage !== 'rest' && this.stage !== 'dropped') this.stage = 'rest';
    this.neck = { yaw: from.pose.get('neck_yaw'), pitch: from.pose.get('neck_pitch'), vy: 0, vp: 0, init: true };
  }

  release() {
    this.leaving = true;
    if (this.queued !== 'pick') this.queued = null;
    // finish or undo: in the hand → put it back; reaching → withdraw
    if (this.stage === 'reach' || this.stage === 'approach') this.setStage('retract');
    else if (this.stage === 'close') this.setStage('release');
    else if (this.stage === 'hold') this.setStage('place');
  }

  resume() {
    this.leaving = false;
  }

  releasable(): boolean {
    return (this.stage === 'rest' || (this.stage === 'dropped' && this.st >= (STAGE_DUR.dropped ?? 1))) && !this.stance.lifted;
  }

  setTask(t: ManipTask) {
    if (t === this.task) return;
    this.task = t;
    this.putBack();
  }

  /** Everything back on the cart (the lab resets the cart between tasks). */
  putBack() {
    for (const i of Object.values(ITEMS)) this.objects[i.id].copy(i.rest);
    this.poured = 0;
    this.pourRate = 0;
    this.sim = this.makeSim();
    this.attached = false;
    this.disturbed = false;
    this.queued = null;
    this.stage = 'rest';
  }

  /** Visitor actions. A pick asked for while the hand is still busy starts when it is free. */
  pick() {
    if (this.stage === 'dropped') this.putBack();
    if (this.stage === 'rest' || this.leaving) this.queued = 'pick';
  }
  /** Put down: now if holding, or as soon as the object is held. */
  place() {
    if (this.stage === 'reach' || this.stage === 'approach' || this.stage === 'close' || this.stage === 'lift' || this.stage === 'hold') this.queued = 'place';
  }

  /** Start over (a tour chapter replayed): whatever is in progress is finished or undone first. */
  restart() {
    if (this.stage === 'rest') {
      this.queued = null;
      return;
    }
    if (this.stage === 'dropped') return this.putBack();
    this.release();
    this.restarting = true;
  }
  private restarting = false;
  pour() {
    if (this.task === 'cup' && this.stage === 'hold') this.pourRate = 0.12;
  }
  shake() {
    if (this.stage === 'hold') this.jolt = 0.3;
  }
  reset() {
    this.putBack();
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

  /** The grasp reference of the hands of a pose: the right palm, or midway between both. */
  private graspRef(kin: Kinematics, out = new Vector3()): Vector3 {
    if (this.item.hands === 'both') return kin.point('L_hand', PALM, out).add(kin.point('R_hand', PALM, _t)).multiplyScalar(0.5);
    return kin.point('R_hand', PALM, out);
  }

  private graspRefNow(out = new Vector3()): Vector3 {
    if (this.item.hands === 'both') return out.copy(this.palmNow.L).add(this.palmNow.R).multiplyScalar(0.5);
    return out.copy(this.palmNow.R);
  }

  /** Begin a stage: its moves start from the hands as they are now. */
  private setStage(s: Stage) {
    this.stage = s;
    this.st = 0;
    const it = this.item;
    const c = this.objects[it.id];
    for (const side of ['L', 'R'] as Side[]) {
      this.from[side].copy(this.palmNow[side]);
      this.fromQ[side].copy(this.palmQ[side]);
      this.to[side].copy(this.palmNow[side]);
      this.toQ[side].copy(GRASP_QUAT);
    }
    const used = this.handsUsed();
    for (const side of used) {
      const g = this.graspPoint(side, c);
      // pre-grasp: back, up and out to the hand's side of the object
      const pre = g.clone().add(new Vector3(side === 'L' ? 0.05 : -0.05, 0.06, -0.08));
      const holdPt = g.clone().add(new Vector3(0, 0.1, -0.12));
      const destC = this.task === 'shelf' ? SHELF_SPOT : it.rest;
      if (s === 'reach') this.to[side].copy(pre);
      else if (s === 'approach') this.to[side].copy(g);
      else if (s === 'lift') this.to[side].copy(this.palmNow[side]).add(holdPt.sub(g));
      else if (s === 'place') {
        // the object ends at its destination: the hand goes where the grasp then puts it
        const shift = this.attached ? destC.clone().sub(c) : this.graspPoint(side, destC).sub(g);
        this.to[side].copy(this.palmNow[side]).add(shift).add(new Vector3(0, 0.003, 0));
      } else if (s === 'retract' || s === 'dropped' || s === 'rest') {
        this.to[side].copy(this.restHand[side]);
        this.toQ[side].copy(this.restQ[side]);
      } else if (s === 'release') this.to[side].copy(this.palmNow[side]).add(new Vector3(side === 'L' ? 0.015 : -0.015, 0.004, -0.012));
      else if (s === 'close' || s === 'hold') this.toQ[side].copy(this.palmQ[side]);
    }
    for (const side of ['L', 'R'] as Side[]) if (!used.includes(side)) this.toQ[side].copy(this.restQ[side]);
    if (s === 'close') this.sim.close();
    if (s === 'release') this.sim.release();
  }

  /** The stage that follows the current one now, if its end has come (null: stay). */
  private next(): Stage | null {
    const dur = STAGE_DUR[this.stage] ?? 1;
    const done = this.st >= dur;
    switch (this.stage) {
      case 'rest':
        if (this.restarting) (this.restarting = false), (this.leaving = false);
        return this.queued === 'pick' && !this.leaving && !this.stance.busy ? 'reach' : null;
      case 'reach':
        return done ? (this.leaving ? 'retract' : 'approach') : null;
      case 'approach':
        return done ? (this.leaving ? 'retract' : 'close') : null;
      case 'close':
        return done && this.sim.phase === 'holding' ? (this.leaving ? 'release' : 'lift') : null;
      case 'lift':
        return done ? 'hold' : null;
      case 'hold':
        return this.queued === 'place' || this.leaving ? 'place' : null;
      case 'place':
        return done ? 'release' : null;
      case 'release':
        return done ? 'retract' : null;
      case 'retract':
        return done ? 'rest' : null;
      default:
        return null;
    }
  }

  /** Advance the stage machine by dt: every boundary crossed, in order, time carried over. */
  private advance(dt: number) {
    this.st += dt;
    for (let guard = 0; guard < 8; guard++) {
      const n = this.next();
      if (!n) break;
      const dur = STAGE_DUR[this.stage];
      // a timed stage carries the time past its end into the next; an event starts it fresh
      const carry = this.stage !== 'rest' && this.stage !== 'hold' && dur !== undefined ? Math.max(0, this.st - dur) : 0;
      if ((this.stage === 'rest' && n === 'reach') || (this.stage === 'hold' && n === 'place')) this.queued = null;
      if (n === 'lift') {
        // the grip has closed: from here the object moves with the hand, as it sits in it
        this.graspOffset.copy(this.objects[this.item.id]).sub(this.graspRefNow());
        this.attached = true;
      }
      this.setStage(n);
      this.st = carry;
    }
  }

  update(dt: number) {
    this.stand = standHeight(this.kin);
    this.t += dt;
    const model = this.model();
    const it = this.item;
    const hands = this.handsUsed();
    this.advance(dt);
    const s = this.stage;
    const dur = STAGE_DUR[s] ?? 1;

    // grasp physics: the hand's vertical acceleration while lifting, pours, jolts
    const moving = s === 'lift' || s === 'place';
    const x = Math.min(1, this.st / dur);
    const accProfile = moving ? (60 * x - 180 * x * x + 120 * x * x * x) / (dur * dur) : 0; // d²/dt² of the quintic
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
    const lifting = s === 'lift' ? Math.min(1, this.st / 0.55) : s === 'hold' ? 1 : s === 'place' ? Math.min(1, (dur - this.st) / 0.3) : 0;
    this.sim.support = s === 'close' ? 0 : Math.max(0, lifting);
    if (s === 'close' || s === 'lift' || s === 'hold' || s === 'place' || s === 'release') this.sim.step(dt);
    if (this.sim.phase === 'dropped' && (s === 'lift' || s === 'hold' || s === 'place')) {
      this.attached = false;
      this.fallV = 0;
      this.disturbed = true;
      this.setStage('dropped');
    }
    const stage = this.stage;
    const uu = quintic(this.st / (STAGE_DUR[stage] ?? 1));

    // posture: lean in to reach the tray, straighten with the load held close
    const reachFrac = stage === 'reach' ? uu : stage === 'approach' || stage === 'close' ? 1 : stage === 'lift' ? 1 - 0.7 * uu : stage === 'hold' ? 0.3 : stage === 'place' ? 0.3 + 0.7 * uu : stage === 'release' ? 1 : stage === 'retract' || stage === 'dropped' ? 1 - uu : 0;
    const leanT = (this.task === 'shelf' && (stage === 'place' || stage === 'release') ? 6 : 14) * reachFrac;
    this.lean += (leanT - this.lean) * (1 - Math.exp(-dt * 4));
    const heldPos = this.attached ? this.objects[it.id] : undefined;
    const heldMass = this.sim.mass * (it.hands === 'both' ? 2 : 1);
    const nominal = new Vector2(0, 0.045);
    this.stance.update(dt, nominal);
    this.stance.footPoses(this.feet);
    solvePosture(model, this.kin, this.pose, { com: this.stance.com ?? nominal, pelvisHeight: this.stand - 0.012 * reachFrac, pelvisPitch: (1.5 + this.lean) * DEG, feet: this.feet, upper: { ...REST_ARM }, iterations: 3, payloadPos: heldPos });
    // where the hands rest, and how they are turned (for the retract move)
    this.kin.update(this.pose);
    for (const side of ['L', 'R'] as Side[]) {
      this.kin.point(`${side}_hand`, PALM, this.restHand[side]);
      this.restQ[side].setFromRotationMatrix(this.kin.frames.get(`${side}_hand`)!);
    }
    // arms along the path (a retracting arm hands back to the resting posture as it arrives)
    if (stage === 'rest') this.warm = { L: null, R: null };
    else {
      for (const side of hands) {
        const hold = stage === 'close' || stage === 'hold';
        const target = _t.copy(this.from[side]).lerp(this.to[side], hold ? 1 : uu);
        const q = _q.copy(this.fromQ[side]).slerp(this.toQ[side], hold ? 1 : uu);
        const wArm = stage === 'retract' || stage === 'dropped' ? 1 - uu : 1;
        this.scratch.copy(this.pose);
        const arm = ARM_IDX[side];
        const w = this.warm[side];
        if (w) for (let k = 0; k < arm.length; k++) this.scratch.q[arm[k]] = w[k];
        solveArm(this.scratch, side, target, this.kin, { iterations: 22, orientation: q, prefer: 'current' });
        this.warm[side] = arm.map((j) => this.scratch.q[j]);
        for (let i = 0; i < this.pose.q.length; i++) this.pose.q[i] += (this.scratch.q[i] - this.pose.q[i]) * wArm;
      }
    }
    this.kin.update(this.pose);
    for (const side of ['L', 'R'] as Side[]) {
      this.kin.point(`${side}_hand`, PALM, this.palmNow[side]);
      this.palmQ[side].setFromRotationMatrix(this.kin.frames.get(`${side}_hand`)!);
    }
    // fingers: pre-shape while approaching, close to contact and grip, open on release
    const closing = stage === 'close' ? quintic(this.st / CLOSE_T) : stage === 'lift' || stage === 'hold' || stage === 'place' ? 1 : stage === 'release' ? 1 - quintic(this.st / OPEN_T) : 0;
    const pre = stage === 'reach' || stage === 'approach' ? (stage === 'reach' ? uu : 1) : stage === 'close' || stage === 'lift' || stage === 'hold' || stage === 'place' || stage === 'release' ? 1 : stage === 'retract' ? 1 - uu : 0;
    for (const side of ['L', 'R'] as Side[]) {
      const hp = relax(this.hands[side]);
      if (!hands.includes(side)) continue;
      const c = it.closure * closing;
      const open = 0.14;
      hp.fingers = it.pinch
        ? [open + (it.closure - open) * closing, 0.62 * closing + open * (1 - closing), 0.7 * closing + open * (1 - closing), 0.72 * closing + open * (1 - closing)]
        : [open + (c - open) * closing, open + (c - open) * closing, open + (c + 0.04 - open) * closing, open + (c + 0.06 - open) * closing];
      hp.thumbFlex = 0.1 + 0.08 * pre + 0.45 * closing;
      hp.thumbOpp = 0.2 + 0.12 * pre + 0.48 * closing;
      hp.spread = 0.1 + 0.12 * pre * (1 - closing);
    }
    // the object: in the hand (plus any slip), falling, or resting
    const obj = this.objects[it.id];
    if (this.attached && (stage === 'lift' || stage === 'hold' || stage === 'place')) {
      this.graspRefNow(obj).add(this.graspOffset);
      obj.y -= this.sim.slip * SLIP_SHOWN;
      this.held = { pos: obj.clone(), mass: heldMass, hands: it.hands === 'both' ? 'both' : 'R' };
      this.disturbed = true;
    } else {
      if (stage === 'release' || stage === 'retract' || stage === 'rest') this.attached = false;
      this.held = null;
      if (stage === 'dropped') {
        // falls onto the tray (or the floor if it is off the tray)
        const onTray = Math.abs(obj.x - CART.pos.x) < CART.deckW / 2 && Math.abs(obj.z - CART.pos.z) < CART.deckD / 2;
        const floor = (onTray ? CART.deckY : 0) + it.size.y / 2;
        if (obj.y > floor) {
          this.fallV += GRAVITY * dt;
          obj.y = Math.max(floor, obj.y - this.fallV * dt);
        }
      }
    }
    // grip force arrows at the contacts
    this.forces = [];
    if (this.sim.normal > 0.2 && this.attached) {
      for (const side of hands) {
        const tip = this.palmNow[side];
        const inward = it.hands === 'both' ? new Vector3(side === 'L' ? -1 : 1, 0, 0) : new Vector3(1, 0, 0);
        this.forces.push({ at: tip.clone().addScaledVector(inward, -0.04), force: inward.clone().multiplyScalar(this.sim.normal) });
      }
      this.forces.push({ at: obj.clone(), force: new Vector3(0, -heldMass * GRAVITY, 0) });
    }
    // head: look at the object (a critically damped gaze: a new object is looked at, not snapped to)
    const head = this.kin.point('neck', [0, DIM.neckLength, 0]);
    const dd = obj.clone().sub(head);
    const yawT = Math.max(-0.9, Math.min(0.9, Math.atan2(dd.x, dd.z))) * 0.8;
    const pitchT = Math.max(-0.4, Math.min(0.6, -Math.atan2(dd.y, Math.hypot(dd.x, dd.z)) - this.lean * DEG * 0.8));
    const n = this.neck;
    if (!n.init) (n.yaw = yawT), (n.pitch = pitchT), (n.init = true);
    const w = 5;
    n.vy += (w * w * (yawT - n.yaw) - 2 * w * n.vy) * dt;
    n.vp += (w * w * (pitchT - n.pitch) - 2 * w * n.vp) * dt;
    n.yaw += n.vy * dt;
    n.pitch += n.vp * dt;
    this.pose.set('neck_yaw', n.yaw);
    this.pose.set('neck_pitch', n.pitch);
  }

  private neck = { yaw: 0, pitch: 0, vy: 0, vp: 0, init: false };

  /** Where the held object's centre is for the hands of a (displayed) pose. */
  expectedCentre(kin: Kinematics): Vector3 | null {
    if (!this.attached || !this.held) return null;
    const c = this.graspRef(kin).add(this.graspOffset);
    c.y -= this.sim.slip * SLIP_SHOWN;
    return c;
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
    r.mSlipShown = SLIP_SHOWN;
  }
}

/** The palm point (the IK's), in the hand's frame. */
const PALM: [number, number, number] = [0, -DIM.palm, 0.012];
const _t = new Vector3();
const _q = new Quaternion();
