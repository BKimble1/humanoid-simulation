/**
 * Joint lab: command the knee on its test stand and follow the signal chain.
 */
import { useMemo } from 'react';
import { useApp, useLab } from '../../state/store';
import type { World } from '../../world/world';
import { Btn, Plot, Readout, Segmented, Slider } from '../kit';
import { Chain, Callout, n } from './parts';

export function JointLab({ world }: { world: World }) {
  const l = useLab();
  const r = useApp((s) => s.readouts);
  const rig = world.props.rig.rig;
  const angle = useMemo(
    () => [
      { label: 'Commanded', color: '#9b8fff', values: () => rig.history.map((h) => (h.qRef * 180) / Math.PI), dashed: true },
      { label: 'Measured', color: '#eceef2', values: () => rig.history.map((h) => (h.q * 180) / Math.PI) },
    ],
    [rig],
  );
  const current = useMemo(() => [{ label: 'Current', color: '#9b8fff', values: () => rig.history.map((h) => h.current) }], [rig]);
  const torque = useMemo(() => [{ label: 'Output torque', color: '#ffc86b', values: () => rig.history.map((h) => -h.tauOut) }], [rig]);
  const limited = !!r.jLimitedI || !!r.jLimitedV;
  const hold = Math.abs(Number(r.jTauGravity ?? 0));
  return (
    <div className="lab">
      <Slider label="Target knee angle" value={l.jointTarget} min={0} max={120} step={1} unit="°" onChange={(v) => l.set({ jointTarget: v })} hint="0° is the leg straight (shin horizontal on the stand): the hardest place to hold." />
      <div className="quick">
        {[0, 30, 60, 90].map((a) => (
          <Btn key={a} onClick={() => l.set({ jointTarget: a })} pressed={l.jointTarget === a}>
            {a}°
          </Btn>
        ))}
      </div>
      <Slider label="Speed limit" value={l.jointSpeed} min={30} max={600} step={10} unit="°/s" onChange={(v) => l.set({ jointSpeed: v })} />
      <Slider label="Payload at the ankle" value={l.jointPayload} min={0} max={20} step={1.25} unit="kg" onChange={(v) => l.set({ jointPayload: v })} format={(v) => v.toFixed(v % 1 ? 2 : 0)} />
      <Segmented label="Reducer" value={l.jointReducer} options={[{ id: 'planetary', label: 'Planetary' }, { id: 'cycloidal', label: 'Cycloidal' }, { id: 'harmonic', label: 'Strain wave' }]} onChange={(v) => l.set({ jointReducer: v })} />
      <Slider label="Gear ratio" value={l.jointRatio} min={6} max={100} step={1} unit=": 1" onChange={(v) => l.set({ jointRatio: v })} hint="Higher: more torque from the same current, less speed, more reflected inertia." />
      {limited && (
        <Callout tone="bad" title={r.jLimitedV ? 'VOLTAGE LIMIT' : 'CURRENT LIMIT'}>
          {r.jLimitedV
            ? `The motor's back-EMF at ${n(r.jMotorRpm)} rpm leaves too little of the bus voltage to push more current: the joint cannot go faster. Lower the ratio or the speed.`
            : `The drive is at its ${n(r.jPeakCurrent)} A limit: the actuator cannot produce more torque, so the joint lags or stalls. Raise the ratio, lighten the payload or slow the move.`}
        </Callout>
      )}
      <Chain
        steps={[
          { label: 'Commanded angle', formula: 'minimum-jerk path', value: `${n(r.jQRef, 1)}°` },
          { label: 'Joint controller', formula: 'PID + model feed-forward, 1 kHz', value: `error ${n(r.jErr, 2)}°` },
          { label: 'Motor current', formula: 'current loop, 20 kHz', value: `${n(r.jCurrent, 1)} A`, tone: r.jLimitedI ? 'bad' : undefined },
          { label: 'Motor torque', formula: 'τm = Kt · I', value: `${n(r.jTauMotor, 2)} Nm` },
          { label: 'Reducer', formula: `× ${n(r.jRatio)} · η ${n(Number(r.jEta) * 100)} %`, value: `${n(r.jMotorRpm)} rpm in` },
          { label: 'Output torque', formula: 'τ = τm · N · η', value: `${n(Math.abs(Number(r.jTauOut)), 1)} Nm` },
          { label: 'Acceleration', formula: 'θ̈ = (τ − τg) / (J_link + N²·J_rotor)', value: `J ${n(Number(r.jLinkInertia) + Number(r.jReflected), 3)} kg·m²` },
          { label: 'Measured angle', formula: '19-bit output encoder', value: `${n(r.jQ, 2)}°` },
        ]}
      />
      <Plot title="Angle" series={angle} unit="°" height={70} />
      <Plot title="Current" series={current} unit="A" height={52} />
      <Plot title="Torque" series={torque} unit="Nm" height={52} />
      <div className="readouts readouts--3">
        <Readout label="Holding torque" value={n(hold, 1)} unit="Nm" />
        <Readout label="Motor speed" value={n(r.jMotorRpm)} unit="rpm" />
        <Readout label="Efficiency" value={Number(r.jEff) >= 0 ? n(Number(r.jEff) * 100) : '—'} unit={Number(r.jEff) >= 0 ? '%' : ''} />
        <Readout label="Electrical" value={n(r.jPElec)} unit="W" />
        <Readout label="Copper loss" value={n(r.jPCopper)} unit="W" />
        <Readout label="Winding" value={n(r.jTw)} unit="°C" />
        <Readout label="Reflected inertia" value={n(r.jReflected, 3)} unit="kg·m²" />
        <Readout label="Link inertia" value={n(r.jLinkInertia, 3)} unit="kg·m²" />
        <Readout label="Backdrive η" value={n(Number(r.jEtaBack) * 100)} unit="%" />
      </div>
      <ul className="notes">
        <li>The controller's model knows the shin but not the payload: the integral and feedback terms make up the difference, as a real joint controller must.</li>
        <li>Reflected inertia N²·J_rotor grows with the square of the ratio: at high ratios the motor's own rotor dominates what the joint feels.</li>
      </ul>
      <p className="note-small">Stand geometry and payload are exact; motor, reducer and friction parameters are engineering estimates for this actuator class.</p>
    </div>
  );
}
