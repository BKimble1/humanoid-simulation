/**
 * Simulate: the labs. A rail on the left (like Explore), the selected lab's controls, live
 * numbers and plots on the right. Every lab drives the same FO-H1 in the same scene.
 */
import { useApp, type LabId } from '../../state/store';
import type { World } from '../../world/world';
import { Legend } from '../kit';
import { BalanceLab } from './BalanceLab';
import { JointLab } from './JointLab';
import { KinematicsLab } from './KinematicsLab';
import { LimitsLab } from './LimitsLab';
import { ManipLab } from './ManipLab';
import { WalkLab } from './WalkLab';
import { WholeBodyLab } from './WholeBodyLab';

export const LABS: { id: Exclude<LabId, 'hub'>; title: string; short: string; lede: string }[] = [
  { id: 'joint', title: 'Joint lab', short: 'Joint', lede: 'One knee on a test stand: from a commanded angle to current, torque, gear reduction and motion, simulated at 10 kHz.' },
  { id: 'kinematics', title: 'Kinematics lab', short: 'Kinematics', lede: 'Drag the target: inverse kinematics finds the seven arm angles that put the palm there, or shows why it cannot.' },
  { id: 'balance', title: 'Balance lab', short: 'Balance', lede: 'Centre of mass, support polygon and foot forces while FO-H1 squats, leans, stands on one foot and recovers from pushes.' },
  { id: 'walk', title: 'Walking', short: 'Walking', lede: 'On the instrumented treadmill: footsteps planned ahead, the centre of mass kept over a moving support, power drawn step by step.' },
  { id: 'manipulation', title: 'Manipulation lab', short: 'Manipulation', lede: 'Grasp, lift and hold: grip force from friction, tactile slip detection and the grip correcting itself.' },
  { id: 'wholebody', title: 'Whole-body control', short: 'Whole body', lede: 'The loop that runs a thousand times a second: sensors, state estimate, plan, control, motors, motion — and back.' },
  { id: 'limits', title: 'Failures and limits', short: 'Limits', lede: 'Push FO-H1 past what it was designed for and see which limit it meets first, why, and what would fix it.' },
];

export function SimulatePanel({ world }: { world: World }) {
  const lab = useApp((s) => s.lab);
  const go = useApp((s) => s.go);
  const info = LABS.find((l) => l.id === lab);
  return (
    <>
      <nav className="rail pe" aria-label="Labs">
        {LABS.map((l, i) => (
          <button key={l.id} className="rail__item" aria-current={lab === l.id ? 'true' : undefined} onClick={() => go({ lab: l.id })}>
            <span className="rail__num num">{String(i + 1).padStart(2, '0')}</span>
            <span className="rail__label">{l.short}</span>
          </button>
        ))}
      </nav>
      <aside className="side panel pe" aria-labelledby="lab-title" key={lab}>
        {!info ? (
          <>
            <p className="eyebrow">Simulate</p>
            <h2 className="side__title" id="lab-title">
              Seven labs
            </h2>
            <p className="side__lede">Each lab runs one part of FO-H1's engineering live: change the inputs and the physics answers. The models are reduced but real; the information panel lists what each one leaves out.</p>
            <div className="hub">
              {LABS.map((l, i) => (
                <button key={l.id} className="hub__item" onClick={() => go({ lab: l.id })}>
                  <span className="hub__num num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="hub__text">
                    <b>{l.title}</b>
                    <span>{l.lede}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">
              <button className="crumb" onClick={() => go({ lab: 'hub' })}>
                Simulate
              </button>{' '}
              / Lab {String(LABS.indexOf(info) + 1).padStart(2, '0')}
            </p>
            <h2 className="side__title" id="lab-title">
              {info.title}
            </h2>
            <p className="side__lede">{info.lede}</p>
            {lab === 'joint' && <JointLab world={world} />}
            {lab === 'kinematics' && <KinematicsLab world={world} />}
            {lab === 'balance' && <BalanceLab world={world} />}
            {lab === 'walk' && <WalkLab world={world} />}
            {lab === 'manipulation' && <ManipLab world={world} />}
            {lab === 'wholebody' && <WholeBodyLab world={world} />}
            {lab === 'limits' && <LimitsLab world={world} />}
          </>
        )}
        <Legend />
      </aside>
    </>
  );
}
