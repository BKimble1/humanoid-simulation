/**
 * Where a number comes from. Every value the interface shows is tagged with one of these, so a
 * visitor can always tell a calculation from a design choice, an estimate or a picture.
 *
 *   calculated  computed live by the simulation's equations (engine/*), from other values
 *   design      a specification choice for FO-H1 (a fictional prototype: nobody measured it)
 *   estimate    an engineering assumption taken from public literature, datasheets of
 *               comparable components, or first-principles sizing (documented in ENGINEERING.md)
 *   visual      shown for legibility only (slow-motion rotor, exaggerated vectors, colours)
 */
export type Provenance = 'calculated' | 'design' | 'estimate' | 'visual';

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  calculated: 'Calculated',
  design: 'Design value',
  estimate: 'Estimate',
  visual: 'Visual approximation',
};

export const PROVENANCE_HELP: Record<Provenance, string> = {
  calculated: 'Computed live from the model equations and the current configuration.',
  design: 'A specification choice for FO-H1, an original, unbuilt prototype design.',
  estimate: 'An engineering assumption based on published data for comparable components.',
  visual: 'Drawn for legibility; not a physical quantity.',
};
