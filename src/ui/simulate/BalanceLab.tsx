/**
 * Balance lab: tasks, pushes and what the reduced-order model says about them.
 */
import { useApp, useLab } from '../../state/store';
import type { World } from '../../world/world';
import { Btn, Readout, Segmented, Slider } from '../kit';
import { Callout, Split, n } from './parts';

const STRATEGY_TEXT: Record<string, string> = {
  stand: 'Standing: the ankles keep the centre of pressure under the centre of mass.',
  ankle: 'Ankle strategy: the feet push the centre of pressure towards their edge to stop the body.',
  hip: 'Hip strategy: the torso swings (a burst of hip torque) to pull the body back.',
  step: 'Stepping: the capture point is outside the feet — a foot is placed on it.',
  settle: 'The step has landed; the body is settling.',
  return: 'Walking the feet back to their stance, one careful step at a time.',
  fail: 'Beyond recovery.',
};

export function BalanceLab({ world }: { world: World }) {
  const l = useLab();
  const r = useApp((s) => s.readouts);
  const b = world.balance;
  const busy = r.balPhase !== 'task' || !!r.pushQueued;
  const push = () => {
    // the robot must be standing still to be pushed: it stands up first, then the push lands
    if (l.balanceTask !== 'stand') l.set({ balanceTask: 'stand' });
    b.queuePush(l.pushForce, l.pushDir);
  };
  const strategy = String(r.strategy ?? 'stand');
  const failed = r.balPhase === 'fail' || r.balPhase === 'restore';
  return (
    <div className="lab">
      <Segmented
        label="Task"
        value={l.balanceTask}
        options={[
          { id: 'stand', label: 'Stand' },
          { id: 'squat', label: 'Squat' },
          { id: 'lean', label: 'Lean' },
          { id: 'shift', label: 'Shift' },
          { id: 'oneFoot', label: 'One foot' },
          { id: 'lift', label: 'Lift 10 kg' },
        ]}
        onChange={(v) => !busy && l.set({ balanceTask: v })}
      />
      <div className="group">
        <Slider label="Push" value={l.pushForce} min={50} max={700} step={10} unit="N" onChange={(v) => l.set({ pushForce: v })} hint="Applied at chest height for 0.15 s." format={(v) => `${v}`} />
        <Segmented label="Direction" value={l.pushDir} options={[{ id: 'front', label: 'Forwards' }, { id: 'back', label: 'Backwards' }, { id: 'left', label: 'To its left' }, { id: 'right', label: 'To its right' }]} onChange={(v) => l.set({ pushDir: v })} />
        <Btn primary onClick={push} disabled={busy}>
          Apply push
        </Btn>
      </div>
      {failed ? (
        <Callout tone="bad" title="LOSS OF BALANCE">
          {String(r.outFailed || 'The capture point left every foothold a step could reach.')} A real robot would now fall in a controlled way (knees and hands first) rather than fight it. The lab restores the robot.
        </Callout>
      ) : (
        <Callout tone={strategy === 'stand' ? 'ok' : 'warn'} title={strategy.toUpperCase()}>
          {STRATEGY_TEXT[strategy] ?? ''}
        </Callout>
      )}
      {r.outStrategies && !busy && (
        <p className="note-small">
          Last push: {String(r.outStrategies) || 'ankle'} · {n(r.outSteps)} step{Number(r.outSteps) === 1 ? '' : 's'} · lowest capture margin {n(Number(r.outMargin) * 1000)} mm
        </p>
      )}
      <Split left={Number(r.loadL ?? 0.5)} right={Number(r.loadR ?? 0.5)} labels={['Left foot', 'Right foot']} />
      <div className="readouts readouts--3">
        <Readout label="COM height" value={n(Number(r.comY) * 100)} unit="cm" />
        <Readout label="Stability margin" value={n(Number(r.margin) * 1000)} unit="mm" tone={Number(r.margin) < 0 ? 'bad' : Number(r.margin) < 0.02 ? 'warn' : undefined} />
        <Readout label="Total load" value={n(Number(r.grfL ?? 0) + Number(r.grfR ?? 0))} unit="N" />
      </div>
      <ul className="notes">
        <li>White dot: centre of mass; violet ring below it: its projection. Grey outline: the support polygon (the hull of the soles on the ground). Violet small ring: the capture point, where the robot would have to step to stop. Amber: ground reactions and the centre of pressure.</li>
        <li>Pushes use a linear inverted pendulum with divergent-component-of-motion control and limits on ankle torque, hip torque and step length and time: a reduced-order model, as used for real robots' push recovery, not a full contact simulation.</li>
      </ul>
    </div>
  );
}
