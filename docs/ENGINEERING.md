# FO-H1 — engineering reference

FO-H1 is an original adult-size electric humanoid designed for this simulation. It is not a
copy of any robot: public specifications of existing humanoids were used only as ranges
(section 11). Everything the interface shows comes from one specification (`src/spec/`) and the
models in `src/engine/`, and each value carries its provenance:

| Mark | Meaning |
|---|---|
| **Calculated** | computed live by the equations below from other values |
| **Design value** | a choice in FO-H1's specification (it is an unbuilt design: nobody measured it) |
| **Estimate** | an engineering assumption from published data for comparable components, or first-principles sizing |
| **Visual approximation** | drawn for legibility only (slowed rotor, scaled arrows, heat spread, choreography) |

The models are *reduced-order*: the kind used to size a machine and reason about it, not a
full multibody-contact simulation. Section 10 lists what they leave out; section 9 describes
how the motion is presented (blending, hand-overs, the presentation clock, the camera).

---

## 1. The machine

| | Value | Mark |
|---|---|---|
| Height | 1.72 m | design |
| Mass (without payload) | 66.3 kg (sum of ~200 component items) | calculated |
| Mass by subsystem | actuators 29.5 kg (44 %), structure 13.3, power 12.4, shell 5.0, compute 2.0, sensors 1.8, hands 1.4, wiring 1.0 | calculated |
| Standing COM height | 0.99 m (57.8 % of height; human ≈ 55–57 %) | calculated |
| Actuated joints | 29 in the body + 6 per hand (11 hand joints, 5 coupled) | design |
| Leg | thigh 0.42 m, shin 0.40 m, ankle height 0.085 m, foot 0.25 × 0.105 m | design |
| Arm | upper arm 0.29 m, forearm 0.25 m, palm 0.075 m (reach 0.615 m) | design |
| Payload | 20 kg rated (held against the body, both hands), 30 kg maximum | design |
| Walking | 0.5 / 1.0 / 1.5 m/s gaits; 0.5 m/s when carrying | design |

Segment proportions follow human anthropometry (Winter; Dempster; de Leva) scaled to the
height; the hips are 0.18 m apart. The spec is `src/spec/body.ts` (joints, limits, the mass
budget) and `src/spec/motion.ts` (gaits, payload).

### Joints

Legs: hip yaw (A80), hip roll and hip pitch (A100), knee (A100, mounted high on the thigh,
driving the knee through a push rod), ankle pitch and roll (two linear actuators per foot in
parallel). Torso: waist yaw. Arms: shoulder pitch (A80), shoulder roll and upper-arm yaw
(A60), elbow (A80), wrist yaw, pitch and roll (A45). Neck: yaw and pitch (A45). Hands: six
coreless micro-motors each (four fingers, thumb flexion and opposition), lead-screw driven so a
grasp holds without current.

---

## 2. Actuators (`src/engine/actuator.ts`, `src/spec/actuators.ts`)

Each rotary actuator is a frameless permanent-magnet synchronous motor with its own drive
(field-oriented control), dual absolute encoders, a reducer and a crossed-roller output
bearing. The motor is modelled in DC-equivalent form:

- Torque: τm = Kt(I)·I, with Kt falling linearly by 12 % between 55 % and 100 % of peak
  current (magnetic saturation).
- Voltage: V = I·R(T) + Kt·ωm, with R(T) = R20·(1 + 0.00393·(T − 20)) (copper).
- The usable voltage is 95 % of the bus; if V would exceed it, the current is reduced
  (the voltage limit is what caps top speed).
- Reducer: τout = τm·N·η when the motor drives; τout = τm·N/η_b when the load back-drives
  the motor. Friction at the motor shaft: Coulomb τc·sat(ωm/2) plus viscous b·ωm.
- Efficiency by type and ratio: η(N) = η0 − s·log10(N / Nref) (planetary 0.95 / 0.07 / 6;
  cycloidal 0.88 / 0.06 / 30; strain wave 0.78 / 0.12 / 50). Back-driving loses more:
  η_b = 1 − k·(1 − η), k = 2.2 (planetary), 2.7 (cycloidal), 2.3 (strain wave).
- Reflected inertia: J = N²·J_rotor·(1 + input-stage fraction).
- Thermal: two nodes, winding and housing.
  C_w·dT_w/dt = P_cu − (T_w − T_h)/R_wh; C_h·dT_h/dt = (T_w − T_h)/R_wh + P_fr − (T_h − T_a)/R_ha.
  Drives derate the current limit linearly from 120 °C to zero at 140 °C (insulation class F,
  155 °C).
- **Continuous ratings are derived, not typed in**: the current whose copper loss holds the
  winding at 120 °C in steady state, I_c = √((120 − T_a)/(R_wh + R_ha) / R(120)), and its torque.

| Family | Motor | Reducer | Peak torque | Continuous | No-load speed | Reflected inertia | Mass | Used at |
|---|---|---|---|---|---|---|---|---|
| A100 | F100 (Kt 0.14 Nm/A, 80 A) | cycloidal 30:1 | 260 Nm | 69 Nm | 11.4 rad/s | 0.34 kg·m² | 2.1 kg | hip roll, hip pitch, knee, waist |
| A80 | F80 (Kt 0.085, 50 A) | cycloidal 40:1 | 129 Nm | 44 Nm | 14.1 rad/s | 0.22 kg·m² | 1.25 kg | hip yaw, shoulder pitch, elbow |
| A60 | F60 | planetary 25:1 | 40 Nm | 10 Nm | 38 rad/s | 0.025 kg·m² | 0.72 kg | shoulder roll, arm yaw |
| A45 | F45 | strain wave 100:1 | 21 Nm | 10 Nm | 17 rad/s | 0.12 kg·m² | 0.38 kg | wrists, neck |
| Ankle | F50, 2:1 belt, 4 mm ball screw | — | 1.6 kN (185 Nm pitch with the pair) | 0.78 kN (90 Nm) | 6.6 rad/s | — | 0.55 kg | ankle pitch/roll |
| Finger | 12 mm coreless, 16:1, 0.5 mm lead screw | — | 15 N at the fingertip | — | — | — | — | hands |

(Values at the 50.4 V nominal bus, calculated from the frames in `src/spec/actuators.ts`.)

Motor constants, resistances, friction and thermal resistances are **estimates** in the range
of published frameless-motor and robot-actuator datasheets of the same diameter
(Kollmorgen KBM, CubeMars RI/AK, MIT Cheetah actuator; see references R15–R24).

**Explore → Actuators** replays one stride of walking at 1.0 m/s (recorded from the gait
simulation) through the selected actuator's model: output torque and speed → motor torque,
speed, current, voltage, electrical power, losses, efficiency, with the winding temperature
integrated in real time. The rotor is drawn at one eighth of the real speed (visual).

### The joint lab (`src/engine/jointLab.ts`)

The knee on a test stand, thigh horizontal, lifting its shin and foot plus a payload at the
ankle cuff (0.38 m). Simulated at 10 kHz: minimum-jerk trajectory → joint controller (PID +
model feed-forward at 1 kHz, gains scaled with inertia for ~9 Hz bandwidth; the feed-forward
knows the shin but not the payload) → current loop (first order, 1.5 kHz bandwidth, current and
voltage limits) → motor torque → reducer (forward/backward efficiency, friction, stiction band at
rest) → joint dynamics (link + payload + N²·J_rotor, gravity τ = (m r)·g·cos θ) → 19-bit output
encoder. With a 9 : 1 reducer and 20 kg the actuator cannot hold the leg straight (torque
saturation); a fast 20 kg lift at 30 : 1 hits the 80 A current limit.

---

## 3. Battery and power (`src/engine/battery.ts`, `src/engine/power.ts`)

| | Value | Mark |
|---|---|---|
| Cells | 126 × 21700 (4.5 Ah, 3.6 V, 15 mΩ, 69 g), 14S9P | design / estimate |
| Pack | 50.4 V nominal (42–58.8 V), 40.5 Ah, 2.04 kWh, 1.84 kWh usable (90 %) | calculated |
| Pack mass | 11.5 kg incl. 32 % overhead (holders, busbars, BMS, enclosure) → 178 Wh/kg | calculated |
| Under 60 V DC | yes (extra-low voltage, IEC 62368-1 ES1) | calculated |
| Contactors / fuse | 150 A continuous, 250 A for 10 s | design |
| Pre-charge | 22 Ω into ~6.4 mF of drive DC links: τ = 0.14 s, 95 % in 0.42 s (a 2.9 kA inrush without it) | calculated |

- Open-circuit voltage from a typical NMC curve (table in `src/spec/power.ts`), internal
  resistance rising at low temperature and low charge; terminal voltage V = OCV − I·R;
  pack heat I²R; state of charge integrated from the current.
- Power at the battery = Σ joint electrical power / 0.97 (drives) + 1.2 W standby per drive +
  low-voltage loads (perception computer, real-time controller, sensors, network, fans) / 0.92
  (isolated DC/DC). Regenerated power (a joint braking) returns to the bus.
- Runtime = usable energy / average power (live in the labs: battery power averaged over the
  last 3 s, a few strides when walking).

Results (default design): standing ≈ 152 W → 12.7 h; walking 1.0 m/s ≈ 444 W → 4.4 h;
mixed work ≈ 6.5 h. With 20 kg carried at 0.5 m/s: 535 W.

---

## 4. Mass, balance and dynamics

- **Centre of mass**: Σ mᵢ·rᵢ / Σ mᵢ over every mass item placed on its segment, for the
  current pose; a payload is a point mass between the palms.
- **Support polygon**: convex hull of the sole corners that touch the floor (within 3.5 mm).
  **Stability margin**: signed distance from the capture point to its edge.
- **Joint torques** (`src/engine/dynamics.ts`, `motionDynamics.ts`): Newton–Euler over the
  distal subtree of each joint: τ = axis · Σ [ (rᵢ − p) × mᵢ (aᵢ − g) ] − axis · Σ (r_c − p) × F_c,
  with segment accelerations from the motion (finite differences at 100 Hz for walking, filtered
  frame differences otherwise), the ground reaction shared between the feet by the
  zero-moment point, and the rotor's reflected inertia added (N²·J·q̈).
- **Zero-moment point** from whole-body moment balance: x_zmp = M_z / F_y (and likewise z).
- **Linear inverted pendulum**: ẍ = ω²(x − p), ω = √(g/z_c), z_c = 0.93 m. **Capture point**
  ξ = x + ẋ/ω.

### Push recovery (`src/engine/balance.ts`)

Divergent component of motion control (Englsberger et al. 2015): the desired centre of pressure
p = ξ + (k/ω)(ξ − ξ_ref), k = 2.2 s⁻¹, clamped to the support polygon with a 12 mm margin
(**ankle strategy**). When it saturates and ξ is outside the support, a 110 Nm, 0.25 s hip-torque
burst shifts the centroidal moment pivot by τ/(m g) (**hip strategy**, the torso swings).
If ξ is still outside, a step lands on the capture point predicted at touchdown (step time
0.40 s, max 0.62 m, min width 0.14 m) (**stepping**). A push no step can catch is reported as a
loss of balance; the robot is then restored (a real one would execute a protective fall).
After recovery the feet are walked back to the stance quasi-statically (COM over the stance
foot, step, COM back).

### Walking (`src/engine/gait.ts`, `src/engine/preview.ts`, `src/engine/wholebody.ts`)

- Footstep plan (step length and time per gait, 0.18 m step width); the first step is half
  length.
- ZMP reference rolling heel-to-toe on the stance foot (0 → 0.165 m), then moving to the next
  foot during double support.
- **Preview control** of the cart–table model (Kajita et al. 2003): LQ tracking gains with a
  1.6 s preview, gains rescaled so the steady-state error is zero.
- Swing feet on quintic paths with a clearance bump, continuing the toe-off motion; heel strike
  and toe-off are rotations about the sole's heel and toe edges (no sliding).
- COM height: stance-knee bend in single support, a dip in double support set by leg reach,
  joined by a cosine at the step frequency (the vertical rhythm leaves and enters the
  starting and stopping double supports at the single-support rate, so there is no kink); a soft
  reach limit lowers the pelvis where a leg would straighten.
- Whole-body posture: legs by closed-form inverse kinematics to the planned feet; the pelvis
  moved so the whole-body COM (arms, payload included) matches the planned COM; arms swing with
  the opposite leg; the pelvis turns and rolls slightly.
- On the treadmill the belt follows the COM's planned speed plus a gentle centring term; a
  foot on the belt moves with the belt, so it cannot slide.

Results at 1.0 m/s: battery ≈ 444 W, mechanical ≈ 111 W, copper ≈ 151 W, cost of transport
P/(m g v) ≈ 0.68 (a walking person ≈ 0.2; published electric humanoids ≥ 0.7, ASIMO 3.2 —
R45–R47). Peak knee torque ≈ 120–150 Nm, peak ankle pitch ≈ 155 Nm, hottest steady winding
(hip pitch) ≈ 98 °C.

---

## 5. Kinematics (`src/engine/skeleton.ts`, `src/engine/ik.ts`)

- Forward kinematics on the 29-joint tree (homogeneous transforms from each joint's origin and
  axis).
- Legs: closed-form inverse kinematics (hip yaw from the foot heading, then a planar two-link
  solution for hip pitch and knee, ankle pitch and roll to hold the sole's orientation).
- Arms: damped least squares on seven joints, Δq = Jᵀ(JJᵀ + λ²I)⁻¹e, λ = 0.06, with a
  posture term projected into the null space (a natural elbow), joint limits clamped; optional
  palm orientation (6-D task). An unreachable target leaves the palm at the closest point,
  with the joints at their limits reported.
- Workspace: sampled by forward kinematics over the joint ranges.

---

## 6. Grasping and touch (`src/engine/grasp.ts`)

Two-contact friction grasp: the object is held while m·(g + a) ≤ 2·μ·N. The controller aims
for N* = m(g + a)/(2 μ̂)·s (s = 1.5, 1.25 for fragile objects), capped below the crush force and
the finger actuators' 40 N, changing at ≤ 55 N/s. The weight transfers from the table to the hand
over the first 0.55 s of a lift. Near the friction limit the edge of the contact slips first
(partial slip) and the tactile skin sees a 50–400 Hz vibration; in gross slip the object slides at
(m(g + a) − 2 μ_k N)/m. Detection (vibration or slip) re-estimates μ̂ from the shear/normal ratio
and raises the grip. Friction coefficients and crush forces are estimates.

---

## 7. Structure (`src/engine/structure.ts`, `src/spec/materials.ts`)

Limb members as thin-walled tubes in bending: A = π/4 (D² − d²), I = π/64 (D⁴ − d⁴),
σ = M·(D/2)/I, design moment = 3 × the joint's peak torque (a stumble or hard landing).
Leg tubes Ø50 × 2 mm, 7075-T6: σ = 223 MPa, safety factor 2.25, tip deflection 3.7 mm.
Arm tubes Ø36 × 1.8 mm: safety factor 4.4. Material data: 6061-T6, 7075-T6, Ti-6Al-4V,
quasi-isotropic CFRP, 4140 steel, AZ91 magnesium (R94–R100). A first sizing check only.

---

## 8. Sensing and computing (`src/spec/sensing.ts`, `src/engine/sensing.ts`)

- Head stereo pair: 80 mm baseline, 1280 × 800, 87° HFOV (f ≈ 674 px), σ_d = 0.1 px:
  depth error σ_z = z²·σ_d/(f·B): 0.5 mm at 0.5 m, 1.9 mm at 1 m, 7.4 mm at 2 m, 3 cm at 4 m.
  The robot's view in Explore → Vision is rendered from the left camera's pose (image, depth
  along the optical axis as a colour ramp, and object classes); it is not a simulated image
  sensor (no noise, blur or rolling shutter).
- IMU in the pelvis (1 kHz), complementary filter (τ = 0.5 s) in the tests.
- Six-axis force/torque sensors in the ankles (2.5 kN) and wrists (500 N); tactile skins with
  16 taxels per fingertip.
- Computers: perception and planning (10–30 Hz), real-time whole-body control (1 kHz), joint
  drives (20 kHz current loops); EtherCAT to the drives, CAN FD in the hands, hard-wired safe
  torque off from a separate safety controller.

---

## 9. Motion and presentation (`src/world/`, `src/scene/camera/`)

What is drawn is a presentation of the models above; this section says how it is kept
continuous and honest. None of it changes a computed value.

- **One displayed pose** (`world/pose.ts`). Pose sources (idle, walking, balance, reaching,
  manipulation) each produce a target; the pose driver shows one. A change of source, or of a
  source's posture (an idle preset, carrying or not), starts an inertialized blend: the displayed
  pose is the target plus an offset that decays to zero on a quintic, starting with the offset's
  own velocity, so nothing jumps and nothing restarts from rest. Blend times come from limits:
  joints 2.4 rad/s and 12 rad/s², pelvis 0.4 m/s and 2.5 m/s², hand scalars 2.6/s (at most
  2.4 s). Legs are solved to the displayed feet in task space, so a planted foot stays planted.
- **Hand-overs wait for support.** A source is left only when it can be (no foot in the air, the
  belt stopped, nothing in the hand): walking finishes its step and stops, manipulation puts the
  object back first. The stance keeper steps the feet into a stance one foot at a time (weight
  shift at 0.26 m/s, foot carried at 0.6 m/s). Feet carry their contact and support (floor or
  treadmill belt).
- **Hands** are part of the displayed pose (four finger flexions, thumb flexion and opposition,
  spread per hand), blended with the body.
- **Manipulation stages** (reach, approach, close, lift, hold, place, release, retract) have fixed
  durations (a hold lasts until the object is put down); the time left over at a stage boundary carries into the next, and the next stage
  starts from the arm actually shown. The object is attached where the hand closed on it.
  **Slip is drawn magnified ×4** (it is millimetres); the lab says so next to the slip readout.
- **Presentation clock.** The guided tour's pause stops everything it presents (poses, belt,
  rotor, heat and charge, channels, camera moves, the tour's timeline); the interface and the
  visitor's own camera keep the real clock. Nothing catches up on play.
- **Energy has one owner.** While walking is shown, the gait's own 100 Hz loop steps the battery
  and thermal models; otherwise they are stepped in fixed 10 ms steps from the displayed loads.
  The same simulated time gives the same charge and temperatures at 30, 60 or 120 frames per
  second or irregular frames (tested within 1 % of the charge used and 0.05 K).
- **Tour chapters** start from a baseline: the default design and lab settings plus the chapter's
  own, the charge and temperatures the tour started with. Timed actions fire once per visit.
  Leaving restores the visitor's design, settings, actuator, charge and temperatures.
- **Stepping.** Every stepping foot (stance steps, the balance lab's return and recovery steps,
  a blend's foot lift) rises and lands on a `sin²` arc: no vertical speed at lift-off or
  touchdown. While the weight moves off a foot that is far out, the pelvis lowers softly before
  that knee straightens past 20° (it never snaps straight). A push recovery's drawn torso lean
  and arm swing follow the recovery model through fast springs: the model stops its torso at
  its rotation limit in one step, which drawn directly would be a pop.
- **Arm IK.** Arms that track a moving target frame by frame (manipulation) start each solve
  from the previous solution and resolve their redundancy toward where they already are, so
  the solution moves continuously with the target.
- **Camera** (`scene/camera/director.ts`). Moves are quintic from the current position and
  velocity (the carried velocity bounded so it cannot throw the path wide). The robot is
  approximated by capsules (torso, head, limbs, hands); each move's path is checked against them
  and swings out as little as needed, and a soft avoidance keeps a moving robot off the lens.
  A shot frames a subject box: on phones its distance and lens shift come from the part of the
  view the header, panel or sheet and caption bar leave free (measured from the page and
  followed by a spring, so a layout change reframes smoothly, even mid-move), so a collapsed
  sheet, a turned phone or a longer caption reframes it; on larger screens the composed shot
  stands when the subject fits. A move's duration comes from how far the camera travels (for
  a planned 8 m/s²) and how far the view turns: mostly 0.8–1.8 s. Follow shots track a filtered anchor, not the robot's millimetre sway.
- **Actuator hand-over.** With an actuator open, choosing another closes the open one, moves
  the camera, then reveals the new one (interruptible: choosing the first again reverses).
- **Evidence.** Developer telemetry (`world/telemetry.ts`, test hooks only) measures every frame:
  joint speed and acceleration, hand rate, pelvis speed, camera speed, acceleration and
  clearance, planted-sole slip relative to its support, object speed and attachment. The browser
  tests (`e2e/continuity.spec.ts`, `e2e/watch.spec.ts`, `e2e/camera.spec.ts`) hold them to the
  limits stated there; `docs/V2-BASELINE.md` records what they measured in V1.

---

## 10. Limitations

- Motions are generated by planners and tracked exactly; the dynamics are computed from them
  (inverse dynamics), not integrated forward from forces. There is no rigid-body contact
  simulation: impacts, slipping feet and falls are not simulated (a fall stops at the point of
  failure).
- Motors: no field weakening, cogging, inverter switching losses beyond a constant efficiency,
  or temperature dependence of the magnets.
- Reducers: constant efficiencies by type and ratio; no backlash or compliance in the walking
  model (the joint lab includes stiction).
- Thermal: two lumped nodes per actuator, no heat flow between actuators, constant ambient.
  The thermal view spreads each source's temperature over nearby surfaces with a fixed falloff
  (visual).
- Grasp: a two-contact pinch; no object rotation in the hand, no finger compliance.
- Balance: linear inverted pendulum (constant COM height, point feet for the dynamics, polygon
  for the constraint).
- Structure: one load case per member, no fatigue, buckling or joints.
- Estimates (motor constants, thermal resistances, friction, sensor noise, electronics power,
  friction coefficients) are plausible values for components of this class, not measurements.

---

## 11. Sources

Public specifications of adult-size humanoids were used only as ranges (height 1.6–1.8 m, mass
55–75 kg, batteries 0.8–2.3 kWh, payload 15–25 kg, joint peaks 150–360 Nm): Unitree H1 [R1–R3],
Figure 02 [R5], Apptronik Apollo [R6], Agility Digit [R7], Fourier GR-1 [R8], Tesla Optimus
[R9, R10], 1X NEO [R12], Boston Dynamics Atlas [R13], PAL TALOS [R14].

- [R15] B. Katz, MIT thesis (2018), Mini Cheetah actuator; [R16] P. Wensing et al., IEEE T-RO 2017,
  proprioceptive actuator design; [R17] S. Seok et al., IEEE/ASME T-Mech 2015, energy-efficient
  legged locomotion.
- [R20–R23] Frameless motor and robot actuator datasheets (CubeMars AK/RI series, Kollmorgen KBM).
- [R25] Harmonic Drive CSF/CSG catalogue; [R26] Nabtesco RV catalogue; [R27] planetary
  efficiency; [R28] strain-wave efficiency; [R29] roller screws; [R30] cycloidal QDD actuator
  (Zhu et al. 2024); [R31] reflected inertia.
- [R33] NEMA insulation classes; [R34] copper temperature coefficient; [R35] maxon thermal data;
  [R36] thermal-aware locomotion.
- [R37] Molicel P45B, [R38] Samsung 50S cell datasheets; [R39] pack vs cell energy density;
  [R40] foxBMS pre-charge; [R41] humanoid 48 V power architecture; [R42] IEC 62368-1 ES1.
- [R45] S. Collins et al., Science 2005 (cost of transport); [R46] ATRIAS; [R47] Duke Humanoid.
- [R49–R53] IMU and stereo camera datasheets; [R54–R55] ATI force/torque sensors; [R56–R58]
  encoders; [R60–R66] tactile sensing, slip and grip control (Romano et al. 2011; Johansson and
  Westling).
- [R67] TI, current loops in servo drives; [R68] whole-body control frameworks; [R69] EtherCAT;
  [R70] CAN FD; [R71] safe torque off (IEC 61800-5-2).
- [R73] S. Kajita et al., ICRA 2003 (ZMP preview control); [R74] Kajita et al., IROS 2001
  (3D-LIPM); [R75] J. Pratt et al., Humanoids 2006 (capture point); [R76] T. Koolen et al.,
  IJRR 2012 (capturability); [R77] J. Englsberger et al., IEEE T-RO 2015 (DCM);
  [R78] M. Vukobratović and B. Borovac 2004 (ZMP); [R79] Kajita et al., *Introduction to
  Humanoid Robotics*, Springer 2014; [R80] R. Featherstone, *Rigid Body Dynamics Algorithms*,
  2008; [R81] ankle, hip and stepping strategies.
- [R82–R86] Human gait (Perry; preferred speed 1.3 m/s, 112 steps/min; walk ratio; Froude
  number); [R87–R91] anthropometry (Winter, Dempster, de Leva 1996, COM ≈ 55–57 % of height).
- [R94–R100] Material data (7075-T6, 6061-T6, Ti-6Al-4V, AZ91D, PEEK, PA12, CFRP).
- [R101–R106] Robot hands and human grip strength norms.

The research notes behind these ranges, with the full URL list, are in `docs/RESEARCH.md`.
