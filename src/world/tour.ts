/**
 * The guided tour: about three and a half minutes through FO-H1, as a list of chapters. Each
 * chapter names a scene, what to set when it starts, what to do partway through, and one or
 * two sentences of caption. The player advances on the world's clock (so it pauses with the
 * page and can be recorded frame by frame), and every transition is the world's own
 * scene transition: interrupting the tour anywhere leaves a consistent state.
 */
import { ACTUATORS } from '../spec/actuators';
import { BODY_DOF, DIM, HAND } from '../spec/body';
import { HEAD_CAMERAS } from '../spec/sensing';
import { configureActuator, ratings } from '../engine/actuator';
import { packSpec } from '../engine/battery';
import { RobotModel, type RobotConfig } from '../engine/robot';
import type { LabParams } from '../state/store';
import type { World } from '../world/world';

// the numbers in the captions come from the specification, like everywhere else
const pack = packSpec();
const mass = new RobotModel().robotMass;
const a100 = ratings(configureActuator(ACTUATORS.A100, pack.nominalV));
const kneeRatio = ACTUATORS.A100.reducer.ratio;

export interface Chapter {
  id: string;
  title: string;
  scene: string;
  duration: number;
  caption: string;
  /** When the caption appears, s into the chapter: after the camera has arrived and, where the
   * caption describes a demonstration, after it has begun (default CAPTION_AT). */
  captionAt?: number;
  lab?: Partial<LabParams>;
  /** Design changes for this chapter (on top of the default design). */
  config?: Partial<RobotConfig>;
  /** Called once when the chapter starts. */
  start?: (w: World) => void;
  /** Timed actions within the chapter (seconds from its start). */
  at?: { t: number; run: (w: World) => void }[];
  system?: string;
  actuator?: 'knee' | 'hip' | 'elbow';
}

/** The chapter line shows at once (what we are looking at); the caption once it is framed. */
export const CAPTION_AT = 1.6;

export const TOUR: Chapter[] = [
  {
    id: 'intro',
    title: 'FO-H1',
    scene: 'intro',
    duration: 13,
    captionAt: 1.2,
    caption: `An original humanoid, designed for this simulation: ${DIM.height.toFixed(2)} m tall, ${mass.toFixed(0)} kg, ${BODY_DOF} actuated joints and two ${HAND.actuated}-motor hands. Every number you will see is calculated from its design.`,
  },
  {
    id: 'structure',
    title: 'Structure',
    scene: 'explore.structure',
    duration: 12,
    caption: 'Under the covers: machined 7075 aluminium frames and tubes. Each member is sized for three times the largest torque its joint can apply — a stumble or a hard landing.',
  },
  {
    id: 'actuators',
    title: 'Actuators',
    scene: 'explore.actuators',
    actuator: 'knee',
    duration: 11,
    caption: `The knee motor sits high on the thigh and drives the joint through a push rod, keeping mass near the hip. Hips and knees share one actuator design: ${a100.peakTorque.toFixed(0)} Nm peak.`,
  },
  {
    id: 'inside',
    title: 'Inside an actuator',
    scene: 'explore.actuators.open',
    actuator: 'knee',
    duration: 22,
    caption: `A frameless motor, a ${kneeRatio} : 1 cycloidal reducer, crossed-roller bearing, two encoders, a torque sensor and its own drive. It is running one stride of walking now: watch current and torque follow the gait.`,
  },
  {
    id: 'power',
    title: 'Power',
    scene: 'explore.power',
    duration: 14,
    caption: `A ${(pack.energyWh / 1000).toFixed(1)} kWh pack of ${pack.cells} cells at ${pack.nominalV.toFixed(0)} V. The bus runs through contactors to every drive; the dashes move faster where a limb draws more power.`,
  },
  {
    id: 'compute',
    title: 'Compute and communication',
    scene: 'explore.compute',
    duration: 12,
    caption: 'Perception at 30 Hz, state estimation and whole-body control at 1 kHz, current loops at 20 kHz: one EtherCAT cycle reaches every joint within a microsecond of the others.',
  },
  {
    id: 'vision',
    title: 'Vision',
    scene: 'explore.vision',
    duration: 13,
    caption: `Two cameras ${(HEAD_CAMERAS.stereo.baseline * 100).toFixed(0)} cm apart measure depth by disparity. The error grows with the square of distance: about a millimetre at arm’s length, centimetres across the room.`,
  },
  {
    id: 'grip',
    title: 'Grasp and slip',
    scene: 'sim.manipulation',
    lab: { task: 'wet' },
    duration: 18,
    captionAt: 3.2,
    caption: 'A wet bottle: friction is low. The first grip is too light; the fingertip skins feel the edge of the contact start to slip, the controller re-estimates friction and tightens — in tens of milliseconds.',
    at: [
      { t: 2.5, run: (w) => w.manip.pick() },
      { t: 13, run: (w) => w.manip.place() },
    ],
  },
  {
    id: 'balance',
    title: 'Balance',
    scene: 'sim.balance',
    lab: { balanceTask: 'stand' },
    duration: 18,
    captionAt: 3.3,
    caption: 'A 300 N shove. The capture point — where a foot must land to stop the fall — jumps outside the feet: the ankles push, the hips swing, and a step lands on it.',
    at: [{ t: 3, run: (w) => w.balance.queuePush(300, 'front') }],
  },
  {
    id: 'walk',
    title: 'Walking',
    scene: 'sim.walk',
    lab: { gait: 'normal', walking: true, carry: false },
    duration: 24,
    captionAt: 2.4,
    caption: 'Footsteps are planned ahead; the centre of mass leans into the next one before the current step ends. Heels strike, toes push off, and the ground reaction shows every step.',
  },
  {
    id: 'thermal',
    title: 'Heat',
    scene: 'explore.thermal',
    lab: { walking: false },
    duration: 16,
    caption: 'Every newton-metre costs current, every amp costs heat (I²R). Squats, with time sped up forty times: the knees and hips warm first.',
  },
  {
    id: 'limit',
    title: 'Limits',
    scene: 'engineer',
    duration: 17,
    caption: 'Now ask too much: a 30 kg box, half again the rated load. Six tasks rerun through the inverse dynamics and the thermal models: the arms would overheat holding it and the ankles run out of torque walking with it. Each limit comes with what would fix it.',
    config: { payload: 30 },
  },
  {
    id: 'end',
    title: 'Your turn',
    scene: 'explore.overview',
    duration: 10,
    caption: 'Explore its systems, change its design in Engineer, or run the labs in Simulate.',
  },
];

export const TOUR_LENGTH = TOUR.reduce((s, c) => s + c.duration, 0);
