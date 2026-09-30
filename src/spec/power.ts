/**
 * FO-H1's battery, power distribution and electrical loads.
 *
 * The pack is 14 series groups of 21700-format lithium-ion cells (NMC/NCA chemistry, 4.5 Ah
 * class). Fourteen in series keeps the fully charged pack at 58.8 V, under the 60 V DC limit
 * that most standards treat as extra-low voltage (touch-safe when dry), which simplifies
 * insulation, connectors and service. The price is current: a 3 kW peak draws ~60 A.
 * Cell values are estimates in the range of published datasheets for high-power 4.5 Ah
 * 21700 cells; pack values are calculated from them (engine/battery.ts).
 */

export const CELL = {
  format: '21700',
  capacityAh: 4.5,
  nominalV: 3.6,
  maxV: 4.2,
  /** Discharge cut-off used by the BMS (above the cell's 2.5 V absolute minimum). */
  cutoffV: 3.0,
  /** DC internal resistance at 25 °C, 50 % SOC, Ω. estimate */
  resistance: 0.015,
  /** Continuous discharge rating, A. estimate */
  maxContinuousA: 45,
  mass: 0.069,
  /** Open-circuit voltage vs state of charge, (SOC 0–1, V). estimate (typical NMC curve) */
  ocv: [
    [0, 3.0],
    [0.05, 3.3],
    [0.1, 3.45],
    [0.2, 3.56],
    [0.3, 3.62],
    [0.4, 3.68],
    [0.5, 3.74],
    [0.6, 3.82],
    [0.7, 3.9],
    [0.8, 3.99],
    [0.9, 4.08],
    [1.0, 4.18],
  ] as [number, number][],
  /** Specific heat of a cell, J/(kg·K). estimate */
  specificHeat: 1000,
} as const;

export const PACK = {
  series: 14,
  parallel: 9,
  /** Interconnects, fuse and contactor resistance added to the cell string, Ω. estimate */
  extraResistance: 0.01,
  /** Mass of everything that is not a cell (holders, busbars, BMS, enclosure, cooling), as a
   * fraction of cell mass. estimate (typical 25–35 % for small packs) */
  overheadFraction: 0.32,
  /** Usable window the BMS allows (of nominal energy). design */
  usableFraction: 0.9,
  /** Pack thermal resistance to the torso air path, K/W. estimate */
  thermalResistance: 0.35,
  /** Contactor/fuse continuous and 10 s peak current, A. design */
  fuseContinuousA: 150,
  fusePeakA: 250,
  /** Pre-charge resistor (limits inrush into drive DC-link capacitors), Ω. design */
  prechargeOhm: 22,
  /** Total drive DC-link capacitance on the bus, F (29 drives × ~220 µF). estimate */
  busCapacitance: 29 * 220e-6,
  /** BMS: cell-group voltage taps and pack thermistors. design */
  bmsVoltageTaps: 14,
  bmsThermistors: 8,
  /** Low SOC thresholds: reduced performance, return-to-dock request, safe stop. design */
  socDerate: 0.15,
  socReturn: 0.1,
  socSafeStop: 0.05,
} as const;

/**
 * Loads that do not depend on motion, W. estimate (typical for the listed component classes)
 * Low-voltage loads run from isolated DC/DC converters (24 V, 12 V, 5 V) at DCDC_EFFICIENCY.
 */
export const LV_LOADS: { id: string; label: string; watts: number; rail: '24V' | '12V' | '5V' }[] = [
  { id: 'perception', label: 'Perception and planning computer', watts: 45, rail: '24V' },
  { id: 'rt', label: 'Real-time controller', watts: 12, rail: '12V' },
  { id: 'safety', label: 'Safety controller', watts: 2, rail: '5V' },
  { id: 'cameras', label: 'Head cameras and projector', watts: 8, rail: '12V' },
  { id: 'depth', label: 'Chest depth camera', watts: 3, rail: '12V' },
  { id: 'imu', label: 'IMUs', watts: 0.6, rail: '5V' },
  { id: 'ft', label: 'Force/torque sensors (4)', watts: 4.8, rail: '12V' },
  { id: 'tactile', label: 'Tactile skins and hand controllers', watts: 3, rail: '12V' },
  { id: 'network', label: 'EtherCAT junctions and Ethernet switch', watts: 4, rail: '12V' },
  { id: 'fans', label: 'Cooling fans', watts: 6, rail: '24V' },
];

export const DCDC_EFFICIENCY = 0.92;

/** Each joint drive's logic and gate-driver consumption with the bridge enabled, W. estimate */
export const DRIVE_IDLE_W = 1.2;

/** Drive (inverter) losses as a fraction of electrical power through it, plus switching floor. */
export const DRIVE_EFFICIENCY = 0.97;
