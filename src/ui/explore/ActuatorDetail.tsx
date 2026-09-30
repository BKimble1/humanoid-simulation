/**
 * Explore → Actuators: pick a joint, open its actuator, select a part. While it is open the
 * actuator runs one stride of walking at 1.0 m/s through its model (world/features/
 * actuatorLive): the numbers are real-time values, the rotor on screen turns slowed down.
 */
import { useMemo } from 'react';
import { useApp } from '../../state/store';
import type { World } from '../../world/world';
import { Btn, Plot, Readout } from '../kit';
import { ActuatorChooser } from './ExplorePanel';

const n = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—');

export function ActuatorDetail({ world }: { world: World }) {
  const exploded = useApp((s) => s.exploded);
  const part = useApp((s) => s.part);
  const go = useApp((s) => s.go);
  const r = useApp((s) => s.readouts);
  const sel = useApp((s) => s.actuator);
  const reducer = useApp((s) => s.config.legActuator.reducer);
  const asm = world.assemblies[sel]?.asm;
  const p = asm?.parts.find((x) => x.id === part);
  const h = world.actuatorLive.hist;
  const torque = useMemo(() => [{ label: 'Output torque', color: '#ffc86b', values: () => h.tau }], [h]);
  const current = useMemo(() => [{ label: 'Motor current', color: '#9b8fff', values: () => h.current }], [h]);
  const eff = typeof r.efficiency === 'number' && r.efficiency >= 0 ? `${n(r.efficiency * 100)}` : r.regenerating ? 'braking' : '—';
  return (
    <div className="act">
      <ActuatorChooser />
      <div className="side__actions">
        <Btn primary={!exploded} onClick={() => go({ exploded: !exploded, part: null })}>
          {exploded ? 'Close it up' : 'Open the actuator'}
        </Btn>
      </div>
      {exploded && asm && (
        <>
          <p className="note-small">
            Running one stride of walking at 1.0 m/s through this actuator's model. Values are real time; the rotor is shown at 1/{n(r.slow)} speed.
            {sel !== 'elbow' && reducer !== 'cycloidal' && ' The model shows the baseline cycloidal design; your Engineer configuration changes the numbers.'}
            {sel === 'elbow' && ' With the arms swinging freely the elbow works lightly — carrying a payload is what loads it.'}
          </p>
          <div className="readouts readouts--3">
            <Readout label="Output torque" value={n(r.tauOut, 1)} unit="Nm" />
            <Readout label="Output speed" value={n(r.outDegS)} unit="°/s" />
            <Readout label="Motor speed" value={n(r.motorRpm)} unit="rpm" />
            <Readout label="Motor torque" value={n(r.tauMotor, 2)} unit="Nm" />
            <Readout label="Ratio" value={n(r.ratio)} unit=": 1" kind="design" />
            <Readout label="Current" value={n(r.current, 1)} unit="A" tone={r.limited ? 'bad' : undefined} />
            <Readout label="Electrical power" value={n(r.pElec)} unit="W" />
            <Readout label="Efficiency" value={eff} unit={typeof r.efficiency === 'number' && r.efficiency >= 0 ? '%' : ''} />
            <Readout label="Winding" value={n(r.actTemp)} unit="°C" />
          </div>
          <Plot title="Over the stride" series={torque} unit="Nm" height={64} />
          <Plot title="" series={current} unit="A" height={52} />
          <div className="parts" role="listbox" aria-label="Parts">
            {asm.parts
              .filter((x) => x.id !== 'disc2')
              .map((x) => (
                <button key={x.id} role="option" aria-selected={part === x.id} className="parts__item" onClick={() => go({ part: part === x.id ? null : x.id })}>
                  {x.label}
                </button>
              ))}
          </div>
          {p && (
            <div className="part">
              <h3 className="part__title">{p.label}</h3>
              <p className="part__role">{p.role}</p>
              <ul className="notes">
                {p.facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
