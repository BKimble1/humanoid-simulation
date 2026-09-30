/**
 * Engineer mode's design analysis off the main thread (it simulates a walking cycle and six
 * tasks: ~0.1–0.3 s), so dragging a slider never stalls the 3D view.
 */
import { analyzeDesign, type DesignReport } from './design';
import type { RobotConfig } from './robot';

export type DesignSummary = Omit<DesignReport, 'tasks'> & { tasks: Record<string, { margin: number }> };

self.onmessage = (e: MessageEvent<{ id: number; config: RobotConfig }>) => {
  const r = analyzeDesign(e.data.config);
  const tasks: DesignSummary['tasks'] = {};
  for (const [k, t] of Object.entries(r.tasks)) tasks[k] = { margin: t.margin };
  const out: DesignSummary = { ...r, tasks };
  (self as unknown as Worker).postMessage({ id: e.data.id, report: JSON.parse(JSON.stringify(out)) });
};
