/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The FAB / ONE homepage, when this simulation is built as part of the site (the site's
   * build sets it, with the route as the base: `vite build --base /humanoid/`).
   * Unset when the simulation is built or developed on its own.
   */
  readonly VITE_FABONE_HOME?: string;
}
