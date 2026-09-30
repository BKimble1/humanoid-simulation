import { createRoot } from 'react-dom/client';
export function mount(el: HTMLElement) {
  createRoot(el).render(<div>FAB / ONE Humanoid</div>);
}
