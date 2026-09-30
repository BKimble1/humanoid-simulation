/**
 * The interface for the current mode. Each mode's panel lives in its own module; this picks
 * which one is shown.
 */
import { useApp } from '../state/store';
import type { World } from '../world/world';
import { ExplorePanel } from './explore/ExplorePanel';
import { SimulatePanel } from './simulate/SimulatePanel';
import { EngineerPanel } from './engineer/EngineerPanel';
import { WatchPlayer } from './watch/WatchPlayer';
import { TechInfo } from './TechInfo';

export function Panels({ world }: { world: World }) {
  const mode = useApp((s) => s.mode);
  const info = useApp((s) => s.info);
  return (
    <>
      {mode === 'explore' && <ExplorePanel world={world} />}
      {mode === 'simulate' && <SimulatePanel world={world} />}
      {mode === 'engineer' && <EngineerPanel world={world} />}
      {mode === 'watch' && <WatchPlayer world={world} />}
      {info && <TechInfo />}
    </>
  );
}
