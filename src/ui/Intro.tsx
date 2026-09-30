import { DIM } from '../spec/body';
import { useApp } from '../state/store';
import { PlayIcon } from './Header';
import { TOUR_LENGTH } from '../world/tour';

/** The opening: the robot is the subject; the title and three ways in sit beside it. */
export function Intro({ mass, dof }: { mass: number; dof: number }) {
  const go = useApp((s) => s.go);
  return (
    <>
      <section className="intro" aria-labelledby="intro-title">
        <p className="intro__eyebrow">FAB / ONE · Interactive engineering</p>
        <h1 className="intro__title" id="intro-title">
          HUMANOID
        </h1>
        <p className="intro__sub">Inside a machine built to move like us.</p>
        <div className="intro__actions">
          <button className="cta cta--primary pe" onClick={() => go({ mode: 'explore', system: 'overview' })}>
            <b>EXPLORE</b>
            <span>Open it up, system by system</span>
          </button>
          <button className="cta pe" onClick={() => go({ mode: 'engineer' })}>
            <b>ENGINEER</b>
            <span>Change the design, see the cost</span>
          </button>
          <button className="cta pe" onClick={() => go({ mode: 'simulate', lab: 'hub' })}>
            <b>SIMULATE</b>
            <span>Joint, reach, balance, walk</span>
          </button>
        </div>
        <button className="intro__watch pe" onClick={() => go({ mode: 'watch' })}>
          <span className="watch__dot">
            <PlayIcon />
          </span>
          Watch the guided tour · {Math.round(TOUR_LENGTH / 60)} min
        </button>
      </section>
      <p className="intro__meta" aria-hidden>
        <b>FO-H1</b> · an original design for this simulation, not a product
        <br />
        <span className="num">
          {DIM.height.toFixed(2)} m · {mass.toFixed(1)} kg · {dof} actuated joints
        </span>
      </p>
    </>
  );
}
