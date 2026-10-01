# FAB / ONE — Humanoid

*Inside a machine built to move like us.*

An interactive engineering simulation of **FO-H1**, an original adult-size electric humanoid
designed for FAB / ONE (Idlery's simulations, served at `simulations.idlery.com/humanoid`).
Open it up system by system, change its design and see what it costs, and run its joints,
balance, walking and hands in seven live labs. Every number is calculated from one
specification by engineering models, and marked as calculated, design value, estimate or
visual approximation. [`docs/ENGINEERING.md`](docs/ENGINEERING.md) has the models, equations,
assumptions, limitations and sources.

## What is in it

- **Opening** — FO-H1 alive in a dark test lab (balance sway, actuator settling, gaze), a slow
  camera, and four ways in: Explore, Engineer, Simulate, Watch.
- **Explore** — structure, actuators (open one: it slides out of the limb and separates into
  cover, drive, encoder, bearing, stator, rotor, cycloidal discs, ring pins, output bearing,
  torque sensor, flange, while it runs a real walking duty cycle), hands, vision (the robot's own
  camera view: image, depth, segmentation, detections with range and error), balance and IMU,
  forces, battery and power (the torso opens; power flows from the cells through the contactors
  to every limb at the rate it is drawn), compute and networks, thermal (a thermal view while it
  exercises).
- **Engineer** — actuator reducer, ratio, motor size and current limit; limb lengths and torso
  mass; battery series and parallel count; tube materials; payload 0–30 kg. Each change reruns
  the design analysis (six tasks through the inverse dynamics, a walking cycle through the
  actuator, thermal and battery models) in a worker and reports the limits broken
  ("KNEE ACTUATOR LIMIT", "SHOULDER PITCH THERMAL LIMIT", …) with what would fix them. The
  robot in the lab carries the payload with its joint loads shown.
- **Simulate** — seven labs:
  1. *Joint lab*: the knee on a test stand, 10 kHz: command → controller → current → torque →
     reducer → output → acceleration → measured angle, with plots; change ratio, reducer, speed,
     payload.
  2. *Kinematics lab*: drag the target (inverse kinematics) or set the joints (forward); workspace
     cloud; unreachable targets explained.
  3. *Balance lab*: stand, squat, lean, shift, one foot, lift a 10 kg box; pushes with ankle, hip
     and stepping recovery; COM, support polygon, capture point, ground reactions.
  4. *Walking*: three gaits on an instrumented treadmill, optionally carrying; ground reactions,
     knee torque, battery power, cost of transport.
  5. *Manipulation*: a mobile cart with a parts box, a glass vial, a cordless driver, a beaker and
     a wet bottle; grasp, lift, slip detection and grip correction; box to shelf.
  6. *Whole-body control*: the closed loop with live values at each stage.
  7. *Failures and limits*: excess payload, overheating, low battery, torque saturation, excess
     current, loss of balance, unreachable target, insufficient grip — each with its numbers,
     cause and remedies.
- **Watch** — a 3 min 20 s captioned guided tour (no narration) on the app's own clock; pause
  holds the whole demonstration, and skipping, going back or leaving works at any moment.
- **Technical information** (the ⓘ) — what is calculated, estimated and approximated, the
  models, their limits and the sources.

## Running it

Node 20.19 or newer.

```sh
npm ci
npm run dev          # http://127.0.0.1:5174
npm test             # engine and geometry unit tests (vitest)
npm run build        # production build in dist/
npm run e2e          # browser tests (Playwright, SwiftShader): desktop, laptop, tablet, phone
```

Address options: `?mode=explore&system=power`, `?mode=simulate&lab=walk`, `?mode=engineer`
open a place directly; `?quality=low|medium|high` forces a rendering tier. For tests and
recording, `?virt=1` steps time frame by frame (`window.__fabAdvance(n, render)`) and exposes the
world and stores (`window.__fab`, `window.__fabStores`); `?hooks=1` exposes them in real time;
`?capture=1` keeps the drawing buffer. With the hooks, `window.__fabTelemetry.start()` records
developer telemetry every frame (joint, hand, pelvis, camera and object motion, sole slip,
camera clearance; `src/world/telemetry.ts`), `window.__fabState()` returns everything presented
as numbers, and `window.__fabPerf()` the real frame intervals and GPU resource counts.

| script | what it does |
|---|---|
| `scripts/shots.mjs` | frame-stepped screenshots from a list of steps |
| `node scripts/probe.mjs <scenario> [--video]` | runs a scenario from `scripts/scenarios.mjs` with telemetry on, writes every frame's measurements and a summary (and a clip with `--video`) |
| `node scripts/perf.mjs [--tour 60] [--soak 600]` | real-time measurements on the page's own frame loop: cold loads, first visits of each scene, the tour, and a soak with GPU and heap counts |

The motion and presentation tests: `e2e/continuity.spec.ts` (every frame of scene changes,
actuator switches, pick and place, walking and hand-overs, rapid changes, energy at different
frame rates), `e2e/watch.spec.ts` (pause in frame-stepped and real time, chapter baselines,
navigation, leaving) and `e2e/camera.spec.ts` (orbit, fling, cancel, pinch, IK drag, Recenter,
framing that follows the layout). What they found in V1 is in `docs/V2-BASELINE.md`; how the
motion is kept continuous is in `docs/ENGINEERING.md`, section 9; what V2 changed, the tests run
and the measurements are in `docs/RELEASE-V2.md`, with V1 and V2 recordings in `docs/recordings/`.

## How it is built

- `src/spec/` — the single source of truth: dimensions, joints and the mass budget, actuator
  families and motor frames, battery cells and pack, sensors and computers, materials, gaits.
  Every value is tagged with its provenance.
- `src/engine/` — the models (no rendering): actuators and thermal, battery, mass and COM,
  kinematics and IK, inverse dynamics, balance and push recovery, ZMP preview control and the gait
  generator, whole-body posture, the joint rig, grasping, sensing, structure, power, the design
  analysis. Unit-tested (`*.test.ts`).
- `src/scene/` — three.js: procedural geometry (lofts, lathes), the robot's rig (one group per
  segment, meshes merged per segment and subsystem with per-vertex physically based materials),
  the exploded actuator, the lab, lights and post-processing tiers, the camera director and the
  scene channels.
- `src/world/` — the runtime: one frame loop in a fixed order (scene channels → pose sources →
  robot → features → camera → render). Pose sources (idle, walking, balance, reaching,
  manipulation) produce poses; the pose driver cross-fades between them in task space so a
  planted foot stays planted. Scenes are data (`scenes.ts`): a camera shot, channel targets and a
  pose source, applied from whatever is on screen. Nothing waits on a timer.
- `src/ui/` — React panels; they read the world only through the app store (readouts published
  ten times a second).

Camera moves are quintic and velocity-continuous from the current motion; channels (x-ray,
opening, exploding, overlays) are staged so every transition, interrupted or not, runs the same
choreography forwards or backwards.

## Inside FAB / ONE

The site builds it with `npm run build -- --base /humanoid/ --outDir …` and
`VITE_FABONE_HOME=/`, which turns the wordmark into a "Back to FAB / ONE" link. It keeps to its
route (no browser storage, no service worker). Its homepage preview is recorded from the built
site by the site's `capture-preview` script with the shot list in
`site/media/humanoid/preview.json`.
