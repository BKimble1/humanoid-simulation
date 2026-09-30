/**
 * Engineer mode: change FO-H1's design and see what it does to the whole machine. Every
 * change reruns the design analysis (engine/design.ts, in a worker): masses, centre of mass,
 * joint torques in six tasks against each actuator's peak and continuous ratings, walking
 * power, runtime, structure. Limits it breaks are reported with what would fix them, and the
 * robot in the lab carries the configuration (payload, loads on its joints).
 */
import { useEffect, useRef, useState } from 'react';
import { MATERIALS } from '../../spec/materials';
import { PAYLOAD } from '../../spec/motion';
import { configureActuator, ratings } from '../../engine/actuator';
import { packSpec } from '../../engine/battery';
import type { DesignSummary } from '../../engine/designWorker';
import { taskLabel } from '../../engine/design';
import { ACTUATORS } from '../../spec/actuators';
import { SheetHandle } from '../SheetHandle';
import { useApp, type AppState } from '../../state/store';
import type { World } from '../../world/world';
import { Btn, Readout, Segmented, Slider, SpecRow } from '../kit';
import { Bar, Callout, n } from '../simulate/parts';

type Tab = AppState['engineerTab'];

let worker: Worker | null = null;
let seq = 0;

function useDesign(config: AppState['config']): { report: DesignSummary | null; busy: boolean } {
  const [report, setReport] = useState<DesignSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const want = useRef(0);
  useEffect(() => {
    if (!worker) worker = new Worker(new URL('../../engine/designWorker.ts', import.meta.url), { type: 'module' });
    const w = worker;
    const id = ++seq;
    want.current = id;
    setBusy(true);
    // a short pause so a slider drag sends one request, not fifty
    const t = setTimeout(() => w.postMessage({ id, config }), 140);
    const on = (e: MessageEvent<{ id: number; report: DesignSummary }>) => {
      if (e.data.id !== want.current) return;
      setReport(e.data.report);
      setBusy(false);
    };
    w.addEventListener('message', on);
    return () => {
      clearTimeout(t);
      w.removeEventListener('message', on);
    };
  }, [config]);
  return { report, busy };
}

export function EngineerPanel({ world }: { world: World }) {
  const tab = useApp((s) => s.engineerTab);
  const sheetMin = useApp((s) => s.sheetMin);
  const set = useApp((s) => s.set);
  const config = useApp((s) => s.config);
  const setConfig = useApp((s) => s.setConfig);
  const reset = useApp((s) => s.resetConfig);
  const { report, busy } = useDesign(config);
  const la = config.legActuator;
  const knee = ratings(configureActuator(ACTUATORS.A100, packSpec(config.pack).nominalV, la));
  const pack = packSpec(config.pack);
  void world;
  return (
    <aside className={`side side--wide panel pe ${sheetMin ? 'side--min' : ''}`} aria-labelledby="eng-title">
        <SheetHandle />
      <p className="eyebrow">Engineer</p>
      <h2 className="side__title" id="eng-title">
        Change the design
      </h2>
      <p className="side__lede">Every change reruns FO-H1's analysis: six tasks through the inverse dynamics, a walking cycle through the actuator and battery models.</p>
      <Segmented<Tab>
        value={tab}
        options={[
          { id: 'actuator', label: 'Actuators' },
          { id: 'geometry', label: 'Body' },
          { id: 'battery', label: 'Battery' },
          { id: 'materials', label: 'Materials' },
          { id: 'payload', label: 'Payload' },
        ]}
        onChange={(v) => set({ engineerTab: v })}
      />
      <div className="eng">
        {tab === 'actuator' && (
          <>
            <p className="note-small">Hip and knee actuators (A100 family), both legs.</p>
            <Segmented label="Reducer" value={la.reducer} options={[{ id: 'planetary', label: 'Planetary' }, { id: 'cycloidal', label: 'Cycloidal' }, { id: 'harmonic', label: 'Strain wave' }]} onChange={(v) => setConfig((c) => ({ ...c, legActuator: { ...c.legActuator, reducer: v } }))} />
            <Slider label="Gear ratio" value={la.ratio} min={6} max={100} step={1} unit=": 1" onChange={(v) => setConfig((c) => ({ ...c, legActuator: { ...c.legActuator, ratio: v } }))} />
            <Slider label="Motor size (stack length)" value={la.stackScale} min={0.6} max={1.6} step={0.05} unit="×" format={(v) => v.toFixed(2)} onChange={(v) => setConfig((c) => ({ ...c, legActuator: { ...c.legActuator, stackScale: v } }))} hint="Torque constant and heat capacity grow with length; so do mass and rotor inertia." />
            <Slider label="Drive current limit" value={la.peakCurrent} min={30} max={140} step={5} unit="A" onChange={(v) => setConfig((c) => ({ ...c, legActuator: { ...c.legActuator, peakCurrent: v } }))} />
            <div className="readouts readouts--3">
              <Readout label="Peak torque" value={n(knee.peakTorque)} unit="Nm" />
              <Readout label="Continuous" value={n(knee.continuousTorque)} unit="Nm" />
              <Readout label="Top speed" value={n(knee.noLoadSpeed, 1)} unit="rad/s" />
              <Readout label="Reflected inertia" value={n(knee.reflectedInertia, 3)} unit="kg·m²" />
              <Readout label="Backdrive torque" value={n(knee.backdriveTorque, 1)} unit="Nm" />
              <Readout label="Peak power" value={n(knee.peakPower)} unit="W" />
            </div>
          </>
        )}
        {tab === 'geometry' && (
          <>
            <Slider label="Thigh length" value={config.scale.thigh} min={0.85} max={1.15} step={0.01} unit="×" format={(v) => `${(v * 42).toFixed(1)} cm`} onChange={(v) => setConfig((c) => ({ ...c, scale: { ...c.scale, thigh: v } }))} />
            <Slider label="Shin length" value={config.scale.shin} min={0.85} max={1.15} step={0.01} format={(v) => `${(v * 40).toFixed(1)} cm`} onChange={(v) => setConfig((c) => ({ ...c, scale: { ...c.scale, shin: v } }))} />
            <Slider label="Upper arm" value={config.scale.upperArm} min={0.85} max={1.15} step={0.01} format={(v) => `${(v * 28).toFixed(1)} cm`} onChange={(v) => setConfig((c) => ({ ...c, scale: { ...c.scale, upperArm: v } }))} />
            <Slider label="Forearm" value={config.scale.forearm} min={0.85} max={1.15} step={0.01} format={(v) => `${(v * 26).toFixed(1)} cm`} onChange={(v) => setConfig((c) => ({ ...c, scale: { ...c.scale, forearm: v } }))} />
            <Slider label="Extra torso mass" value={config.torsoExtra} min={0} max={10} step={0.5} unit="kg" onChange={(v) => setConfig({ torsoExtra: v })} hint="Sensors, tools or ballast in the torso." />
          </>
        )}
        {tab === 'battery' && (
          <>
            <Slider label="Cells in series" value={config.pack.series} min={10} max={18} step={1} unit="S" onChange={(v) => setConfig((c) => ({ ...c, pack: { ...c.pack, series: v } }))} hint="Sets the voltage: motor top speed, and whether the pack stays under 60 V." />
            <Slider label="Cells in parallel" value={config.pack.parallel} min={4} max={16} step={1} unit="P" onChange={(v) => setConfig((c) => ({ ...c, pack: { ...c.pack, parallel: v } }))} hint="Sets the capacity (runtime) and the mass." />
            <div className="readouts readouts--3">
              <Readout label="Energy" value={n(pack.energyWh / 1000, 2)} unit="kWh" />
              <Readout label="Nominal" value={n(pack.nominalV, 1)} unit="V" />
              <Readout label="Full" value={n(pack.maxV, 1)} unit="V" tone={pack.elv ? undefined : 'warn'} />
              <Readout label="Mass" value={n(pack.mass, 1)} unit="kg" />
              <Readout label="Cells" value={n(pack.cells)} />
              <Readout label="Pack" value={n(pack.specificEnergy)} unit="Wh/kg" />
            </div>
          </>
        )}
        {tab === 'materials' && (
          <>
            {(['legMember', 'armMember'] as const).map((k) => (
              <div key={k} className="field">
                <label className="field__label">{k === 'legMember' ? 'Thigh and shin tubes' : 'Arm tubes'}</label>
                <select className="select pe" value={config.materials[k]} onChange={(e) => setConfig((c) => ({ ...c, materials: { ...c.materials, [k]: e.target.value } }))}>
                  {Object.values(MATERIALS).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {report?.members.map((m) => (
              <div key={m.key} className="specs">
                <SpecRow label={`${m.spec.label}: tube mass`} value={(m.result.tubeMass * 1000).toFixed(0)} unit="g each" kind="calculated" />
                <SpecRow label="Stress at design load" value={m.result.stress.toFixed(0)} unit="MPa" kind="calculated" tone={m.result.safetyFactor < 1 ? 'bad' : m.result.safetyFactor < 1.5 ? 'warn' : undefined} />
                <SpecRow label="Safety factor" value={m.result.safetyFactor.toFixed(2)} kind="calculated" tone={m.result.safetyFactor < 1 ? 'bad' : m.result.safetyFactor < 1.5 ? 'warn' : 'ok'} />
                <SpecRow label="Tip deflection" value={m.result.deflectionMm.toFixed(2)} unit="mm" kind="calculated" />
              </div>
            ))}
          </>
        )}
        {tab === 'payload' && (
          <>
            <Slider label="Payload in both hands" value={config.payload} min={0} max={PAYLOAD.max} step={1} unit="kg" onChange={(v) => setConfig({ payload: v })} hint={`Rated ${PAYLOAD.rated} kg, held at hip height close to the body. FO-H1 carries it in the lab while you change it.`} />
            <div className="quick">
              {[0, 10, 20, 25, 30].map((v) => (
                <Btn key={v} onClick={() => setConfig({ payload: v })} pressed={config.payload === v}>
                  {v} kg
                </Btn>
              ))}
            </div>
          </>
        )}
      </div>
      <Report report={report} busy={busy} />
      <div className="side__actions">
        <Btn onClick={reset}>Reset to the FO-H1 design</Btn>
      </div>
    </aside>
  );
}

function Report({ report, busy }: { report: DesignSummary | null; busy: boolean }) {
  if (!report) return <p className="note-small">Analysing…</p>;
  // one bar per joint (left and right share a label)
  const worst = report.worst.filter((c, i, a) => a.findIndex((x) => x.label === c.label) === i).slice(0, 5);
  const limits = report.findings.filter((f) => f.severity === 'limit');
  const others = report.findings.filter((f) => f.severity !== 'limit');
  return (
    <section className={`report ${busy ? 'report--busy' : ''}`} aria-live="polite">
      <h3 className="report__title">Consequences</h3>
      <div className="readouts readouts--3">
        <Readout label="Robot mass" value={n(report.robotMass, 1)} unit="kg" />
        <Readout label="COM height" value={n(report.comHeight * 100)} unit="cm" />
        <Readout label="Runtime, mixed" value={n(report.runtime.mixed, 1)} unit="h" tone={report.runtime.mixed < 2 ? 'warn' : undefined} />
        <Readout label="Walking power" value={n(report.walk.power)} unit="W" />
        <Readout label="Cost of transport" value={n(report.walk.costOfTransport, 2)} />
        <Readout label="Energy per km" value={n(report.walk.energyPerKm)} unit="Wh" />
      </div>
      {limits.map((f) => (
        <Callout key={f.title} tone="bad" title={f.title}>
          {f.detail}
          {f.remedies.length > 0 && (
            <ul className="notes">
              {f.remedies.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </Callout>
      ))}
      {limits.length === 0 && (
        <Callout tone="ok" title="WITHIN LIMITS">
          Every joint meets its peak and continuous torque in all six tasks.
        </Callout>
      )}
      {others.map((f) => (
        <Callout key={f.title} tone="warn" title={f.title.toUpperCase()}>
          {f.detail}
        </Callout>
      ))}
      <h3 className="report__title">Hardest-working joints</h3>
      {worst.map((c) => (
        <Bar key={c.label} label={`${c.label} · ${taskLabel(c.task, report.config).toLowerCase()}`} value={Math.max(c.required, 0)} limit={c.available} soft={c.available * 0.85} unit="Nm" note={`sustained ${c.sustained.toFixed(0)} of ${c.continuous.toFixed(0)} Nm continuous`} />
      ))}
    </section>
  );
}
