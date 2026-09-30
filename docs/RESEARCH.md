# FO-H1 Engineering Reference: adult-size electric humanoid (1.70–1.75 m, 60–70 kg)

Compiled 2026-09-30 as a reference for an original simulation. Public numbers are used as ranges only. No design is copied.

## How to read this document

- **Tags.** `[Rnn]` points to the reference list at the end.
  - **[V]** The number appeared in a search-engine summary of the cited page.
  - **[D]** I derived the number from verified inputs. The arithmetic is shown.
  - **[U]** The number could not be verified in this session. It is textbook or commonly cited knowledge, or it came from a secondary source only. Treat it as a placeholder.
- **Main limitation.** The egress proxy blocked direct page fetching (WebFetch) for every domain, including arxiv.org, dspace.mit.edu, unitree.com, bostondynamics.com and wikipedia.org. Every "verified" number therefore comes from search-result summaries of the cited URLs, not from reading the PDFs directly. For any value that drives a design decision, re-check the primary datasheet or paper.
- **Company specs.** Many humanoid specs come from press coverage or aggregators such as humanoid.guide, not from official datasheets. They are flagged where relevant.

---

## 1. Public spec ranges of adult-size electric humanoids

| Robot (year) | Height | Mass | DOF (total / leg / arm / hand) | Battery | Runtime | Speed | Payload | Src |
|---|---|---|---|---|---|---|---|---|
| Tesla Optimus prototype (AI Day 2022) | ~1.73 m [U] | ~73 kg | 28 "structural" actuators; hand 11 DOF [U] | 2.3 kWh, 52 V nominal | "full day" (claimed) | – | – | [R9] |
| Tesla Optimus Gen 2 (Dec 2023) | ~1.73 m (5'8") | ~57 kg (reported); 10 kg lighter than Gen 1 | 28 body DOF + 11-DOF hands | 2.3 kWh (reported) | ~8 h (reported, secondary) | +30 % vs Gen 1 | – | [R10] |
| Tesla Optimus V3 hand (patents/reporting 2025) | – | – | hand 22 DOF + 2 wrist; 25 linear actuators in forearm; 3 tendons per finger | – | – | – | – | [R11] (secondary) |
| Figure 02 (2024) | ~1.70 m (5'6") | 70 kg | hands 16 DOF; total not official (28 per one source) [U] | 2.25 kWh, in torso | 5 h | 1.2 m/s | 20 kg | [R5] |
| Unitree H1 (2023) | ~1.80 m (1.76 m in another listing) | ~47 kg | leg 5 (hip 3 + knee 1 + ankle 1); arm 4; H1-M variant: leg 6, arm 7 | 15 Ah, 0.864 kWh, 67.2 V max (16S) | ~1–3 h (retailer) [U] | >1.5 m/s walk; 3.3 m/s record | – | [R1][R2][R3] |
| Unitree G1 (2024, small) | 1.32 m | ~35 kg | 23–43 (leg 6, arm 5, waist 1 in base) | 13-cell Li-ion, 9 Ah (~0.42–0.43 kWh [D]) | ~2 h | – | – | [R4] |
| Apptronik Apollo (2023) | 1.73 m (5'8") | 72.5 kg (160 lb) | 71 total (aggregator) [U]; linear actuators | swappable pack, kWh not public | ~4 h per pack | – | 25 kg (55 lb) | [R6] |
| Agility Digit (v3-era listing) | 1.75 m | 65 kg | 16 (leg 5 ×2, arm 3 ×2); newer versions differ [U] | 1.2 kWh Li-polymer | 4–8 h (listing) | 5 km/h (1.4 m/s) | 16 kg | [R7] |
| Fourier GR-1 (2023) | 1.65 m | 55 kg | 40 total; hands 11 DOF | not verified | not verified | 5 km/h | 50 kg claimed | [R8] |
| 1X NEO (Gamma/2025) | ~1.65–1.67 m | ~30 kg | not verified | 842 Wh | ~4 h | 5 km/h walk, 22 km/h run (claimed) | 20–25 kg lift | [R12] (secondary) |
| Boston Dynamics electric Atlas, product (CES 2026) | ~1.88 m (6'2") [U] | ~90 kg (~200 lb) [U] | 56 DOF | self-swapped batteries; ~4 h [U] | – | – | 50 kg lift; 2.3 m reach; −20 to 40 °C | [R13] |
| PAL TALOS (research reference) | 1.75 m | 100 kg | 32 actuated DOF | – | – | – | – | [R14] |

**Ranges for an adult-size class like FO-H1** ([D] from the table):
- Height: 1.65–1.88 m.
- Mass: 30–100 kg. Most sit at 55–73 kg.
- Body DOF: 19–56. Legs have 5–7 each (6 is typical). Arms have 4–7 each.
- Hands: 6 actuated (11–16 joints) up to 22 DOF.
- Battery: 0.84–2.3 kWh.
- Pack voltage: about 48–67 V max (13S–16S).
- Runtime: 2–8 h claimed; 2–5 h is realistic.
- Walking speed: 1.2–1.5 m/s.
- Payload: 16–50 kg.

**Actuator ratings published by companies:**
- Optimus rotary actuators: 20, 110 and 180 Nm. Linear actuators: 500, 3900 and 8000 N. Each has integrated position and torque/force sensing [R9].
- Unitree H1 joint torque [R1][R2][R24]:
  - Knee about 360 Nm.
  - Hip about 220 Nm.
  - Ankle about 59 Nm.
  - Arm about 75 Nm.
- Fourier GR-1 hip module: 300 Nm peak [R8].
- Figure 02: "up to 150 Nm" [R109] (secondary).
- Unitree G1 knee: 90 Nm (base) or 120 Nm (EDU) [R4].

---

## 2. Actuators

### 2.1 Torque and speed requirements for a 60–70 kg humanoid

- **Human walking joint moments.** At push-off, one dataset reports knee extensor about 0.85 Nm/kg and hip flexor about 1.35 Nm/kg [V R93].
  - The commonly cited ankle plantarflexor peak is about 1.4–1.6 Nm/kg [U].
  - For 65 kg this gives [D]: ankle about 100 Nm, hip about 90 Nm, knee about 55 Nm in level walking.
- **Stairs, squats and jumps** need 2–4× more. A static single-leg deep squat puts 640 N at a 0.2–0.3 m moment arm, which is 130–190 Nm at the knee [D].
  - This is why commercial robots specify peak torques of 150–360 Nm at the hip and knee [R1][R8][R9].
- **Suggested FO-H1 envelope** ([D], engineering judgement):

  | Joint | Peak torque | Continuous torque |
  |---|---|---|
  | Hip pitch | 200–300 Nm | 60–100 Nm |
  | Knee | 250–350 Nm | 80–120 Nm |
  | Ankle pitch | 100–150 Nm | – |
  | Shoulder | 60–100 Nm | – |
  | Elbow | 40–60 Nm | – |
  | Wrist | 10–20 Nm | – |

- **Joint speeds.**
  - Across pooled knee and hip-pitch samples, humanoid peak speeds are 16.6 rad/s for fast walking, 20.1 rad/s for jumping and 14.3 rad/s for stair ascent [V R92, arXiv 2511.06796].
  - Human peak knee angular velocity in running is about 389°/s, or 6.8 rad/s [V R110].
  - Design target for FO-H1: 12–20 rad/s no-load at the hip and knee (115–190 rpm) [D].

### 2.2 Example actuator and motor data

| Unit | Type | Ratio | Rated torque | Peak torque | Mass | Peak Nm/kg [D] | Notes | Src |
|---|---|---|---|---|---|---|---|---|
| MIT Mini Cheetah actuator | QDD, 1-stage planetary | 6:1 | >6 Nm continuous (design criterion) | 17 Nm | 0.48 kg | ~35 | open design | [R15] |
| CubeMars AK10-9 V2 KV60 | QDD, planetary + driver | 9:1 | 18 Nm | 48 Nm | 0.96 kg | 50 | Kt 0.198 Nm/A; rated 109–228 rpm; dual encoder (motor + output); 48 V | [R21] |
| CubeMars AK80-64 KV80 | planetary, 2-stage | 64:1 | 48 Nm | 120 Nm | 0.85 kg | 141 | Kt 0.136; rated 6.3 A, peak 15.7 A; 40 rpm rated (4.2 rad/s), too slow for legs | [R20] |
| Unitree M107 (H1 knee) | inner-rotor PMSM + reducer | n/a | – | 360 Nm | 1.9 kg | 189 | hollow shaft, dual encoder, 107×74 mm | [R24] |
| Harmonic Drive CSG-25-100 | strain-wave component | 100:1 | 87 Nm @ 2000 rpm in | 204 Nm repeated / 369 Nm momentary | – | – | zero backlash | [R25] |
| T-Motor/CubeMars RI80 V2 KV75 | frameless PMSM (motor only) | – | 1.45 Nm (10 A) | 4.0–4.1 Nm (28 A) | 0.47 kg | 8.7 (motor only) | Kt 0.1308 Nm/A, Kv 73 rpm/V, R(ph-ph) 92 mΩ in one listing and 330 mΩ in another (conflict) [U], L 155 µH, 3200 rpm at rated torque, OD 85 / ID 40.5 mm | [R22] |
| RI70 KV95 / RI60 KV120 / RI50 KV100 | frameless | – | 0.94 / 0.57 / 0.58 Nm | 2.68 / 1.63 / 1.67 Nm | – | – | R(ph-ph) 418 / 900 / 1420 mΩ; RI50 Ke 11.41 V/krpm | [R22] |
| Kollmorgen KBM-35H01 | frameless, 240–480 VAC class | – | 2.24 Nm | 10.7 Nm | – | – | Kt 2.37 Nm/A, R(L-L) 4.13 Ω; KBM family 1.45–3445 Nm continuous, windings rated 155 °C | [R23] |

**Peak-to-continuous ratio [D].** Peak torque is 2.5–3× continuous for small outrunner/inrunner robot motors (RI series, AK series) and about 4.8× for the Kollmorgen KBM-35 industrial frameless motor. Peak is limited by current, magnetic saturation and driver current. Continuous is limited by heat (Section 3).

### 2.3 Motor constants

- **Speed constant to torque constant.** For an ideal PMSM/BLDC in SI units, torque constant = back-EMF constant. This gives:
  - `Kt [Nm/A] ≈ 60 / (2π·Kv[rpm/V]) = 9.549 / Kv`.
  - Check: RI80 has Kv 73, so 9.549/73 = 0.1308 Nm/A, which matches its datasheet Kt exactly [V/D R22].
  - An alternative sine-drive convention gives `Kt ≈ 8.27/Kv` (15√3/π) [V R32].
  - CubeMars AK-series Kt values are 15–25 % higher than 9.549/Kv. For example AK10-9 KV60: 0.159 predicted vs 0.198 listed. Datasheet conventions (RMS vs peak, line-line vs phase) vary, so always use measured Kt [D].
- **Motor constant.** `Km = Kt / √R` (Nm/√W). It measures torque per square root of copper-loss watts and is independent of winding.
- **Copper loss** (convention-dependent): `P_cu = 3·R_ph·I_rms² = 1.5·R_LL·I_rms²`, or `1.5·R_ph·I_q²` with amplitude-invariant d-q current.
  - RI80 at 10 A rms with R_LL = 92 mΩ: about 14 W.
  - RI80 at 28 A rms: about 108 W [D].
- **Output torque through a gearbox.** `τ_out = N·η·Kt·i_q`. Current-based ("proprioceptive") torque estimation relies on this relation, as in the MIT Cheetah [R16].

### 2.4 Transmission comparison

| Transmission | Typical ratio | Efficiency | Backdrivable? | Notes | Src |
|---|---|---|---|---|---|
| Quasi-direct drive (1-stage planetary) | 6:1–10:1 | ~97 % per planetary stage; ~94 % for 2 stages | Yes, highly | Low reflected inertia; high-bandwidth force control; impact tolerant | [R27][R15][R16] |
| Cycloidal QDD | ~10:1 (example C-QDD) | not verified | Yes (tested) | High torque density and robustness, low backlash | [R30] |
| Precision cycloidal / RV (Nabtesco) | 57–192 (RV standard); 30–100 for small cycloidal drives [U] | up to ~85 % | Poorly | Shock-load capacity; industrial robot standard | [R26] |
| Strain-wave (Harmonic Drive CSF/CSG) | 30–160 (CSF); 50–160 (CSG); single stage 30–320 | 60–90 % depending on design; up to ~85 % at rated torque; strongly dependent on speed, torque, temperature and lubrication | Poorly | Zero backlash; compliant flexspline; used with joint torque sensors | [R25][R28] |
| Planetary roller screw (linear) | lead-based | ~85–90 % | Depends on lead | 3–6× ball-screw load rating, 10–15× life; Optimus uses them in the calves (4 units) | [R29] |
| Ball screw | lead-based | ~90 % [U] | Yes (with low friction) | – | [U] |

- **Reflected inertia.** `J_reflected (at output) = N²·J_rotor` (equivalently, load inertia seen at the motor = J_load/N²). It follows from equal kinetic energy on both shafts [V R31]. Example [D]:
  - Rotor J = 1.5e-4 kg·m².
  - At 6:1 the output sees 0.0054 kg·m².
  - At 100:1 the output sees 1.5 kg·m², about 280× more. This is why high-ratio joints are not backdrivable and suffer high impact loads.
- **Impact mitigation.** The MIT Cheetah proprioceptive design introduced an "impact mitigation factor" (IMF) to quantify backdrivability at impact. It enabled contact times down to 85 ms and peak foot forces above 450 N [V R16].
- **Energy-efficiency design principles** (MIT Cheetah, Seok et al. 2015) [V R17]:
  - High-torque-density motors.
  - Regenerative electronics.
  - Low-loss transmission.
  - Low leg inertia.

---

## 3. Motor thermal

- **Insulation classes** (NEMA/IEC hot-spot limits) [V R33]:

  | Class | Max temperature | Allowed rise over 40 °C ambient (SF 1.0) |
  |---|---|---|
  | A | 105 °C | 60 K |
  | B | 130 °C | 80 K |
  | F | 155 °C | 105 K |
  | H | 180 °C | 125 K |

  Each 10 °C above rating roughly halves insulation life. Kollmorgen KBM windings are rated for continuous duty up to 155 °C [R23].
- **Copper resistance vs temperature.** `R(T) = R_20·[1 + 0.00393·(T − 20 °C)]` [V R34].
  - At 155 °C, R ≈ 1.53× R_20. At 120 °C, R ≈ 1.39× R_20 [D].
  - The equivalent form is `ΔT = (T1 + 234.5)(R2 − R1)/R1`, used for measuring winding temperature from resistance [V R34].
- **NdFeB magnet derating.** Kt drops by about 0.1 %/K because remanence falls [U, typical NdFeB Br coefficient −0.1 to −0.12 %/K]. Hot motors therefore need more current per Nm, which compounds the I²R loss.
- **Two-node thermal model** (the standard for legged-robot actuators; the "Urata" two-resistor model) [V R36]:
  - `C_w·dT_w/dt = P_cu − (T_w − T_h)/R_wh`
  - `C_h·dT_h/dt = (T_w − T_h)/R_wh − (T_h − T_a)/R_ha`
  - The winding temperature is estimated from the measured housing temperature.
- **Typical parameters, small motors** (maxon datasheets) [V R35]:

  | Parameter | A-max 16 | Larger model |
  |---|---|---|
  | R_wh (winding to housing) | 5.5 K/W | 3.2 K/W |
  | R_ha (housing to ambient) | 29.8 K/W | 13.2 K/W |
  | Winding time constant τ_w | 3.55 s | 11.9 s |
  | Motor time constant | 165 s | 474 s |

  Frameless motors in a metal joint housing usually have much lower R_ha, set by the structure and airflow. A plausible range for a 0.5 kg frameless motor bonded into an aluminium leg is R_wh 0.5–1.5 K/W, R_ha 1–3 K/W, τ_w 20–60 s and τ_housing 5–20 min [U, estimate for simulation only].
- **Continuous torque is thermally limited** [D]. `τ_cont = Kt·√[(T_max − T_amb) / ((R_wh + R_ha)·k·R(T_max))]`, where k = 1.5 for R_LL with I_rms.
  - Mini Cheetah design criterion: more than 6 Nm continuous at thermal equilibrium after 30+ minutes at constant load [V R15].
  - Thermal-aware policies extended fixed-load operation of a quadruped from about 7 min to more than 27 min without thermal cut-outs [V R36]. Thermal limits genuinely bound humanoid duty cycles, especially in standing and squatting.
- **Simulation rule** [D]:
  - Integrate I²R with R(T).
  - Derate the peak current limit linearly between about T_max − 20 K and T_max.
  - Fault at the class limit, for example 155 °C for class F with a margin to about 140 °C.

---

## 4. Encoders and torque sensing

- **On-axis magnetic encoder, AS5048** [V R56]: 14-bit (0.0219°/LSB), 0.05° accuracy after linearization and averaging, SPI/I²C/PWM.
- **Off-axis ring encoder, RLS AksIM-2** [V R57]:
  - Up to 20-bit resolution.
  - System accuracy ±0.004° to ±0.020° after self-calibration.
  - BiSS-C / SSI / asynchronous serial interfaces.
  - Hollow-shaft friendly, suited to robot joints.
- **Dual encoders (motor side + output side).**
  - Harmonic Drive integrated actuators pair a 14-bit (16,384 cpr) motor-input encoder with a 14-bit output encoder [V R58].
  - Unitree M107 and CubeMars AK10-9 are also dual-encoder [R24][R21].
  - Uses: absolute output angle at power-up; compensating backlash and compliance; estimating joint torque from transmission deflection.
  - Dual-encoder torque estimation on a harmonic drive needs models of kinematic error, hysteresis and torsional stiffness, for example B-spline compensation [V R58].
  - Digit uses absolute plus incremental encoders [R7].
- **Joint torque sensing options:**
  - Strain-gauge joint torque sensors. TALOS has them in every joint [V R14].
  - Series elastic actuators (Pratt & Williamson 1995). A spring between gearbox and output measures force by Hooke's law. They trade bandwidth for stable, low-noise force control and shock tolerance [V R59].
  - Current-based estimation (τ = N·η·Kt·i) for QDD designs [R16].
  - Optimus actuators integrate torque or force sensors [R9].
- **6-axis force/torque sensors at ankles and wrists.** TALOS has F/T sensors in both ankles and both wrists [V R14].
  - **ATI Mini45** [V R54]:
    - Fx/Fy ±580 N, Fz ±1160 N, torque 20 Nm.
    - 91.7 g, Ø45 × 15.7 mm.
    - About 1.7 gf resolution (titanium version).
  - **ATI Axia80** [V R55]:
    - ±500 N and 20 Nm, 0.3 kg.
    - EtherCAT interface.
    - Resonance 2.2–2.6 kHz; overload 5–12.5× rated.
  - **Sizing for FO-H1** [D]. A 65 kg robot landing or running produces 2–3× body weight on one foot, which is 1.3–1.9 kN Fz. That exceeds the Mini45 Fz rating, so ankle sensors must be larger. Wrists can use 500 N / 20 Nm class sensors.

---

## 5. Battery

### 5.1 Cells

| Cell | Capacity | Nominal V | Max continuous discharge | Mass | Wh/cell [D] | Wh/kg cell [D] | Src |
|---|---|---|---|---|---|---|---|
| Molicel INR21700-P45B | 4.5 Ah (min 4.3) | 3.6 V (4.2 V charge, 2.5 V cutoff) | 45 A (80 °C cut-off); ~90 A for about 3 s pulse | ~70 g max | 16.2 | ~231 | [R37] |
| Samsung INR21700-50S | 5.0 Ah | 3.6–3.7 V | 25 A spec (45 A with 80 °C cut-off per retailer) | ~72 g ±1 (retailer) | 18.0 | ~250 | [R38] |

**Typical 21700 operating windows** [V R43]:
- Charge 0 to 45 °C; discharge −20 to 60 °C.
- About 80 % capacity after 500 cycles (Samsung 50E / EVE 50E class).

### 5.2 Pack configurations for ~2–2.5 kWh

| Config | Nominal (3.6 / 3.7 V/cell) | Max (4.2 V) | Min (2.5–3.0 V) | Example | Energy | Cell mass |
|---|---|---|---|---|---|---|
| 13S | 46.8 / 48.1 V | 54.6 V | 32.5–39 V | Unitree G1 (13 cells, 9 Ah) | ~0.42 kWh | – |
| 14S | 50.4 / 51.8 V | 58.8 V | 35–42 V | 14S10P P45B, 45 Ah | 2.27 kWh | 9.8 kg |
| 16S | 57.6 / 59.2 V | 67.2 V | 40–48 V | Unitree H1 (15 Ah → 0.864 kWh) | – | – |
| 24S | 86.4 / 88.8 V | 100.8 V | 60–72 V | 24S6P P45B, 27 Ah | 2.33 kWh | 10.1 kg |
| 28S | 100.8 / 103.6 V | 117.6 V | 70–84 V | 28S5P P45B, 22.5 Ah | 2.27 kWh | 9.8 kg |

- All rows are [D] from cell data. Optimus's "52 V nominal" matches 14S at 3.7 V/cell [R9].
- **Pack-level specific energy.** EV packs using 230–260 Wh/kg cells reach 150–200 Wh/kg at pack level after housing, cooling and BMS [V R39]. A 2.25 kWh pack at 150–200 Wh/kg weighs 11–15 kg [D]. That is 17–23 % of a 65 kg robot, so put it in the torso to lower the CoM relative to the arms [R10].
- **Current headroom** [D]. A 2.5 kW peak at 50 V is 50 A. A 14S10P P45B pack is rated 450 A continuous, so cells are never the limit; wiring, contactors and thermal design are. At 86 V the same power is about 29 A.
- **Voltage safety thresholds.**
  - IEC 61140 ELV: ≤120 V ripple-free DC.
  - IEC 62368-1 ES1: ≤60 V DC (dry) [V R42].
  - A 14S pack (58.8 V max) stays under 60 V. A 24S or 28S pack exceeds it, so it needs touch-safe insulation and isolated downstream converters.
  - A 48 V battery bus can also exceed SELV limits during motor regeneration transients [V R41].
- **BMS functions** [V R40][U for list completeness]:
  - Per-cell voltage and temperature monitoring.
  - Pack current sensing (shunt or Hall).
  - Passive or active balancing.
  - SoC/SoH estimation.
  - Over- and under-voltage, over-current, short-circuit and over-temperature protection.
  - Contactor control and precharge.
  - Charge authorization.
- **Contactors and precharge** [V R40]:
  - Without precharge, inrush into the DC-link capacitance "can easily peak at 1000 A", which can weld contactors.
  - Sequence: close the negative contactor, then the precharge path through a 10–100 Ω resistor until the DC link reaches about 95 % of pack voltage, then the main positive contactor, then open the precharge contactor.
  - Optimus integrates all battery electronics on one PCB inside the pack [V R9].
- **DC/DC power tree** [V R41]:
  - Humanoids typically use a ~48 V battery rail for the major joint drives.
  - Step-down converters feed 24 V, 12 V (hand motors, fans) and 5 V/3.3 V (logic, sensors).
  - An isolated, regulated system bus (for example via quarter-brick isolated converters) is an alternative to a raw battery bus.
  - Compute (for example about 640 TOPS) uses about 10 % of the average power budget [V R44].

---

## 6. Power and cost of transport (CoT)

- **Optimus (AI Day 2022):** about 100 W idle or sitting, about 500 W walking briskly [V R9]. That gives 2.3 kWh / 0.5 kW ≈ 4.6 h of walking [D].
- **Review of ~20 humanoid concepts:** average power up to about 500 W, about 10 % of it compute. A 1.3 kWh battery gives 3+ h [V R44]. Peak power budgets of the 2020s commercial humanoids are 2–2.5 kW (search summary of MPS/industry material) [V R41][R44].
- **Implied average power from published battery and runtime** [D]:

  | Robot | Battery ÷ runtime | Average power |
  |---|---|---|
  | Figure 02 | 2.25 kWh / 5 h | ~450 W |
  | Digit | 1.2 kWh / 4–8 h | 150–300 W |
  | 1X NEO | 0.842 kWh / 4 h | ~210 W |
  | Unitree H1 | 0.864 kWh / 1–3 h | ~290–860 W |

- **Standing power** is not zero. QDD joints are not self-locking, so gravity torque must be held with current. The ~100 W idle figure is the only verified data point [R9]. Estimate stance holding power from Σ(τ_i/Kt_i)²·R_i plus electronics (about 50–150 W compute and sensors) [D/U].
- **Cost of transport,** `CoT = P / (m·g·v)` (dimensionless):

  | System | CoT | Src |
  |---|---|---|
  | Human walking, mechanical | ≈0.05 | [V R45] |
  | Human walking, metabolic ("specific") | ≈0.2 | [V R45][R47] |
  | Cornell efficient passive-based biped | 0.2 specific; 0.055 mechanical | [V R45] |
  | Honda ASIMO, electrical, at ~0.4 m/s | ≈3.2 | [V R45][R47] |
  | ATRIAS (Cassie predecessor), total | 1.3 | [V R46] |
  | "Today's humanoid robots" | >0.7 | [V R47] |
  | MIT Cheetah, 33 kg at 6 m/s | 0.5 (total battery power 973 W) | [V R17] |
  | Cassie (31 kg, ~4 kg battery) | specific CoT value not verified; designed for low CoT | [R48] |

  **Worked example [D]:** a 65 kg robot at 1.2 m/s drawing 450 W has CoT = 450 / (65 × 9.81 × 1.2) ≈ 0.59. A reasonable FO-H1 simulation target is 0.4–0.8 electrical CoT at 1.0–1.4 m/s.

---

## 7. Sensors

### 7.1 IMU

| Part | Gyro | Accel | Other | Src |
|---|---|---|---|---|
| Bosch BMI088 | ±125–2000 °/s; bias stability <2 °/h; TCO <15 mdps/K; noise density ~0.014 °/s/√Hz [U] | ±3–24 g; noise 160 µg/√Hz (X,Y), 190 µg/√Hz (Z), 230 µg/√Hz at ±24 g; TCO 0.2 mg/K | vibration-robust, popular in drones | [R49] |
| TDK ICM-42688-P | ±15.6–2000 dps; noise 2.8 mdps/√Hz | ±2–16 g; 70 µg/√Hz | 2 kB FIFO, SPI/I3C | [R50] |
| MicroStrain 3DM-GX5-25 AHRS | in-run bias 8 °/h; ARW 0.3 °/√h | 25 µg/√Hz (8 g) | IMU up to 1 kHz, EKF up to 500 Hz; pitch/roll ±0.25° static, ±0.4° dynamic; 16.5 g | [R51] |

For simulation noise, use gyro white noise of about 0.003–0.014 °/s/√Hz with a random-walk bias, and accelerometer noise of 70–200 µg/√Hz [D from rows above].

### 7.2 Stereo and depth cameras

- **Intel RealSense D435** [V R52]:
  - Active IR stereo with global shutter.
  - 50 mm baseline.
  - Depth FOV about 86–87° × 57–58°.
  - Depth up to 1280×720 at up to 90 fps.
  - Ideal range about 0.3–3 m (max about 10 m).
  - RMS error ≤2 % at 2 m.
- **Stereolabs ZED 2i** [V R53]:
  - 120 mm baseline.
  - Depth 0.3–20 m (2.1 mm lens).
  - FOV 110° H × 70° V.
  - 2×2208×1242 at 15 fps up to 2×672×376 at 100 fps.
  - 229 g, 5 V at 380 mA.
- **Stereo depth error** [U, standard stereo geometry]: `Δz ≈ z²·Δd / (f·b)`. Error grows with the square of range and shrinks with baseline b.
- **Humanoid practice.** Figure 02 uses 6 RGB cameras [R5]. Atlas uses 360° camera coverage [R13]. Digit uses lidar plus 4 depth cameras [R7].

### 7.3 Tactile sensing and slip

- **Human reference.**
  - Fingertip two-point discrimination is about 2–3 mm [V R64].
  - Meissner corpuscles respond at about 3–40 Hz (dynamic skin deformation, slip onset). Pacinian corpuscles respond at about 10–500 Hz (vibration, peak sensitivity at a few hundred Hz) [V R64].
- **Technologies** [V R63]:
  - Piezoresistive: resistance changes with strain.
  - Capacitive: a best reported resolution of 3 Pa with 0.55 kPa⁻¹ sensitivity.
  - Piezoelectric: dynamic only, good for vibration and slip.
  - Magnetic.
  - Optical/visuotactile: GelSight, DIGIT.
  - No single technology matches all skin properties: resolution, stretchability, environmental insensitivity, and normal plus shear sensing.
- **GelSight (visuotactile).** An elastomer skin is imaged by an internal camera, giving high-resolution 3D contact geometry [V R60].
  - Printed markers track normal and shear force.
  - Slip is detected from relative membrane motion plus shear distortion. The method was validated on 37 everyday objects for translational and rotational slip.
  - Visuotactile sensors reach about 0.6 mm spatial resolution but often stream at only about 60 Hz because of camera rate [V R64].
- **BioTac (multimodal).** A fluid-filled elastic skin over a rigid core with three sensing channels [V R61]:
  - Impedance electrodes measure force and contact location.
  - A hydro-acoustic pressure transducer picks up micro-vibration (slip, texture).
  - A thermistor senses temperature and heat flux.
- **Slip detection approaches:**
  1. Vibration and high-pass pressure events (Pacinian-like, tens to hundreds of Hz). Romano et al. 2011 used high-pass-filtered fingertip pressure and hand accelerometer signals on a PR2 to detect contact, slip and release events [V R62].
  2. Shear-field or marker displacement. Incipient slip shows first at the contact periphery [R60].
  3. Force-ratio monitoring: compare tangential/normal force against an estimated μ.
- **Human grip control** (Johansson & Westling) [V R65]:
  - Minimum grip force is `GF_min = LF / μ`, with load force (LF) as the tangential load at the digit.
  - Humans add a small, stable safety margin above slip. After a detected micro-slip they raise the GF/LF ratio to a new stable value.
  - The safety margin is about 10–40 % above the slip ratio [U].
- **Friction cone models** [V R66]:
  - Coulomb point contact: `‖f_t‖ ≤ μ·f_n`.
  - Soft-finger contact adds torsional friction: `|τ_n| ≤ μ_t·f_n`, with elliptic or linearized forms.
  - Grasp-force optimization often linearizes the cone into a k-sided pyramid, `f = F·α, α ≥ 0` (LP or QP). LMI and nonlinear methods are more accurate.
  - Two-finger pinch of weight W [D]: each finger needs `f_n ≥ W/(2μ)`. For W = 10 N and μ = 0.5, that is ≥10 N per finger, plus 20–40 % margin.
- **Typical skin–object μ** is about 0.4–1.5, depending on moisture and material [U]. Use μ ≈ 0.5–0.8 for rubber-padded robot fingertips on common objects [U].

---

## 8. Control architecture and communication

**Typical loop rates:**

| Layer | Rate | Evidence |
|---|---|---|
| PWM / current (FOC) loop | 10–40 kHz sampling; PWM typically ~10–20 kHz; current-loop bandwidth ≈ 1/10 of sampling (~1 kHz at 10 kHz PWM) | [V R67] (example drive: current 16 kHz, speed and position 4 kHz) |
| Joint position / velocity / torque loop | 1–10 kHz | [V R67]; TALOS EtherCAT loop 2 kHz [V R14]; Shadow hand 1 kHz over EtherCAT [V R101] |
| Whole-body control / inverse dynamics QP | 500 Hz–1 kHz | Cheetah 3 WBIC 500 Hz [V R68]; torque control on TALOS 2.3 kHz beneath MPC [V R68] |
| Model predictive control (centroidal / SRBD) | 30–100 Hz | Cheetah 3 convex MPC 30–40 Hz [V R68]; whole-body OCP on 28-DOF humanoid ~100 Hz [V R68] |
| Learned locomotion policy (RL) | ~50 Hz, with PD at ≥1 kHz underneath | [U] (common practice) |
| State estimation (IMU + kinematics EKF) | 500 Hz–1 kHz | IMU 1 kHz, EKF 500 Hz [V R51] |
| Perception / mapping | 10–30 Hz (cameras 15–90 fps) | [V R52][R53] |

**Cascade rule of thumb.** Each inner loop should have 3–10× the bandwidth of the loop outside it [V R67].

**Buses:**

- **EtherCAT** [V R69]:
  - 100 Mbit/s full-duplex Ethernet, processed on the fly.
  - About 100 servo axes in 100 µs; 1000 digital I/O in 30 µs.
  - Distributed clocks (simplified IEEE 1588) give synchronization jitter below 1 µs.
  - Beckhoff drives support cycle times down to 62.5 µs.
  - A humanoid with 30–60 joints at 1–2 kHz fits easily on one ring [D].
- **CAN FD** (ISO 11898-1:2015) [V R70]:
  - Arbitration phase 50 kbit/s–1 Mbit/s.
  - Data phase typically 2–8× faster (up to about 5–8 Mbit/s in practice, 10 Mbit/s max).
  - Payload up to 64 bytes. Classical CAN is limited to 1 Mbit/s and 8 bytes.
- **CAN capacity estimate** [D]:
  - A classical CAN 8-byte frame is about 110–130 bits, so about 8k frames/s at 1 Mbit/s.
  - With one command and one feedback frame per joint per cycle, a 1 kHz loop supports about 3–4 joints per bus.
  - CAN FD at 5 Mbit/s data phase supports about 10–15 joints per bus at 1 kHz.
  - This is why humanoids built on CAN use several parallel buses, or reduce to 500 Hz.

**Safety** [V R71][R72]:
- **Safe Torque Off (STO)**, IEC 61800-5-2, blocks gate drive in hardware so no torque-producing current can flow.
  - It corresponds to IEC 60204-1 stop category 0 (uncontrolled stop).
  - It is achievable to SIL 3 / PL e.
  - Only STO and SS1 (Safe Stop 1: controlled decel, then STO = category 1) may be used for emergency stop, per ISO 13850-related practice.
- **Caveat for bipeds:** STO makes a standing humanoid collapse. ISO 25785-1 (committee draft, 2025) covers "industrial mobile robots with actively controlled stability" (legged and humanoid) that "fall when power is removed" [V R72].
- **Recommended FO-H1 stop behaviour** [D/U]:
  1. Controlled crouch or sit, then SS1-style STO. This is the default for e-stop.
  2. Joint brakes where fitted.
  3. Immediate STO only for faults where continued actuation is more dangerous than falling.
- Also simulate: battery contactor open, precharge fault, over-temperature derating, and a hardware watchdog on the bus cycle (for example, a missed EtherCAT frames threshold triggers a safe state).

---

## 9. Balance and locomotion theory

### 9.1 Linear inverted pendulum and ZMP

Sources: Kajita 2001 3D-LIPM; Kajita 2003 preview control [R73][R74]; Kajita et al. book [R79].

- **Dynamics** with CoM height held at z_c:
  - `ẍ = ω²·(x − p_x)`, with `ω = √(g/z_c)`. Same form in y.
  - Solution for constant ZMP p: `x(t) = p + (x0 − p)·cosh(ωt) + (ẋ0/ω)·sinh(ωt)` [U, standard].
  - Orbital energy `E = ½ẋ² − ½ω²(x − p)²` is conserved for constant p [U, standard].
- **ZMP, cart-table form** [V R73]: `p_x = x − (z_c/g)·ẍ`.
  - Preview control tracks a future ZMP reference.
  - A preview controller can also correct the error between the simple model and the full multibody model [V R73].
- **ZMP definition** (Vukobratović): the point on the ground where the horizontal components of the moment of the contact reaction forces vanish [V R78].
- **Multibody ZMP** [U, standard in Kajita]: `p_x = [Σ m_i (z̈_i + g) x_i − Σ m_i ẍ_i z_i − Σ L̇_{y,i}] / Σ m_i (z̈_i + g)`.
- **Numbers** [D]:

  | z_c | ω | 1/ω |
  |---|---|---|
  | 0.80 m | 3.50 rad/s | 0.286 s |
  | 0.90 m | 3.30 rad/s | 0.303 s |
  | 1.00 m | 3.13 rad/s | 0.319 s |

  A 1.72 m human has CoM ≈ 0.55–0.56·H ≈ 0.95 m standing [V R91]. Robots walk with bent knees, so z_c ≈ 0.80–0.90 m.

### 9.2 Capture point / divergent component of motion (DCM)

Sources: Pratt 2006; Koolen 2012; Englsberger 2015 [R75][R76][R77].

- **Instantaneous capture point** (DCM for LIPM): `ξ = x + ẋ/ω`.
  - Dynamics: `ξ̇ = ω·(ξ − p)`, which is unstable. The CoM converges to it stably: `ẋ = −ω·(x − ξ)`.
  - If ξ lies inside the support polygon, the robot can stop without stepping ("0-step capturable").
  - N-step capturability generalizes this [V R76].
  - 3D DCM control uses eCMP and VRP [V R77].
- **Step placement** [D]: after swing time t_s, `ξ(t_s) = p + (ξ0 − p)·e^{ω t_s}`. Place the next CoP at or slightly beyond ξ(t_s), within reach.
- **Example** [D]: ẋ = 1.2 m/s with ω = 3.3 rad/s gives ξ − x = 0.36 m, which is larger than a half foot length (~0.13 m). Walking is a controlled fall that needs a step every ~0.5 s.
- **Push-recovery hierarchy** [V R75][R76][R81]:

  | Strategy | Mechanism | When used (humans) |
  |---|---|---|
  | Ankle | Move the CoP within the foot; body rotates as a rigid segment about the ankle | Small or slow perturbations |
  | Hip | Use centroidal angular momentum (the flywheel/reaction-mass model of Pratt 2006 and Koolen model 3) to move the CMP outside the CoP: `x_CMP = p − L̇_y/(m·g)` [U sign convention] | Larger or faster perturbations, or a narrow support base |
  | Step | Change the base of support | ξ outside the reachable CMP region |

  Human numeric thresholds between strategies are not verified [U].
- **Ankle-only limit** [D]: standing with CoM over the ankle and CoP able to move d ≈ 0.15 m toward the toes, a push is recoverable without stepping if `|ẋ0| ≤ ω·d ≈ 3.3 × 0.15 ≈ 0.5 m/s`.

### 9.3 Human gait figures (targets for FO-H1 gait)

- **Speed classes:** slow ~0.8, normal ~1.3, fast ~1.8 m/s [D, supported by the following rows].
  - Comfortable gait speed (Bohannon): 1.27 m/s (women in their 70s) to 1.46 m/s (men in their 40s).
  - Maximum gait speed: 1.75 to 2.53 m/s [V R84].
- **At preferred speed** 1.32 ± 0.18 m/s [V R83]:
  - Cadence 112 ± 7 steps/min, i.e. 1.87 steps/s, or about 0.54 s per step.
  - Step length 0.71 ± 0.09 m.
  - Check [D]: 0.71 × 1.87 = 1.33 m/s. Step length ≈ 0.41·H for H ≈ 1.72 m. Stride (two steps) ≈ 1.42 m.
- **Clinical cadence range:** 80–110 steps/min [V R82].
- **Walk ratio.** Step length divided by cadence is roughly invariant across preferred-to-fast speeds, with no sex difference after height normalization (Sekiya & Nagasaki) [V R85]. The commonly cited value is about 0.0064 m/(steps/min) [U].
  - Scaling rule [D]: speed rises through both step length and cadence roughly as √. For example, at 1.8 m/s: cadence ≈ 130 steps/min, step ≈ 0.83 m. At 0.8 m/s: cadence ≈ 88 steps/min, step ≈ 0.55 m [D/U].
- **Gait cycle phases** [V R82]:
  - Stance 60 %, swing 40 %.
  - Double support ≈ 20 % of the cycle (two ~10 % periods) at normal speed. It shrinks as speed rises and reaches 0 at running.
- **Walk–run transition** at Froude number `Fr = v²/(g·L) ≈ 0.5` [V R86]. For leg length L ≈ 0.9 m, v ≈ 2.1 m/s [D]. Fr cannot exceed 1 for walking.
- **Foot size:**
  - Foot length is about 15 % of stature, with population variation [V R87]. Drillis–Contini gives 0.152·H [U].
  - Example: males of stature 176.4 cm had foot length 27.3 cm and breadth 10.2 cm [V R87].
  - For H = 1.72 m: about 0.26 × 0.095 m [D]. Robots commonly use slightly shorter, flat, rigid feet with toe or heel roll [U].

---

## 10. Human anthropometrics (Winter; Dempster; Drillis & Contini; de Leva)

### 10.1 Segment lengths as fractions of height H

Source: Drillis & Contini 1966, reproduced in Winter's *Biomechanics and Motor Control of Human Movement*, Fig. 4.1 [R90][U]. Search confirmed the source but not the individual numbers. The values below are from memory, but they are internally consistent: joint-height differences reproduce the segment lengths.

| Landmark height | ×H | Segment length | ×H | For H = 1.72 m [D] |
|---|---|---|---|---|
| Eye | 0.936 | Upper arm (shoulder–elbow) | 0.186 | 0.320 m |
| Chin | 0.870 | Forearm (elbow–wrist) | 0.146 | 0.251 m |
| Shoulder | 0.818 | Hand (wrist–knuckle) | 0.108 | 0.186 m |
| Chest (nipple) | 0.720 | Thigh (hip–knee) | 0.245 | 0.421 m |
| Elbow | 0.630 | Shank (knee–ankle) | 0.246 | 0.423 m |
| Hip (greater trochanter) | 0.530 | Foot length | 0.152 | 0.261 m |
| Wrist | 0.485 | Foot width | 0.055 | 0.095 m |
| Knuckle | 0.377 | Shoulder width | 0.259 | 0.445 m |
| Knee | 0.285 | Hip width | 0.191 | 0.329 m |
| Ankle | 0.039 | – | – | ankle height 0.067 m |

Consistency checks [D]: hip 0.530 − knee 0.285 = 0.245 (thigh). Knee 0.285 − ankle 0.039 = 0.246 (shank). Shoulder 0.818 − elbow 0.630 = 0.188 ≈ upper arm. Elbow 0.630 − wrist 0.485 = 0.145 ≈ forearm.

### 10.2 Segment mass fractions

**Dempster via Winter** [V R88]:
- Hand 0.006; forearm 0.016; upper arm 0.028.
- Foot 0.0145; leg (shank) 0.0465; thigh 0.100.
- Head–neck 0.081; trunk 0.497 (thorax 0.216 + abdomen 0.139 + pelvis 0.142).
- Check [D]: 2 × 0.211 + 0.081 + 0.497 = 1.000.

**De Leva 1996, males** (adjusted Zatsiorsky–Seluyanov, joint-centre referenced):
- Verified [V R89]: trunk 0.4346, thigh 0.1416, shank 0.0433.
- From memory [U]: head 0.0694, upper arm 0.0271, forearm 0.0162, hand 0.0061, foot 0.0137. These sum to 1.000 with the verified values.

**Segment CoM location from the proximal joint** (Winter/Dempster) [V R88]:
- Upper arm 0.436, forearm 0.430, thigh 0.433, leg 0.433, foot 0.50.
- Hand 0.506 [U]. Trunk about 0.50 [U].

**For a 65 kg body, Dempster fractions** [D]:
- Thigh 6.5 kg, shank 3.0 kg, foot 0.94 kg.
- Upper arm 1.8 kg, forearm 1.0 kg, hand 0.39 kg.
- Head–neck 5.3 kg, trunk 32.3 kg.

**Design note for FO-H1** [D/U]:
- Human-like mass fractions put about 21 % of mass in each leg.
- Robots benefit from keeping distal mass lower than human values: mount the knee and ankle motors high and drive them through linkages or screws. Low leg inertia is a stated efficiency principle [R17].
- Keeping the battery in the torso helps lower the CoM [R10].
- Whole-body CoM target: about 0.55–0.57·H standing [V R91].

---

## 11. Materials

| Material | Density (g/cm³) | E (GPa) | Yield (MPa) | UTS (MPa) | Specific stiffness E/ρ [D] | Relative cost | Src |
|---|---|---|---|---|---|---|---|
| Al 6061-T6 | 2.70 | 68.9–69 | 276 | 310 | 25.5 | low | [V R95] |
| Al 7075-T6 | 2.81 | 71.7 | 503 | ~572 [U] | 25.5 | low–medium | [V R94] |
| Ti-6Al-4V (Gr 5, annealed) | 4.43 | 113.8 | 880 | ~950 [U] | 25.7 | high | [V R96] |
| Mg AZ91D (die cast) | 1.81 | 44.8 | 150 | 230 | 24.8 | low–medium (die cast); flammability and corrosion care | [V R97] |
| CFRP quasi-isotropic laminate (T700/epoxy) | ~1.52–1.6 | ~45–70 [U] | n/a (brittle); ~500–800 strength [U] | – | ~30–45 | high | [V R100] density; T700 fibre 4900 MPa / 250 GPa [V R100] |
| CFRP unidirectional (0°) | ~1.55–1.6 | ~120–140 [U] | – | ~2000+ [U] | ~80–90 | high | [U] |
| PEEK (unfilled) | 1.30 | 3.6–4.0 | ~98 | ~100 | ~3 | high (polymer) | [V R98] |
| PA12 (SLS) | 0.93–1.01 | 1.6–1.85 | – | 46–51 | ~1.8 | low (prototyping, covers) | [V R99] |

**Guidance** [D/U]:
- All structural metals have nearly the same specific stiffness, E/ρ ≈ 25. Choose by strength, cost and manufacturability:
  - 6061 for general frames.
  - 7075 for highly loaded links and gear carriers.
  - Ti for small, highly stressed parts and fasteners.
  - Mg die-cast for high-volume housings.
- CFRP wins on stiffness-to-weight for tubular thigh and shank links.
- PA12 and PEEK suit covers, cable guides and low-load brackets.

---

## 12. Hands

- **Human hand.** Around 21–27 DOF are modelled, depending on how palm and wrist joints are counted [U; one model uses 25 DOF excluding the 2-DOF wrist, R107].
- **Human grip strength:**
  - Men aged 18–24: about 40–42 kgf (≈390–410 N).
  - Women aged 18–24: about 24–26 kgf (≈240–255 N) [V R105].
  - Men aged 25–29 range from 37.7 kg (weak) to more than 57.5 kg (strong), i.e. about 370–560 N [V R105].
  - Mathiowetz 1985 norms (tip, key and palmar pinch; 638 adults aged 20–94) are the clinical reference [V R106]. Typical male pinch is about 70–110 N (tip ~80, key ~110, palmar ~110 N) [U].
- **Robot hands:**

  | Hand | Actuators / DOF | Drive | Force | Mass | Src |
  |---|---|---|---|---|---|
  | Shadow Dexterous Hand | 20 actuated DOF + 4 coupled = 24 joints (4×4 fingers, thumb 5, wrist 2) | tendon-driven, 20 DC motors; 129 sensors incl. 40 tendon load sensors; 1 kHz EtherCAT | not verified | 4.3 kg | [V R101] |
  | Inspire RH56DFX | 6 micro linear servos / 6 DOF / 12 joints | linkage | 15 N thumb, 10 N per finger; 8 kg passive load per finger; 260°/s | 540 g | [V R102] |
  | PSYONIC Ability Hand | 6 BLDC / 6 DOF | linkage | power grasp 78 N, key 17 N, pinch 8 N; 30 touch sensors | 440–470 g | [V R103] |
  | Allegro Hand | 16 current-controlled joints (4 fingers) | direct/geared | not verified | – | [V R104] |
  | Optimus Gen 2 hand | 11 DOF; tactile sensing on all fingers | tendon/linkage [U] | not verified | – | [V R10] |
  | Optimus V3 hand (reported) | 22 DOF + 2 wrist; 25 forearm linear actuators | tendons (3 per finger) | not verified | – | [R11] secondary |
  | Figure 02 hand | 16 DOF | electric | "human-like strength" (claimed) | – | [V R5] |
  | Fourier GR-1 hand | 11 DOF | – | – | – | [V R8] |
  | Atlas (2026) | tactile sensing in fingers and palms | – | – | – | [V R13] |

- **Tendon vs linkage.**
  - Tendon-driven hands (Shadow, Optimus V3) move actuators into the forearm. This lowers finger inertia and allows many DOF, at the cost of tendon friction, stretch and routing complexity [V R11][R101].
  - Linkage or underactuated hands (Inspire, Ability) couple joints to 6 actuators. They are robust and cheap but less dexterous [V R102][R103].
- **Force ranges** [D]:
  - Robot hands reach about 8–20 N per fingertip and 20–80 N power grasp.
  - Human power grip is 250–560 N; pinch is about 70–110 N.
  - An FO-H1 target of 15–25 N per fingertip and 60–150 N whole-hand power grasp covers most household and industrial handling (a 5 kg tote held with μ ≈ 0.6 needs roughly 40 N normal per side) [D/U].

---

## Reference list (URLs used, via search results; direct fetch was blocked)

Not directly consulted: Siciliano et al., *Robotics: Modelling, Planning and Control* (Springer, 2009). It was requested as background; no URL was verified this session.

**Humanoid robot specs**
- [R1] https://www.unitree.com/h1 : Unitree H1/H1-2 official page (joint torques, battery, DOF).
- [R2] https://www.pbtech.co.nz/product/TOYUNT0004/Unitree-Humanoid-Robot-Unitree-H1-Unitrees-First-G : H1 retailer spec sheet (dimensions, 15 Ah / 0.864 kWh, 67.2 V).
- [R3] https://stemfinity.com/products/unitree-h1-robotic-humanoid : H1 variants H1-S/H1-M DOF and speed.
- [R4] https://robostore.com/blogs/news/unitree-g1-edu-ultimate-technical-specifications : Unitree G1 specs (1.32 m, 35 kg, 23–43 DOF, 9 Ah, knee 90/120 Nm). Also https://www.unitree.com/mobile/g1
- [R5] https://www.gigazine.net/gsc_news/en/20240808-figure-02-ai-humanoid : Figure 02 (70 kg, 20 kg payload, 2.25 kWh, 5 h, 1.2 m/s, 16-DOF hands, 6 cameras).
- [R6] https://www.therobotreport.com/apptronik-unveils-apollo-humanoid-robot/ : Apptronik Apollo (5'8", 160 lb, 55 lb payload, 4 h swappable). Also https://humanoid.guide/product/apollo/ (71 DOF, aggregator).
- [R7] https://qviro.com/product/agility-robotics/digit/specifications : Agility Digit (1.75 m, 65 kg, 16 kg, 1.2 kWh, 16 DOF, sensors). Also https://robotsguide.com/robots/digit
- [R8] https://www.therobotreport.com/fourier-intelligence-launches-production-version-of-gr-1-humanoid-robot/ : Fourier GR-1 (1.65 m, 55 kg, 40 DOF, 300 Nm hip, 5 km/h).
- [R9] https://www.robotics247.com/article/tesla_shares_more_details_about_optimus_humanoid_robot/Tesla : Optimus AI Day 2022 (2.3 kWh, 73 kg, 28 actuators, 100 W / 500 W, actuator ratings). Also https://www.notateslaapp.com/news/1000/everything-we-know-about-optimus-the-tesla-robot (52 V, single-PCB BMS).
- [R10] https://humanoid.guide/product/optimus-gen2 : Optimus Gen 2 (28 DOF, 11-DOF hands, ~57 kg, 2.3 kWh). Also https://www.electronicsforu.com/news/whats-new/tesla-reveals-upgraded-humanoid-robot-optimus-gen-2 (30 % faster, 10 kg lighter).
- [R11] https://www.basenor.com/blogs/news/tesla-optimus-gen-3-hand-patents-revealed-25-actuators-22-dof : Optimus V3 hand patents (22 DOF, 25 forearm actuators). Secondary.
- [R12] https://www.futura-sciences.com/en/?p=38780 : 1X NEO (≈1.67 m, 30 kg, 842 Wh, ~4 h). Secondary.
- [R13] https://www.robotics247.com/article/ces-2026-boston-dynamics-unveils-new-atlas-humanoid-robot : product Atlas (56 DOF, 50 kg lift, 2.3 m reach, battery self-swap, −20–40 °C). Also https://community.robotshop.com/blog/show/ces-2026-robotics-highlight-atlas-moves-from-prototype-to-product
- [R14] https://robots.ros.org/talos/ : PAL TALOS (EtherCAT 2 kHz, joint torque sensors, ankle and wrist F/T, 1.75 m, 100 kg, 32 DOF).

**Actuators, motors and transmissions**
- [R15] https://dspace.mit.edu/bitstream/handle/1721.1/118671/1057343368-MIT.pdf : Katz MIT thesis, Mini Cheetah actuator (6:1, 17 Nm, 480 g). Also https://arxiv.org/pdf/2202.12395 (open-source actuators and thermal model).
- [R16] https://dspace.mit.edu/handle/1721.1/119863 : Wensing et al. 2017 IEEE TRO, proprioceptive actuator design and impact mitigation factor.
- [R17] https://dspace.mit.edu/handle/1721.1/108096 : Seok et al. 2015 IEEE/ASME TMech, energy-efficiency design principles, Cheetah CoT 0.5 at 6 m/s, 973 W.
- [R18] https://arxiv.org/abs/2104.09025 : MIT Humanoid (Chignoli, Kim, Stanger-Jones, Kim 2021). Actuator numbers not retrieved.
- [R19] https://dspace.mit.edu/bitstream/1721.1/126619/2/IROS.pdf : MIT Cheetah 3 (Bledt et al. 2018). Numbers not retrieved.
- [R20] https://www.robotshop.com/products/cubemars-ak80-64-kv80-ak-series-robotic-actuator : CubeMars AK80-64 specs.
- [R21] https://store.cubemars.com/products/ak10-9-v2-0-kv60 : CubeMars AK10-9 V2 specs.
- [R22] https://www.robotshop.com/products/cubemars-ri80-kv75-ri-series-frameless-inrunner-torque-motor : RI80 frameless motor specs. Also https://www.cubemars.com/goods-860-RI80+V20.html (RI series table).
- [R23] https://www.motioncontroltips.com/kollmorgen-introduces-kbm-series-frameless-brushless-motors-for-tightly-integrated-motion-applications/ : Kollmorgen KBM range, 155 °C windings. Also https://www.wakeindustrial.com/buy/kollmorgen/kbm-brushless-motor-series/KBM-35H01-020 (KBM-35H01 data).
- [R24] https://www.wevolver.com/article/meet-the-unitree-h1-a-humanoid-general-purpose-robot-starts-a-new-industrial-revolution : Unitree M107 motor (360 Nm, 189 Nm/kg).
- [R25] https://www.harmonicdrive.net/_hd/content/documents/csf-csg.pdf : Harmonic Drive CSF/CSG catalog (ratios, efficiency dependence). Also the CSG-2UK brochure (CSG-25-100 torques).
- [R26] https://www.nabtesco.de/en/products/cycloidal-gears/rv-n : Nabtesco RV / RV-N (efficiency up to 85 %, ratios 57–192).
- [R27] https://ineedmicromotors.com/planetary-transmission-gear-powerful-efficient/ : planetary efficiency (~97 % single stage, ~94 % two stages).
- [R28] https://patents.google.com/patent/US9605742 : strain-wave gearing patent (60–90 % efficiency, up to 85 % rated; 30–320:1).
- [R29] https://holistic.news/en/planetary-roller-screws-essential-for-robotics/ : planetary roller screws (85–90 %, 3–6× load and 10–15× life vs ball screw, Optimus calves). Also https://humanoid.guide/?p=16316
- [R30] https://arxiv.org/abs/2410.16591 : Cycloidal QDD actuator (Zhu, Tanaka, Rafeedi, Hong 2024; 10:1).
- [R31] https://www.motioncontroltips.com/how-do-gearmotors-impact-reflected-mass-inertia-from-the-load/ : reflected inertia N². Also https://arxiv.org/pdf/2004.00467 (QDD backdrivability).
- [R32] https://www.firgelliauto.com/blogs/engineering-calculators/bldc-kv-to-kt-converter : Kv–Kt conversion. Also https://community.simplefoc.com/t/torque-calculation-of-a-bldc-motor/192 (8.27/Kv convention).

**Motor thermal**
- [R33] https://engineeringtoolbox.com/nema-insulation-classes-d_734.html : NEMA insulation classes and temperature rises.
- [R34] https://cirris.com/temperature-coefficient-of-copper/ : copper TCR 0.00393/°C and correction formula.
- [R35] https://www.maxongroup.com/medias/sys_master/root/9399156408350/Cataloge-Page-EN-180.pdf : maxon thermal resistance and time constant examples.
- [R36] https://arxiv.org/html/2603.01631v1 : thermal-aware locomotion (first-order thermal model; 7 → 27 min).

**Battery and power**
- [R37] https://www.nkon.nl/molicel-inr21700-p45b-4500mah-45a.html : Molicel P45B specs. Also https://www.imrbatteries.com/content/molicel_p45b.pdf
- [R38] https://www.akkuteile.de/en/lithium-ionen-battery/size-21700/samsung/samsung-inr21700-50s-5000mah-max-45a-3-6-3-7v-lithium-ion-battery_100671_3335 : Samsung 50S specs.
- [R39] https://lacey.se/2023/01/31/gap-between-theory-and-practice : cell vs pack specific energy (150–200 Wh/kg pack).
- [R40] https://iisb-foxbms.iisb.fraunhofer.de/foxbms/docs/latest/system/precharging.html : foxBMS precharge (inrush up to 1000 A, resistor and contactor sequence).
- [R41] https://media.monolithicpower.cn/mps_cms_document/m/p/mps_powers_humanoid_robots_9-23-2025.pdf : MPS humanoid power architecture. Also https://www.powersystemsdesign.com/articles/powering-dexterity-in-humanoid-robots/30/23659 (48 V bus, SELV, isolated bus).
- [R42] https://en.wikipedia.org/wiki/Extra-low_voltage : ELV 120 V DC, IEC 62368-1 ES1 60 V DC. Also https://www.ieee802.org/3/ad_hoc/PDCC/public/2021/ES1_LPS_SELV_1_0821.pdf
- [R43] https://www.18650batterystore.com/products/eve-50e-21700-5000mah-15a-battery : 21700 temperature windows and cycle life (EVE 50E; Samsung 50E similar).
- [R44] https://thundersaidenergy.com/downloads/humanoid-robots-and-robotics-companies/ : humanoid energy review (~500 W average, 10 % compute, 1.3 kWh → 3+ h).
- [R45] https://faculty.washington.edu/minster/bio_inspired_robotics_2018/papers/Collins_science_suppmaterial2005.pdf : Collins et al. 2005 Science supplement (CoT: ASIMO 3.2, human 0.05 mechanical, Cornell biped).
- [R46] https://www.cmu.edu/dynamic-walking/files/abstracts/Renjewski_2013_DW.pdf : ATRIAS CoT 1.3.
- [R47] https://arxiv.org/pdf/2409.19795 : Duke Humanoid (humanoids CoT > 0.7 vs human 0.2; ASIMO 3.2 at 0.4 m/s).
- [R48] https://arxiv.org/pdf/1809.07279 : Cassie feedback control (31 kg, ~4 kg battery, leg structure).

**Sensors**
- [R49] https://www.bosch-sensortec.com/media/boschsensortec/downloads/product_flyer/bst-bmi088-fl000.pdf : BMI088 flyer. Also https://cdn.sparkfun.com/assets/c/c/e/4/7/BMI088_Datasheet.pdf
- [R50] https://invensense.tdk.com/?p=9240 : ICM-42688-P datasheet page.
- [R51] https://www.microstrain.com/sites/default/files/3dm-gx5-25_datasheet_8400-0093_1.pdf : 3DM-GX5-25 datasheet.
- [R52] https://www.intel.com/content/www/us/en/ark/products/128255.html : RealSense D435. Also https://support.realsenseai.com/hc/en-us/articles/360059129453-Depth-accuracy-for-Intel-RealSense-D400-Series-Cameras
- [R53] https://robu.in/wp-content/uploads/2024/06/ZED_2i_Datasheet.pdf : ZED 2i datasheet.
- [R54] https://novanta.com/robotics-automation/product/mini45-force-torque-sensor/ : ATI Mini45.
- [R55] https://newequipment.com/home/product/55103225/24461-ati-industrial-automations-low-cost-torque-sensor-axia80 : ATI Axia80.
- [R56] https://www.infineon.com/assets/row/public/documents/24/49/infineon-as5048l-datasheet-en.pdf : AS5048 14-bit encoder.
- [R57] https://www.rls.si/eng/aksim-2 : RLS AksIM-2 20-bit off-axis encoder.
- [R58] https://www.motioncontroltips.com/new-servo-actuators-feature-dual-absolute-encoder-panel-mount-connectors/ : Harmonic Drive dual 14-bit encoders. Also https://pure.korea.ac.kr/en/publications/b-spline-based-torque-estimation-algorithm-using-dual-encoders/
- [R59] https://apps.dtic.mil/sti/tr/pdf/ADA299658.pdf : Pratt & Williamson series elastic actuators. Also https://www.ftp.ai.mit.edu/people/matt/ms_thesis.pdf
- [R60] https://pmc.ncbi.nlm.nih.gov/articles/PMC5751610 : Yuan, Dong, Adelson 2017 GelSight (Sensors). Also https://arxiv.com/abs/1708.00922 (slip).
- [R61] https://whiteoak.umd.edu/roswiki/BioTac.html : BioTac modalities. Also https://www.syntouchllc.com/Products/BioTac/Sensory-Modalities
- [R62] https://is.tuebingen.mpg.de/publications/romano11-tro-grasp : Romano et al. 2011 IEEE TRO, tactile grasp control and slip.
- [R63] https://www.doi.org/10.3390/S17112653 : tactile sensor technology review. Also https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8747637/
- [R64] https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3772339/ : two-point discrimination. Also https://en.wikipedia.org/wiki/Mechanoreceptor (receptor bands) and https://arxiv.org/pdf/2003.06965 (visuotactile resolution and rate).
- [R65] https://pmc.ncbi.nlm.nih.gov/articles/PMC3661894 : grip force / load force, safety margin (Johansson & Westling framework). Also https://link.springer.com/doi/10.1007/BF00238156
- [R66] https://pages.github.berkeley.edu/EECS-106/sp22-site/assets/scribe_notes/scribe_lec_9A.pdf : friction cones and soft-finger contact. Also https://arxiv.org/pdf/1801.06558

**Control, buses and safety**
- [R67] https://www.ti.com/document-viewer/lit/html/SPRACO3/current-loops-in-servo-drives-x852 : TI current loops (bandwidth ≈ fs/10, loop rates). Also https://www.synapticon.com/en/motion-control-academy/kaskadierte-positionsregelung
- [R68] https://arxiv.org/pdf/2506.14278 : WBC framework (Cheetah 3 MPC ~40 Hz + WBIC 500 Hz; TALOS torque 2.3 kHz). Also https://arxiv.org/pdf/2004.07699
- [R69] https://www.motioncontroltips.com/what-is-ethercat : EtherCAT performance. Also https://www.beckhoff.com/en-au/products/motion/servo-drives/ax8000-multi-axis-servo-system/ (62.5 µs).
- [R70] https://www2.can-cia.org/can-knowledge/can/can-fd : CAN FD basics. Also https://kvaser.com/?p=39004
- [R71] https://www.synapticon.com/en/motion-control-academy/safe-torque-off-sto-safe-brake-control-sbc : STO/SBC (IEC 61800-5-2). Also https://download.sew-eurodrive.com/download/html/31960413/en-EN/28733575051.html
- [R72] https://www.iso.org/standard/91469.html : ISO/CD 25785-1 (actively stable mobile robots). Also https://www.i-scoop.eu/iso-25785-1-explained-and-what-it-means-for-humanoid-robot-safety/

**Balance and locomotion theory**
- [R73] https://people.csail.mit.edu/katiebyl/kb/DW2008/papers_of_tangential_interest/kajita03.pdf : Kajita et al. 2003 ICRA, ZMP preview control (cart-table).
- [R74] https://unit.aist.go.jp/jrl-22022/assets/bib/kajita_iros_2001.bib : Kajita et al. 2001 IROS, 3D-LIPM.
- [R75] https://cs.utexas.edu/~shivaram/readings/b2hd-PrattCDG2006.html : Pratt et al. 2006, Capture Point.
- [R76] https://research.tudelft.nl/en/publications/capturability-based-analysis-and-control-of-legged-locomotion-par/ : Koolen et al. 2012 IJRR, capturability.
- [R77] https://elib.dlr.de/96741 : Englsberger, Ott, Albu-Schäffer 2015 IEEE TRO, 3D DCM.
- [R78] https://cs.utexas.edu/~shivaram/readings/b2hd-VukobratovicBorovac2005.html : Vukobratović & Borovac, "ZMP — 35 years".
- [R79] https://www.sack.de/kajita-hirukawa-harada-introduction-to-humanoid-robotics/9783642545368 : Kajita et al., *Introduction to Humanoid Robotics* (Springer STAR 101, 2014).
- [R80] https://www.springer.com/de/book/9780387743141 : Featherstone, *Rigid Body Dynamics Algorithms* (2008), articulated-body algorithm.
- [R81] https://www.frontiersin.org/journals/bioengineering-and-biotechnology/articles/10.3389/fbioe.2018.00048/pdf : ankle, hip and step strategies. Also https://pmc.ncbi.nlm.nih.gov/articles/PMC5144705

**Human gait and anthropometry**
- [R82] https://medicine.missouri.edu/sites/default/files/pm-r/Normal_Gait.pdf : normal gait (60/40 stance/swing, ~20 % double support, cadence).
- [R83] https://pubmed.ncbi.nlm.nih.gov/11292147/ : gait parameters at preferred speed (1.32 m/s, 112 steps/min, 0.71 m).
- [R84] https://academic.oup.com/ageing/article/26/1/15/35875 : Bohannon 1997, comfortable and maximum gait speed norms.
- [R85] https://www.bisp-surf.de/Record/PU199608109578 : Sekiya & Nagasaki, invariant walk ratio.
- [R86] https://en.wikipedia.org/wiki/Transition_from_walking_to_running : Froude ≈ 0.5 walk–run transition. Also https://pmc.ncbi.nlm.nih.gov/articles/PMC1617162
- [R87] https://tdl-ir.tdl.org/handle/2346/8468 : foot length ≈ 15 % of stature. Also https://ejfs.springeropen.com/articles/10.1186/s41935-018-0094-2/tables/1 (foot dimensions).
- [R88] https://nbviewer.jupyter.org/github/demotu/BMC/blob/master/notebooks/BodySegmentParameters.ipynb : Dempster/Winter BSP tables (BMClab). Also https://wiki.has-motion.com/Segment_Mass
- [R89] https://ebm.ufabc.edu.br/wp-content/uploads/2013/12/Leva-1996.pdf : de Leva 1996 J Biomech. Also https://wiki.has-motion.com/Adjusted_Zatsiorsky-Seluyanov%27s_segment_inertia_parameters
- [R90] https://ojs.ub.uni-konstanz.de/cpa/article/view/292/249 : Drillis & Contini proportions (context: children study citing Winter).
- [R91] https://www.revisiondojo.com/ib/ib-sehs/4-3-3-define-the-term-centre-of-mass/notes : CoM ≈ 55–57 % of height. Also https://media.isbweb.org/images/conf/2009/data/pdf/504.pdf
- [R92] https://arxiv.org/pdf/2511.06796 : "Human-Level Actuation for Humanoids" (humanoid joint speed samples 14–20 rad/s; HLAS metric).
- [R93] https://biomch-l.isbweb.org/forum/biomch-l-forums/biomch-l-1988-2010/4462-knee-hip-moments-at-push-off : push-off joint moments (knee 0.85, hip 1.35 Nm/kg). Also https://clinicalgaitanalysis.com/faq/moment.html

**Materials**
- [R94] https://docs.ntop.com/Product-Documentation/ntop/block-documentation/blocks/design-analysis/sample-materials/al-7075-t6 : Al 7075-T6.
- [R95] https://en.wikipedia.org/wiki/6061_aluminium_alloy : Al 6061-T6.
- [R96] https://www.ulbrich.com/alloys/ti-6-al-4-v-uns-r56400/ : Ti-6Al-4V. Also https://www.smithmetal.com/pdf/titanium/ti-6al-4v-grade-5.pdf
- [R97] https://makeitfrom.com/material-properties/AZ91D-M11916-Magnesium : AZ91D. Also https://www.totalmateria.com/en-us/material/3130144
- [R98] https://www.makeitfrom.com/material-properties/Unfilled-PEEK : PEEK. Also https://www.victrex.com/en/downloads/datasheets/victrex-450g-mic-peek-polymer
- [R99] https://info.sculpteo.com/hubfs/Material%20documentation/SLS/Nylon%20PA12/TDS%20SLS%20PA12%20Generic%20Sculpteo_V3.pdf : PA12 SLS. Also https://craftcloud3d.com/material-guide/sls-nylon-pa12
- [R100] https://dragonplate.com/quasi-isotropic-carbon-fiber-uni-sheet-332-x-24-x-36 : QI CFRP density and T700 fibre properties. Also https://www.rockwestcomposites.com/204-24.html

**Hands and grip**
- [R101] https://www.wevolver.com/article/dexterous-robotic-hands-part-2-how-the-shadow-dexterous-hand-is-revolutionizing-robotics : Shadow Hand. Also https://robotsguide.com/robots/shadow
- [R102] https://www.knoxlabs.com/products/inspire-robots-rh56dfx-dexterous-hand : Inspire RH56DFX.
- [R103] https://www.knoxlabs.com/products/psyonic-ability-hand-robotics-edition : PSYONIC Ability Hand. Also https://humanoid.guide/product/ability-hand/
- [R104] https://www.wevolver.com/specs/allegro.hand : Allegro Hand.
- [R105] https://www.topendsports.com/testing/norms/handgrip.htm : grip norms. Also https://anais.unievangelica.edu.br/index.php/CIPEEX/article/view/13176 (18–24 y norms).
- [R106] https://www.scinapse.io/papers/1586793705 : Mathiowetz 1985 grip and pinch norms. Also https://www.topendsports.com/testing/tests/pinch-grip-strength.htm
- [R107] https://recercat.cat/handle/2117/170698?show=full : virtual human hand model (25 DOF + 2 wrist).
- [R109] https://interestingengineering.com/innovation/figure-02-worlds-most-advanced-humanoid-robot : Figure 02 (16-DOF hands, up to 150 Nm).
- [R110] https://public.websites.umich.edu/~mvs330/w98/inclinedjog/results2.html : knee angular velocity in running (389°/s).
