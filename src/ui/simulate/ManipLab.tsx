/**
 * Manipulation lab: pick up an object from the cart and hold it, with the grasp physics and
 * the tactile signals on view.
 */
import { useMemo } from 'react';
import { OBJECTS, GRIP } from '../../engine/grasp';
import { useApp, useLab } from '../../state/store';
import type { World } from '../../world/world';
import { Btn, Plot, Readout, Segmented } from '../kit';
import { Callout, n } from './parts';

const STAGE: Record<string, string> = {
  rest: 'Ready',
  reach: 'Reaching',
  approach: 'Approaching',
  close: 'Closing the grip',
  lift: 'Lifting',
  hold: 'Holding',
  place: 'Placing',
  release: 'Releasing',
  retract: 'Withdrawing',
  dropped: 'Dropped',
};

export function ManipLab({ world }: { world: World }) {
  const l = useLab();
  const r = useApp((s) => s.readouts);
  const m = world.manip;
  const force = useMemo(
    () => [
      { label: 'Grip (normal)', color: '#ffc86b', values: () => world.manip.sim.history.map((x) => x.normal) },
      { label: 'Minimum to hold', color: '#9b8fff', values: () => world.manip.sim.history.map((x) => x.required), dashed: true },
    ],
    [world],
  );
  const vib = useMemo(() => [{ label: 'Tactile vibration', color: '#ff8a74', values: () => world.manip.sim.history.map((x) => x.vibration) }], [world]);
  const obj = OBJECTS[l.task === 'shelf' ? 'box' : l.task];
  const stage = String(r.mStage ?? 'rest');
  const holding = stage === 'hold';
  const slipping = r.mPhase === 'slipping' || !!r.mSlipDetected;
  const two = r.mHands === 'both';
  return (
    <div className="lab">
      <Segmented
        label="Object"
        value={l.task}
        options={[
          { id: 'box', label: 'Parts box' },
          { id: 'vial', label: 'Glass vial' },
          { id: 'tool', label: 'Driver' },
          { id: 'cup', label: 'Beaker' },
          { id: 'wet', label: 'Wet bottle' },
          { id: 'shelf', label: 'Box to shelf' },
        ]}
        onChange={(v) => stage === 'rest' || stage === 'dropped' ? l.set({ task: v }) : undefined}
      />
      <p className="note-small">{obj.note} Friction against the fingertip skin μ ≈ {obj.mu}{Number.isFinite(obj.crush) ? `; it breaks above ${obj.crush} N.` : '.'}</p>
      <div className="quick">
        <Btn primary onClick={() => m.pick()} disabled={!(stage === 'rest' || stage === 'dropped')}>
          Pick up
        </Btn>
        <Btn onClick={() => m.place()} disabled={!holding}>
          {l.task === 'shelf' ? 'Put on the shelf' : 'Put down'}
        </Btn>
        {l.task === 'cup' && (
          <Btn onClick={() => m.pour()} disabled={!holding || Number(r.mPoured) >= 0.29}>
            Pour in 300 ml
          </Btn>
        )}
        <Btn onClick={() => m.shake()} disabled={!holding}>
          Jolt the hand
        </Btn>
        {stage === 'dropped' && <Btn onClick={() => m.reset()}>Reset</Btn>}
      </div>
      {stage === 'dropped' ? (
        <Callout tone="bad" title="INSUFFICIENT GRIP">
          The object slid out: the grip needed {n(r.mRequired, 1)} N per contact and the controller could not get there in time{Number(r.mRequired) > GRIP.maxNormal ? ` — more than the fingers' ${GRIP.maxNormal} N` : ''}. A wider grasp (more contact area and a palm contact) or a slower lift would hold it.
        </Callout>
      ) : r.mCrushed ? (
        <Callout tone="bad" title="CRUSHED">
          The grip went above the object's crush force.
        </Callout>
      ) : slipping ? (
        <Callout tone="warn" title="SLIP DETECTED">
          The tactile skins see the shear-to-normal ratio near its limit and a vibration burst at the contact edge: the grip controller lowers its friction estimate to μ̂ = {n(r.mMuHat, 2)} and raises the grip.
        </Callout>
      ) : (
        <Callout tone="ok" title={STAGE[stage]?.toUpperCase() ?? stage}>
          {holding ? `Holding with ${n(r.mNormal, 1)} N per contact — ${n(Number(r.mNormal) / Math.max(0.01, Number(r.mRequired)), 1)}× the minimum.` : stage === 'rest' ? 'Choose an object and pick it up.' : `${STAGE[stage] ?? stage}…`}
        </Callout>
      )}
      <div className="readouts readouts--3">
        <Readout label={two ? 'Grip per hand' : 'Grip force'} value={n(r.mNormal, 1)} unit="N" />
        <Readout label="Minimum to hold" value={n(r.mRequired, 1)} unit="N" />
        <Readout label="Load" value={n(r.mLoad, 1)} unit="N" />
        <Readout label="Friction estimate" value={n(r.mMuHat, 2)} kind="estimate" />
        <Readout label={`Slip · drawn ×${n(r.mSlipShown)}`} value={n(r.mSlip, 1)} unit="mm" tone={Number(r.mSlip) > 1 ? 'warn' : undefined} />
        <Readout label="Detections" value={n(r.mDetections)} />
      </div>
      <Plot title="Grip" series={force} unit="N" height={64} min={0} />
      <Plot title="Tactile" series={vib} height={44} min={0} max={1} />
      <ul className="notes">
        <li>Friction holds the object: m·(g + a) ≤ 2·μ·N at the two contacts. The controller aims for {GRIP.safety}× that, less for fragile objects, and never above what would break them.</li>
        <li>Before the object slides, the edge of each contact slips first and vibrates (50–400 Hz): the skins detect it, the controller re-estimates μ and tightens — in tens of milliseconds.</li>
        <li>Slip is millimetres: in the scene, the object's slide in the hand is drawn {n(r.mSlipShown)} times larger so it can be seen (visual approximation).</li>
      </ul>
    </div>
  );
}
