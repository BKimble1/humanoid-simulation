/**
 * Limb members as thin-walled circular tubes in bending (Euler–Bernoulli):
 *
 *   A = π/4·(D² − d²)        I = π/64·(D⁴ − d⁴)        σ = M·c / I,  c = D/2
 *   mass = ρ·A·L             stiffness = E·I            margin = σ_allow / σ
 *
 * One load case (the member's design moment) and no fatigue, buckling of the wall, joints or
 * stress concentrations: a first sizing check, not a structural analysis.
 */
import { MATERIALS, MEMBERS, type StructuralMaterial } from '../spec/materials';

export type MemberKey = keyof typeof MEMBERS;

export interface MemberResult {
  material: StructuralMaterial;
  /** Tube mass per member, kg. */
  tubeMass: number;
  /** Bending stiffness E·I, N·m². */
  EI: number;
  stress: number;
  safetyFactor: number;
  /** Tip deflection of the member as a cantilever under the design moment's equivalent end
   * load (M/L at the end), mm. */
  deflectionMm: number;
}

export function tubeSection(D: number, t: number): { area: number; I: number } {
  const d = D - 2 * t;
  return { area: (Math.PI / 4) * (D * D - d * d), I: (Math.PI / 64) * (D ** 4 - d ** 4) };
}

export function member(key: MemberKey, materialId: string): MemberResult {
  const m = MEMBERS[key];
  const mat = MATERIALS[materialId];
  const { area, I } = tubeSection(m.outerD, m.wall);
  const EI = mat.E * 1e9 * I;
  const stress = (m.designMoment * (m.outerD / 2)) / I / 1e6;
  const F = m.designMoment / m.length;
  const deflection = (F * m.length ** 3) / (3 * EI);
  return {
    material: mat,
    tubeMass: mat.density * area * m.length,
    EI,
    stress,
    safetyFactor: mat.strength / stress,
    deflectionMm: deflection * 1000,
  };
}
