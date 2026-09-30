import { describe, expect, it } from 'vitest';
import { ACTUATORS, WINDING } from '../spec/actuators';
import { ActuatorThermal, configureActuator, operate, ratings, reducerEfficiency, resistanceAt, torqueAvailable } from './actuator';
import { packSpec, runtimeHours, underLoad } from './battery';
import { member } from './structure';

const BUS = 51.8;

describe('actuator ratings', () => {
  const a100 = configureActuator(ACTUATORS.A100, BUS);
  const r = ratings(a100);

  it('gives the A100 about 250 Nm peak and a thermally limited continuous torque', () => {
    expect(r.peakTorque).toBeGreaterThan(230);
    expect(r.peakTorque).toBeLessThan(290);
    expect(r.continuousTorque).toBeGreaterThan(45);
    expect(r.continuousTorque).toBeLessThan(75);
    // continuous is set by heat: I²R(T)·(Rwh + Rha) = T_derate − T_ambient
    const m = a100.motor;
    const P = r.continuousCurrent ** 2 * resistanceAt(m, WINDING.derateStart);
    expect(P * (m.rwh + m.rha)).toBeCloseTo(WINDING.derateStart - 25, 6);
  });

  it('computes output torque as τm·N·η', () => {
    const op = operate(a100, 60, 0.001, 40);
    expect(op.tauMotor * a100.ratio * a100.eta).toBeGreaterThan(59.5);
    expect(op.currentLimited).toBe(false);
  });

  it('computes mechanical power as τω and electrical power as V·I', () => {
    const op = operate(a100, 40, 5, 40);
    expect(op.pMech).toBeCloseTo(op.tauDelivered * 5, 6);
    expect(op.pElec).toBeCloseTo(op.voltage * op.current, 6);
    expect(op.pElec).toBeGreaterThan(op.pMech); // losses
  });

  it('trades torque for speed when the gear ratio rises', () => {
    const low = ratings(configureActuator(ACTUATORS.A100, BUS, { ratio: 15 }));
    const high = ratings(configureActuator(ACTUATORS.A100, BUS, { ratio: 60 }));
    expect(high.peakTorque).toBeGreaterThan(low.peakTorque * 3);
    expect(high.noLoadSpeed).toBeLessThan(low.noLoadSpeed / 3.5);
    // reflected inertia grows with N²
    expect(high.reflectedInertia / low.reflectedInertia).toBeCloseTo(16, 6);
    // and it is harder to backdrive
    expect(high.backdriveTorque).toBeGreaterThan(low.backdriveTorque * 4);
  });

  it('limits torque at speed by the supply voltage (back-EMF)', () => {
    const slow = torqueAvailable(a100, 1);
    const fast = torqueAvailable(a100, r.noLoadSpeed * 0.95);
    expect(slow).toBeCloseTo(r.peakTorque, 0);
    expect(fast).toBeLessThan(slow * 0.3);
    expect(torqueAvailable(a100, r.noLoadSpeed * 1.05)).toBe(0);
  });

  it('flags a request beyond the current limit', () => {
    const op = operate(a100, 400, 0, 40);
    expect(op.currentLimited).toBe(true);
    expect(op.tauDelivered).toBeLessThan(400);
    expect(Math.abs(op.current)).toBeCloseTo(a100.peakCurrent, 6);
  });

  it('regenerates when the load drives the motor', () => {
    const op = operate(a100, -40, 6, 40);
    expect(op.regenerating).toBe(true);
    expect(op.pElec).toBeLessThan(0);
  });

  it('makes harmonic drives less efficient and harder to backdrive than planetary', () => {
    const h = reducerEfficiency('harmonic', 100);
    const p = reducerEfficiency('planetary', 10);
    expect(h.forward).toBeLessThan(p.forward);
    expect(h.back).toBeLessThan(p.back);
  });
});

describe('actuator thermal model', () => {
  it('approaches the steady state T = Ta + P·(Rwh + Rha)', () => {
    const a = configureActuator(ACTUATORS.A100, BUS);
    const th = new ActuatorThermal(a.motor, 25);
    for (let t = 0; t < 20000; t += 1) th.step(40, 0, 1, 25);
    expect(th.Tw).toBeCloseTo(25 + 40 * (a.motor.rwh + a.motor.rha), 1);
  });

  it('heats the winding first (fast) and the housing later (slow)', () => {
    const a = configureActuator(ACTUATORS.A100, BUS);
    const th = new ActuatorThermal(a.motor, 25);
    for (let t = 0; t < 30; t++) th.step(300, 0, 1, 25);
    expect(th.Tw - 25).toBeGreaterThan(3 * (th.Th - 25));
    const tc = th.timeConstants();
    expect(tc.housing).toBeGreaterThan(10 * tc.winding);
  });

  it('derates the current limit above the derating temperature', () => {
    const a = configureActuator(ACTUATORS.A100, BUS);
    const th = new ActuatorThermal(a.motor, 25);
    expect(th.currentLimit(80)).toBe(80);
    th.Tw = 130;
    expect(th.currentLimit(80)).toBeLessThan(80);
    th.Tw = 150;
    expect(th.currentLimit(80)).toBeLessThan(25);
  });
});

describe('battery', () => {
  const pack = packSpec();
  it('builds a 14S pack under 60 V with about 2 kWh', () => {
    expect(pack.maxV).toBeCloseTo(58.8, 6);
    expect(pack.elv).toBe(true);
    expect(pack.energyWh).toBeGreaterThan(1900);
    expect(pack.energyWh).toBeLessThan(2400);
    expect(pack.specificEnergy).toBeGreaterThan(150);
    expect(pack.specificEnergy).toBeLessThan(210);
  });

  it('sags under load: V = Voc − I·R and P = V·I', () => {
    const r = underLoad(pack, { soc: 0.8, tempC: 25 }, 1500);
    expect(r.voltage).toBeLessThan(r.ocv);
    expect(r.voltage * r.current).toBeCloseTo(1500, 3);
  });

  it('gives roughly E_usable / P runtime', () => {
    const h = runtimeHours(pack, 450);
    expect(h).toBeGreaterThan((pack.usableWh / 450) * 0.9);
    expect(h).toBeLessThan((pack.usableWh / 450) * 1.1);
  });

  it('crosses the 60 V limit above 14 series cells', () => {
    expect(packSpec({ series: 16, parallel: 8 }).elv).toBe(false);
  });
});

describe('structural members', () => {
  it('ranks materials by mass and margin as the handbook says', () => {
    const al = member('legMember', 'al7075');
    const ti = member('legMember', 'ti64');
    const cf = member('legMember', 'cfrp');
    const st = member('legMember', 'steel4140');
    const mg = member('legMember', 'mg_az91');
    expect(cf.tubeMass).toBeLessThan(al.tubeMass);
    expect(st.tubeMass).toBeGreaterThan(ti.tubeMass);
    expect(ti.safetyFactor).toBeGreaterThan(al.safetyFactor);
    expect(mg.safetyFactor).toBeLessThan(1); // fails the load case
    expect(st.EI).toBeGreaterThan(al.EI * 2.5);
    // σ = M·c/I is the same for every material with the same section
    expect(al.stress).toBeCloseTo(ti.stress, 6);
  });
});
