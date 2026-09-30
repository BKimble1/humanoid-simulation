/**
 * Walking lab: gait, carrying, and the numbers of each step.
 */
import { useMemo } from 'react';
import { GAITS, GRAVITY, HUMAN_REFERENCE } from '../../spec/motion';
import { useApp, useLab } from '../../state/store';
import type { World } from '../../world/world';
import { Btn, Plot, Readout, Segmented } from '../kit';
import { Split, n } from './parts';

export function WalkLab({ world }: { world: World }) {
  const l = useLab();
  const r = useApp((s) => s.readouts);
  const tr = world.walk.trace;
  const grf = useMemo(
    () => [
      { label: 'Left', color: '#ffc86b', values: () => tr.fl },
      { label: 'Right', color: '#9b8fff', values: () => tr.fr },
    ],
    [tr],
  );
  const knee = useMemo(
    () => [
      { label: 'Left knee', color: '#ffc86b', values: () => tr.kl },
      { label: 'Right knee', color: '#9b8fff', values: () => tr.kr },
    ],
    [tr],
  );
  const power = useMemo(() => [{ label: 'Battery', color: '#43c992', values: () => tr.p }], [tr]);
  const walking = !!r.wWalking || l.walking;
  const speed = GAITS[l.gait].speed;
  // the same 3 s average the runtime is computed from
  const avgP = Number(r.batteryAvgW ?? 0);
  const mass = Number(r.totalMass ?? 66) + (l.carry ? Number(r.wCarryMass ?? 0) : 0);
  const cot = r.wWalking ? avgP / (mass * GRAVITY * speed) : NaN;
  return (
    <div className="lab">
      <Segmented label="Gait" value={l.gait} options={[{ id: 'slow', label: `Slow ${GAITS.slow.speed} m/s` }, { id: 'normal', label: `Normal ${GAITS.normal.speed}` }, { id: 'fast', label: `Fast ${GAITS.fast.speed}` }]} onChange={(v) => l.set({ gait: v })} />
      <div className="quick">
        <Btn primary={!walking} onClick={() => l.set({ walking: !l.walking })}>
          {l.walking ? 'Stop' : 'Start walking'}
        </Btn>
        <Btn pressed={l.carry} onClick={() => l.set({ carry: !l.carry })}>
          {l.carry ? `Carrying ${n(r.wCarryMass || world.walk.carryMass)} kg` : 'Carry a box'}
        </Btn>
      </div>
      <Split left={Number(r.loadL ?? 0.5)} right={Number(r.loadR ?? 0.5)} labels={['Left foot', 'Right foot']} />
      <div className="readouts readouts--3">
        <Readout label="Speed" value={n(r.wSpeed, 2)} unit="m/s" kind="design" />
        <Readout label="Cadence" value={n(r.wCadence)} unit="steps/min" kind="design" />
        <Readout label="Step length" value={n(Number(r.wStepLength) * 100)} unit="cm" kind="design" />
        <Readout label="Battery power" value={n(avgP)} unit="W" />
        <Readout label="Cost of transport" value={n(cot, 2)} tone={cot > 0.6 ? 'warn' : undefined} />
        <Readout label="Runtime at this" value={n(r.runtimeH, 1)} unit="h" />
      </div>
      <Plot title="Vertical ground reaction" series={grf} unit="N" height={64} />
      <Plot title="Knee torque" series={knee} unit="Nm" height={52} />
      <Plot title="Battery power" series={power} unit="W" height={52} min={0} />
      <ul className="notes">
        <li>Footsteps are planned ahead and the centre of mass follows them with preview control of the zero-moment point (Kajita's cart–table model): it starts moving towards the next foot before the current step ends.</li>
        <li>Heels strike, toes push off, and each stance foot rolls about its edge; a foot on the belt moves with the belt, so it never slides.</li>
        <li>Cost of transport is power / (weight × speed): about {HUMAN_REFERENCE.costOfTransport} for a walking person; electric humanoids are typically several times higher, mostly from standing torque and copper losses.</li>
      </ul>
    </div>
  );
}
