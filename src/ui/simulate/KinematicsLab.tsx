/**
 * Kinematics lab: inverse kinematics (drag the target) or forward kinematics (set the joints).
 */
import { Vector3 } from 'three';
import { useApp, useLab } from '../../state/store';
import type { World } from '../../world/world';
import { Btn, Readout, Segmented, Slider } from '../kit';
import { Callout, n } from './parts';

const PRESETS: { id: string; label: string; at: [number, number, number] }[] = [
  { id: 'front', label: 'In front', at: [0.25, 1.1, 0.4] },
  { id: 'high', label: 'Shelf height', at: [0.3, 1.75, 0.35] },
  { id: 'low', label: 'Knee height', at: [0.3, 0.55, 0.3] },
  { id: 'far', label: 'Out of reach', at: [0.45, 1.2, 0.95] },
];

export function KinematicsLab({ world }: { world: World }) {
  const l = useLab();
  const r = useApp((s) => s.readouts);
  const reach = world.reach;
  const reached = r.ikReached !== false;
  const angles = reach.armAngles();
  const setPreset = (at: [number, number, number]) => {
    const s = l.ikSide === 'L' ? 1 : -1;
    reach.target.copy(new Vector3(at[0] * s, at[1], at[2]));
  };
  return (
    <div className="lab">
      <Segmented label="Mode" value={l.ikMode} options={[{ id: 'ik', label: 'Inverse (drag the target)' }, { id: 'fk', label: 'Forward (set the joints)' }]} onChange={(v) => {
        if (v === 'fk') reach.fk = angles.map((a) => Math.round(a.deg));
        l.set({ ikMode: v });
      }} />
      <Segmented label="Arm" value={l.ikSide} options={[{ id: 'L', label: 'Left arm' }, { id: 'R', label: 'Right arm' }]} onChange={(v) => {
        reach.target.x = -reach.target.x;
        l.set({ ikSide: v });
      }} />
      {l.ikMode === 'ik' ? (
        <>
          <div className="quick">
            {PRESETS.map((p) => (
              <Btn key={p.id} onClick={() => setPreset(p.at)}>
                {p.label}
              </Btn>
            ))}
          </div>
          {reached ? (
            <Callout tone="ok" title="REACHED">
              The palm is on the target (error {n(Number(r.ikError) * 1000, 1)} mm).
            </Callout>
          ) : (
            <Callout tone="bad" title="UNREACHABLE">
              The closest the palm can get is {n(Number(r.ikError) * 100, 1)} cm short.{r.ikLimits ? ` At their limits: ${r.ikLimits}.` : ' The arm is fully stretched.'} Stepping closer or turning at the waist would reach it.
            </Callout>
          )}
        </>
      ) : (
        <div className="fk">
          {angles.map((a, i) => (
            <Slider key={a.id} label={a.label} value={reach.fk[i]} min={a.min} max={a.max} step={1} unit="°" onChange={(v) => {
              reach.fk[i] = v;
              l.set({ ikMode: 'fk' });
              useApp.setState({ readouts: { ...useApp.getState().readouts } });
            }} />
          ))}
        </div>
      )}
      <label className="check pe">
        <input type="checkbox" checked={l.showWorkspace} onChange={(e) => l.set({ showWorkspace: e.target.checked })} /> Show the reachable workspace
      </label>
      <div className="readouts readouts--3">
        <Readout label="Palm x" value={n(r.palmX, 3)} unit="m" />
        <Readout label="Palm y" value={n(r.palmY, 3)} unit="m" />
        <Readout label="Palm z" value={n(r.palmZ, 3)} unit="m" />
      </div>
      <table className="jtable">
        <tbody>
          {angles.map((a, i) => {
            const v = Number(r[`arm${i}`] ?? a.deg);
            const near = v <= a.min + 1 || v >= a.max - 1;
            return (
              <tr key={a.id} className={near ? 'jtable--limit' : ''}>
                <td>{a.label}</td>
                <td className="num">{n(v)}°</td>
                <td className="jtable__range">
                  <span style={{ left: `${((v - a.min) / (a.max - a.min)) * 100}%` }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="notes">
        <li>Seven joints for three position coordinates plus the palm's direction: the arm is redundant. The solver (damped least squares) uses the spare freedom to keep the elbow in a natural position.</li>
        <li>Damping keeps the solution smooth near a stretched arm, where the exact inverse would ask for infinite joint speeds (a singularity).</li>
      </ul>
    </div>
  );
}
