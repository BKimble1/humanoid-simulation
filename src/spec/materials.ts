/**
 * Structural materials FO-H1's designers could choose for its limb members, with handbook
 * properties (typical values; estimate) and a relative cost category. engine/structure.ts
 * turns a choice into member mass, bending stiffness and a margin against yield under the
 * design load case.
 */

export interface StructuralMaterial {
  id: string;
  label: string;
  /** kg/m³ */
  density: number;
  /** Young's modulus, GPa */
  E: number;
  /** Yield (or, for CFRP, design allowable) strength, MPa */
  strength: number;
  /** Relative cost category, 1 (cheapest) … 5 */
  cost: 1 | 2 | 3 | 4 | 5;
  process: string;
  note: string;
}

export const MATERIALS: Record<string, StructuralMaterial> = {
  al6061: {
    id: 'al6061',
    label: 'Aluminium 6061-T6',
    density: 2700,
    E: 69,
    strength: 276,
    cost: 1,
    process: 'Extrusion and CNC machining',
    note: 'Easy to machine, weld and anodise; the default for brackets and prototypes.',
  },
  al7075: {
    id: 'al7075',
    label: 'Aluminium 7075-T6',
    density: 2810,
    E: 71.7,
    strength: 503,
    cost: 2,
    process: 'CNC machined from plate or bar',
    note: 'Nearly twice the strength of 6061 at the same weight and stiffness; not weldable.',
  },
  ti64: {
    id: 'ti64',
    label: 'Titanium Ti-6Al-4V',
    density: 4430,
    E: 114,
    strength: 880,
    cost: 5,
    process: 'Machined or additively manufactured (laser powder bed)',
    note: 'Very strong and fatigue resistant, but dense, slow to machine and expensive. Worth it for small, highly loaded parts.',
  },
  cfrp: {
    id: 'cfrp',
    label: 'Carbon-fibre tube (quasi-isotropic)',
    density: 1560,
    E: 70,
    strength: 450,
    cost: 4,
    process: 'Roll-wrapped or filament-wound tube, bonded aluminium end fittings',
    note: 'Lightest for its stiffness. Joints to metal fittings and impact damage need care; stiffness can be raised further by laying more fibre along the axis.',
  },
  steel4140: {
    id: 'steel4140',
    label: 'Alloy steel 4140 (quenched and tempered)',
    density: 7850,
    E: 205,
    strength: 655,
    cost: 1,
    process: 'Machined tube or bar',
    note: 'Stiff, strong and cheap, but nearly three times the density of aluminium: mass far from the hip costs torque and energy.',
  },
  mg_az91: {
    id: 'mg_az91',
    label: 'Magnesium AZ91D (die cast)',
    density: 1810,
    E: 45,
    strength: 160,
    cost: 2,
    process: 'High-pressure die casting',
    note: 'Lightest structural metal, cheap at volume, but weaker and less stiff; common for housings rather than long members.',
  },
};

/**
 * Limb structural members: thin-walled tubes carrying the joint torque and ground or payload
 * loads as bending. Only the tube changes with the material; machined end fittings are part of
 * each member's mass item in spec/body.ts. design (geometry) · estimate (load case)
 */
export const MEMBERS = {
  legMember: {
    label: 'Thigh and shin members',
    count: 4,
    outerD: 0.05,
    wall: 0.002,
    /** Member length, m (thigh and shin members are about this long between fittings). */
    length: 0.3,
    /** Design bending moment: the knee actuator's peak torque with a 3× impact factor
     * (a stumble or a hard landing), Nm. */
    designMoment: 3 * 259,
  },
  armMember: {
    label: 'Upper-arm and forearm members',
    count: 4,
    outerD: 0.036,
    wall: 0.0018,
    length: 0.2,
    designMoment: 3 * 60,
  },
} as const;

export const DEFAULT_MATERIALS = { legMember: 'al7075', armMember: 'al7075' } as const;
