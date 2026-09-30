/**
 * Explore: a rail of subsystems on the left, the selected one's explanation and numbers on the
 * right. Selecting moves the camera and changes what is shown (ghosting, opening, overlays);
 * the panel itself only describes.
 */
import { SYSTEMS, SYSTEM_BY_ID } from '../../content/systems';
import { useApp, type SystemId } from '../../state/store';
import type { World } from '../../world/world';
import { Btn, Legend, Segmented, SpecRow } from '../kit';
import { ActuatorDetail } from './ActuatorDetail';

const HOVER: Partial<Record<SystemId, import('../../scene/robot/rig').VisualGroup>> = {
  structure: 'structure',
  actuators: 'actuator',
  hands: 'hand',
  vision: 'sensor',
  power: 'power',
  compute: 'compute',
};

export function ExplorePanel({ world }: { world: World }) {
  const system = useApp((s) => s.system);
  const go = useApp((s) => s.go);
  const exploded = useApp((s) => s.exploded);
  const info = SYSTEM_BY_ID[system];
  // opened actuator: the panel is about the parts and the live numbers
  const focused = system === 'actuators' && exploded;
  return (
    <>
      <nav className="rail pe" aria-label="Subsystems">
        {SYSTEMS.map((s, i) => (
          <button
            key={s.id}
            className="rail__item"
            aria-current={system === s.id ? 'true' : undefined}
            onClick={() => go({ system: s.id })}
            onPointerEnter={() => (world.hover = HOVER[s.id] ?? null)}
            onPointerLeave={() => (world.hover = null)}
          >
            <span className="rail__num num">{String(i).padStart(2, '0')}</span>
            <span className="rail__label">{s.short}</span>
          </button>
        ))}
      </nav>
      <aside className="side panel pe" aria-labelledby="sys-title" key={system}>
        <p className="eyebrow">{system === 'overview' ? 'Explore' : 'Subsystem'}</p>
        <h2 className="side__title" id="sys-title">
          {info.title}
        </h2>
        {!focused && <p className="side__lede">{info.lede}</p>}
        {system === 'actuators' && <ActuatorDetail world={world} />}
        {!focused && (
          <div className="specs">
            {info.specs.map((s) => (
              <SpecRow key={s.label} {...s} />
            ))}
          </div>
        )}
        {!focused && info.notes && (
          <ul className="notes">
            {info.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {system === 'overview' && (
          <div className="side__actions">
            <Btn primary onClick={() => go({ system: 'actuators' })}>
              Start with the actuators
            </Btn>
          </div>
        )}
        <Legend />
      </aside>
    </>
  );
}

export function ActuatorChooser() {
  const actuator = useApp((s) => s.actuator);
  const go = useApp((s) => s.go);
  return (
    <Segmented
      label="Actuator"
      value={actuator}
      options={[
        { id: 'knee', label: 'Knee' },
        { id: 'hip', label: 'Hip pitch' },
        { id: 'elbow', label: 'Elbow' },
      ]}
      onChange={(v) => go({ actuator: v })}
    />
  );
}
