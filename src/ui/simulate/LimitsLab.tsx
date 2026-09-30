/**
 * Failures and limits: run a scenario, read what failed, why (with the numbers), and what
 * would fix it.
 */
import { useMemo } from 'react';
import { ACTUATORS, WINDING } from '../../spec/actuators';
import { PACK } from '../../spec/power';
import { GRIP } from '../../engine/grasp';
import { configureActuator, ratings } from '../../engine/actuator';
import { analyzeDesign, taskLabel } from '../../engine/design';
import { useApp } from '../../state/store';
import { LIMITS, type LimitId } from '../../world/limits';
import type { World } from '../../world/world';
import { Btn, Readout } from '../kit';
import { Bar, Callout, n } from './parts';

export function LimitsLab({ world }: { world: World }) {
  const limit = useApp((s) => s.limit);
  const info = LIMITS.find((l) => l.id === limit);
  return (
    <div className="lab">
      <div className="limits">
        {LIMITS.map((l) => (
          <button key={l.id} className="limits__item" aria-pressed={limit === l.id} onClick={() => (limit === l.id ? world.limits.restore() : world.limits.run(l.id))}>
            <b>{l.title}</b>
            <span>{l.what}</span>
          </button>
        ))}
      </div>
      {info && <Detail id={info.id} world={world} code={info.code} />}
      {info && (
        <div className="quick">
          <Btn onClick={() => world.limits.restore()}>Restore FO-H1</Btn>
        </div>
      )}
    </div>
  );
}

function Detail({ id, world, code }: { id: LimitId; world: World; code: string }) {
  const r = useApp((s) => s.readouts);
  const config = useApp((s) => s.config);
  const report = useMemo(() => (id === 'payload' ? analyzeDesign(config) : null), [id, config]);
  switch (id) {
    case 'payload': {
      if (!report) return <p className="note-small">Analysing…</p>;
      const worst = report.worst.filter((c, i, a) => a.findIndex((x) => x.label === c.label) === i).slice(0, 3);
      const f = report.findings.find((x) => x.severity === 'limit') ?? report.findings[0];
      return (
        <>
          <Callout tone="bad" title={f?.title ?? code}>
            {f?.detail} {report.findings.filter((x) => x.severity === 'limit').length > 1 ? `${report.findings.filter((x) => x.severity === 'limit').length - 1} more limits are exceeded.` : ''}
          </Callout>
          {worst.map((c) => (
            <Bar key={c.label} label={`${c.label} · ${taskLabel(c.task, config).toLowerCase()}`} value={c.peakRatio >= c.contRatio ? c.required : c.sustained} limit={c.peakRatio >= c.contRatio ? c.available : c.continuous} unit="Nm" note={c.peakRatio >= c.contRatio ? 'Peak torque needed against what the actuator can give.' : 'Sustained torque against the continuous (thermal) rating.'} />
          ))}
          <Remedies items={f?.remedies ?? []} />
        </>
      );
    }
    case 'thermal': {
      const T = Number(r.hottestC ?? 30);
      const derating = !!r.derating;
      return (
        <>
          <Callout tone={derating ? 'bad' : 'warn'} title={derating ? code : 'HEATING'}>
            {derating
              ? `${r.hottestJoint} windings passed ${WINDING.derateStart} °C: the drive now lowers its current limit (and so the torque) to stop the temperature rising towards ${WINDING.shutdown} °C, where it would shut down. The squats get slower and shallower.`
              : `Copper loss I²R heats the windings faster than the housing can pass the heat to the air. Watch the hottest joint approach the ${WINDING.derateStart} °C derating threshold.`}
          </Callout>
          <Bar label={`Hottest winding · ${r.hottestJoint}`} value={T} limit={WINDING.shutdown} soft={WINDING.derateStart} unit="°C" note={`Derating from ${WINDING.derateStart} °C, shutdown at ${WINDING.shutdown} °C; insulation class F (${WINDING.classLimit} °C).`} />
          <Remedies items={['Rest periods (the housing cools with a time constant of minutes)', 'Lower the payload or the squat depth (torque falls, copper loss falls with its square)', 'A larger motor stack or a better thermal path from windings to housing']} />
        </>
      );
    }
    case 'battery': {
      const V = Number(r.batteryV ?? 48);
      const full = ratings(configureActuator(ACTUATORS.A100, world.model.pack.nominalV));
      const now = ratings(configureActuator(ACTUATORS.A100, Math.max(30, V)));
      const need = 6.5;
      const soc = Number(r.soc ?? 0.08);
      return (
        <>
          <Callout tone="bad" title={code}>
            At {n(soc * 100)} % the pack sits at {n(V, 1)} V under load. Every actuator's top speed is set by the bus voltage against the motor's back-EMF: the knee's no-load speed falls from {n(full.noLoadSpeed, 1)} to {n(now.noLoadSpeed, 1)} rad/s. Below {n(PACK.socReturn * 100)} % FO-H1 asks to return to its charger; at {n(PACK.socSafeStop * 100)} % it sits down and stops.
          </Callout>
          <Bar label="State of charge" value={soc * 100} limit={100} soft={PACK.socDerate * 100} unit="%" />
          <Bar label="Knee top speed at this voltage" value={now.noLoadSpeed} limit={full.noLoadSpeed} soft={need} unit="rad/s" note={`Fast walking needs about ${need} rad/s at the knee.`} />
          <div className="readouts readouts--3">
            <Readout label="Pack voltage" value={n(V, 1)} unit="V" />
            <Readout label="Current" value={n(r.batteryA, 1)} unit="A" />
            <Readout label="Power" value={n(r.batteryW)} unit="W" />
          </div>
          <Remedies items={['Walk slower (lower joint speeds need less voltage)', 'Charge before it gets here: the planner schedules docking from the energy estimate', 'More cells in series raise the voltage (and the insulation requirements above 60 V)']} />
        </>
      );
    }
    case 'torque':
    case 'current': {
      const cmd = Math.abs(Number(r.jCurrentCmd ?? 0));
      const lim = Number(r.jPeakCurrent ?? 80);
      const rig = world.props.rig.rig;
      // the torque needed with the leg straight (the hardest point), and what the actuator gives
      const hold = Math.abs(rig.gravity(0));
      const peak = ratings(rig.act).peakTorque;
      return (
        <>
          <Callout tone={r.jLimitedI || r.jLimitedV ? 'bad' : 'warn'} title={code}>
            {id === 'torque'
              ? `With an ${n(r.jRatio)} : 1 reducer the actuator's peak torque is ${n(peak)} Nm; holding 20 kg with the leg straight needs ${n(hold)} Nm. The drive reaches its current limit and the shin stops at ${n(r.jQ)}°, where gravity's torque (m·g·r·cos θ) equals what the actuator can give.`
              : `The fast lift asks the drive for ${n(cmd)} A; it gives ${n(lim)} A at most (the limit protects the transistors and the magnets). The joint follows the path late and overshoots once the demand falls.`}
          </Callout>
          <Bar label="Current asked" value={cmd} limit={lim} unit="A" />
          <Bar label="Torque needed with the leg straight" value={hold} limit={peak} unit="Nm" />
          <div className="readouts readouts--3">
            <Readout label="Angle" value={n(r.jQ, 1)} unit="°" />
            <Readout label="Error" value={n(r.jErr, 1)} unit="°" tone={Math.abs(Number(r.jErr)) > 5 ? 'bad' : undefined} />
            <Readout label="Current" value={n(r.jCurrent, 1)} unit="A" />
          </div>
          <Remedies items={id === 'torque' ? ['A higher ratio (30 : 1 holds it with room to spare)', 'A larger motor (torque scales with stack length)', 'Keep heavy loads close to the joint'] : ['Slow the move (acceleration torque falls with the square of speed)', 'Lighter payload or a shorter lever', 'A drive and motor rated for more current (and the heat that comes with it)']} />
        </>
      );
    }
    case 'contact':
      return (
        <>
          <Callout tone={r.balPhase === 'fail' || r.balPhase === 'restore' ? 'bad' : 'warn'} title={code}>
            A 650 N shove for 0.15 s gives the body about 1.5 m/s. The capture point — where a foot must land to stop — runs further ahead than FO-H1's longest step (0.62 m) can reach in the time a step takes. {String(r.outFailed || '')}
          </Callout>
          <div className="readouts readouts--3">
            <Readout label="Strategy" value={String(r.strategy ?? '—')} kind="calculated" />
            <Readout label="Steps" value={n(r.steps ?? r.outSteps)} />
            <Readout label="Capture margin" value={n(Number(r.recMargin ?? r.outMargin) * 1000)} unit="mm" tone="bad" />
          </div>
          <Remedies items={['Longer, faster steps (hip range and leg speed)', 'A lower centre of mass (a larger time constant)', 'Crouching and bracing when a collision is predicted', 'A controlled fall: protect the head and hands, land on the knees']} />
        </>
      );
    case 'reach':
      return (
        <>
          <Callout tone="bad" title={code}>
            The target is {n(Number(r.reachDist) * 100 + Number(r.ikError) * 100)} cm from the shoulder; the arm with the hand reaches about {n(Number(r.reachDist) * 100)} cm. The solver stretches the arm towards it and stops {n(Number(r.ikError) * 100, 1)} cm short{r.ikLimits ? `, with ${r.ikLimits} at their limits` : ''}.
          </Callout>
          <Remedies items={['Step towards the target (the planner would place the feet first)', 'Turn and lean at the waist', 'Use a tool']} />
        </>
      );
    case 'grip':
      return (
        <>
          <Callout tone={r.mStage === 'dropped' ? 'bad' : 'warn'} title={code}>
            A 2 kg wet bottle with μ ≈ 0.2 needs {n(Number(r.mRequired))} N per contact just to hold still — more than the finger actuators' {GRIP.maxNormal} N. Slip is detected and the grip goes to its maximum, but the bottle slides out.
          </Callout>
          <Bar label="Grip needed" value={Number(r.mRequired ?? 0)} limit={GRIP.maxNormal} unit="N" />
          <Remedies items={['A power grasp: fingers wrapped round, the palm carrying the load (much larger normal force from geometry)', 'Two hands', 'Dry the surface, or a higher-friction skin']} />
        </>
      );
  }
}

function Remedies({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="remedies">
      <span className="remedies__head">What would fix it</span>
      <ul className="notes">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
