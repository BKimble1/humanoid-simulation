/** Phones: the grab bar at the top of the panel sheet; tap to collapse or expand it. */
import { useApp } from '../state/store';

export function SheetHandle() {
  const min = useApp((s) => s.sheetMin);
  const set = useApp((s) => s.set);
  return <button className="sheet-handle" onClick={() => set({ sheetMin: !min })} aria-label={min ? 'Expand the panel' : 'Collapse the panel'} aria-expanded={!min} />;
}
