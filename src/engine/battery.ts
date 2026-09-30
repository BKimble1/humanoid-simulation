/**
 * Battery pack model: series/parallel cells, open-circuit voltage by state of charge, a lumped
 * internal resistance that rises when cold and at low charge, terminal voltage under load,
 * energy, mass and runtime.
 *
 *   V_oc = S · OCV(SOC)
 *   R    = S·R_cell/P · f(T, SOC) + R_extra
 *   I    = (V_oc − √(V_oc² − 4·R·P)) / (2R)       current for a power demand P
 *   V    = V_oc − I·R
 *   heat = I²·R
 */
import { CELL, PACK } from '../spec/power';

export interface PackConfig {
  series: number;
  parallel: number;
}

export const DEFAULT_PACK: PackConfig = { series: PACK.series, parallel: PACK.parallel };

export function ocvCell(soc: number): number {
  const t = CELL.ocv;
  const x = Math.min(1, Math.max(0, soc));
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const [x0, y0] = t[i - 1];
      const [x1, y1] = t[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return t[t.length - 1][1];
}

export interface PackSpec {
  series: number;
  parallel: number;
  cells: number;
  nominalV: number;
  maxV: number;
  minV: number;
  capacityAh: number;
  energyWh: number;
  usableWh: number;
  cellMass: number;
  mass: number;
  specificEnergy: number;
  resistance: number;
  maxContinuousA: number;
  /** Fully charged pack stays within the 60 V DC extra-low-voltage band. */
  elv: boolean;
}

export function packSpec(c: PackConfig = DEFAULT_PACK): PackSpec {
  const cells = c.series * c.parallel;
  const cellMass = cells * CELL.mass;
  const mass = cellMass * (1 + PACK.overheadFraction);
  const capacityAh = c.parallel * CELL.capacityAh;
  const energyWh = c.series * CELL.nominalV * capacityAh;
  return {
    series: c.series,
    parallel: c.parallel,
    cells,
    nominalV: c.series * CELL.nominalV,
    maxV: c.series * CELL.maxV,
    minV: c.series * CELL.cutoffV,
    capacityAh,
    energyWh,
    usableWh: energyWh * PACK.usableFraction,
    cellMass,
    mass,
    specificEnergy: energyWh / mass,
    resistance: (c.series * CELL.resistance) / c.parallel + PACK.extraResistance,
    maxContinuousA: Math.min(PACK.fuseContinuousA, c.parallel * CELL.maxContinuousA),
    elv: c.series * CELL.maxV <= 60,
  };
}

/** Internal resistance multiplier: higher when cold and near empty. estimate */
export function resistanceFactor(tempC: number, soc: number): number {
  const cold = tempC < 25 ? 1 + 0.025 * (25 - tempC) : 1 - 0.004 * Math.min(20, tempC - 25);
  const low = soc < 0.2 ? 1 + 1.5 * (0.2 - soc) : 1;
  return cold * low;
}

export interface PackState {
  soc: number;
  tempC: number;
}

export interface LoadResult {
  current: number;
  voltage: number;
  ocv: number;
  heat: number;
  /** The pack cannot deliver this power (the quadratic has no real root). */
  overload: boolean;
}

/** Terminal current and voltage for a power demand (W) in a given state. */
export function underLoad(spec: PackSpec, st: PackState, powerW: number): LoadResult {
  const voc = spec.series * ocvCell(st.soc);
  const R = (spec.resistance - PACK.extraResistance) * resistanceFactor(st.tempC, st.soc) + PACK.extraResistance;
  const disc = voc * voc - 4 * R * powerW;
  if (disc < 0) {
    const I = voc / (2 * R);
    return { current: I, voltage: voc / 2, ocv: voc, heat: I * I * R, overload: true };
  }
  const I = (voc - Math.sqrt(disc)) / (2 * R);
  return { current: I, voltage: voc - I * R, ocv: voc, heat: I * I * R, overload: false };
}

/** Advance the state of charge and pack temperature by dt seconds at power demand P. */
export function stepPack(spec: PackSpec, st: PackState, powerW: number, dt: number, ambient = 25): LoadResult {
  const r = underLoad(spec, st, powerW);
  st.soc = Math.max(0, st.soc - (r.current * dt) / 3600 / spec.capacityAh);
  const heatCap = spec.cellMass * CELL.specificHeat;
  st.tempC += (dt * (r.heat - (st.tempC - ambient) / PACK.thermalResistance)) / heatCap;
  return r;
}

/**
 * Runtime at a constant average power, integrating the pack from full to the BMS safe-stop
 * threshold (voltage and resistance change as it discharges). Hours.
 */
export function runtimeHours(spec: PackSpec, avgPowerW: number, ambient = 25): number {
  if (avgPowerW <= 0) return Infinity;
  const st: PackState = { soc: 1, tempC: ambient };
  const dt = 30;
  let t = 0;
  // the usable window: from full down to 1 − usableFraction (the return-to-dock threshold)
  const floor = 1 - PACK.usableFraction;
  while (st.soc > floor && t < 3600 * 48) {
    const r = stepPack(spec, st, avgPowerW, dt, ambient);
    if (r.overload || r.voltage < spec.minV) break;
    t += dt;
  }
  return t / 3600;
}

/** Pre-charge: time constant of charging the drives' DC-link capacitors through the resistor. */
export function prechargeTime(capacitance = PACK.busCapacitance, ohm = PACK.prechargeOhm): { tau: number; to95: number; inrushWithout: number } {
  const tau = ohm * capacitance;
  return { tau, to95: 3 * tau, inrushWithout: packSpec().maxV / 0.02 };
}
