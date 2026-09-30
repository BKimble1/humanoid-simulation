/**
 * Whole-body control: the closed loop, stage by stage, with the live values flowing through it.
 */
import { useEffect, useState } from 'react';
import { useApp, useLab } from '../../state/store';
import type { World } from '../../world/world';
import { Btn, Segmented } from '../kit';
import { Chain, n } from './parts';

export function WholeBodyLab({ world }: { world: World }) {
  const l = useLab();
  const r = useApp((s) => s.readouts);
  // a pulse travels round the loop (the diagram's only animation)
  const [k, setK] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      setK(Math.floor((performance.now() - t0) / 420) % 8);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const c = (b: unknown) => (b ? 'on' : 'off');
  const plan = l.wholeMotion === 'walk' ? 'footsteps + ZMP preview, 100 Hz' : l.wholeMotion === 'balance' ? 'capture point + DCM, 1 kHz' : 'hand target, IK, 1 kHz';
  return (
    <div className="lab">
      <Segmented label="Motion" value={l.wholeMotion} options={[{ id: 'walk', label: 'Walking' }, { id: 'balance', label: 'Balancing' }, { id: 'reach', label: 'Reaching' }]} onChange={(v) => l.set({ wholeMotion: v })} />
      {l.wholeMotion === 'balance' && (
        <div className="quick">
          <Btn onClick={() => world.balance.queuePush(260, 'front')}>Push it (260 N)</Btn>
        </div>
      )}
      <Chain
        active={k}
        steps={[
          { label: 'Sensors', formula: 'IMU 1 kHz · 58 encoders · 4 force/torque · cameras 30 Hz', value: `pitch ${n(r.pelvisPitch, 1)}°` },
          { label: 'State estimation', formula: 'IMU + leg kinematics + contacts, 1 kHz', value: `feet ${c(r.contactL)}/${c(r.contactR)}` },
          { label: 'Planner', formula: plan, value: `COM ${n(Number(r.comZ) * 100, 1)} cm` },
          { label: 'Whole-body controller', formula: 'torques and contact forces (QP), 1 kHz', value: `knee ${n(r.kneeTau, 1)} Nm` },
          { label: 'Motor commands', formula: 'torque → current set-points, EtherCAT', value: `${n(r.kneeCurrent, 1)} A` },
          { label: 'Actuators', formula: 'current loops 20 kHz', value: `${n(r.kneeRpm)} rpm` },
          { label: 'Motion', formula: 'the body moves; the ground pushes back', value: `${n(Math.hypot(Number(r.comVx), Number(r.comVz)), 2)} m/s` },
          { label: 'Sensor feedback', formula: 'ground reaction, joint angles, body rates', value: `${n(Number(r.grfL) + Number(r.grfR))} N` },
        ]}
      />
      <ul className="notes">
        <li>Every layer runs at its own rate: cameras and planning in tens of hertz, estimation and whole-body control at a kilohertz, motor currents at twenty.</li>
        <li>In this simulation the plan is followed exactly by a reduced-order model (inverted pendulum, preview control, inverse dynamics), and the numbers shown are what those models compute. A real controller also has to correct for its model's errors.</li>
      </ul>
    </div>
  );
}
