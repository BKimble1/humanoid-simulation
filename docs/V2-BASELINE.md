# V1 baseline: measured defects

The V2 work started from V1 at `f5fa839` (branch `claude/fab-one-humanoid`). Before changing
anything, developer telemetry was added (commit `5ed76b7`: `src/world/telemetry.ts`,
`src/world/proxies.ts`, `scripts/probe.mjs`, `scripts/scenarios.mjs`; observation only). That
commit was built and served on its own port, and every scenario in `scripts/scenarios.mjs` was
run against it on the frame-stepped clock (30 frames/s). The same probes then measured V2.

Telemetry records these every frame:
- joint speed and acceleration of the displayed pose, and the hand-pose rate;
- pelvis speed;
- camera speed, acceleration and clearance from the robot's collision capsules;
- planted-sole slip relative to its support (floor or treadmill belt);
- object speed;
- which exploded assemblies are visible;
- scene, shot, transition id and pause state.

## Runtime-confirmed (V1 build, probe numbers)

| # | Defect | Reproduction (scenario) | Measured in V1 | Files |
|---|---|---|---|---|
| A | Scene changes within the idle source bypass blending: arms pop to the new preset | Explore overview → hands → actuators → forces (`explore-hands`) | Elbow 52.7 rad/s (about 100° in one frame); joint acceleration 1580 rad/s² | `world/world.ts` `applyScene`, `world/pose.ts` `use()` |
| A | Payload set while standing: arms and pelvis snap to the carry posture | `explore-hands`, payload 15 kg then 0 | Pelvis 2.2 m/s (7 cm in one frame); elbow 41.8 rad/s | same |
| B | Hands jump: sources write a global hand pose, walking and reaching never set it | `explore-hands`; leaving manipulation | Hand-pose rate 15.9/s (half a fist in one frame); 17.4/s when leaving mid-grasp | `scene/robot/hand.ts`, sources |
| C | Manipulation eases with the old stage's progress after changing stage | `manip-stages` | Joint spikes of 20–40 rad/s for two frames at every stage boundary; object moves 15 cm in one frame at lift and at place (4.6 m/s) | `world/sources/manip.ts` |
| D | Pause stops the tour's clock, not the scene | `watch-pause`, walking chapter | 116 paused frames with the robot still walking (joints 6.5 rad/s, pelvis 0.33 m/s) | `world/tourRunner.ts`, `world/world.ts` |
| F | Following shots copy their anchor, so the camera lurches with the arm | `explore-hands`, payload change in the hands shot | Camera 5.4 m/s, 161 m/s² in one frame | `scene/camera/director.ts` |
| I | Switching actuator while open shows the next one already exploded | `actuator-switch` | Every switch: the new assembly visible at explode 1.0, out 1.0 on the next frame; the old one gone | `world/world.ts` `updateAssemblies` |
| — | Stopping a walk just after starting it starts the stop step from a dropped footstep | `rapid` (walking toggled during a scene change) | Foot moves 1.2 m in one 10 ms tick (reproduced in `gait.test.ts`) | `engine/gait.ts` `truncateFuture` |
| — | Changing gait while walking switches the stance knee and the pelvis bob at one tick | `walk-contact`, normal → fast | Knee 14 rad/s; pelvis 2.8 cm in one tick | `engine/gait.ts` |
| — | Changing object in the manipulation lab snaps the head to it | `manip-stages` | Neck 15 rad/s | `world/sources/manip.ts` |

## Source-confirmed (read in the code; reproduced where noted)

- **E** — `Director.keepOut` was declared and iterated, but never filled. Nothing kept the camera out of
  the robot. The V1 probes did not catch the camera inside a capsule. The closest was 0.43 m, in the hands close-up.
- **G** — `FootPose` had no contact or support. `PoseDriver` lifted any foot whose endpoints
  differed by more than 1 cm, in a generic sine arc during the blend, whatever carried the weight.
- **H** — while blending into walking, `BodyState` stepped the shared energy model per frame, and
  the gait stepped it again per tick.
- **J** — `TourRunner.enter` applied only a chapter's own changes. Going back after the 30 kg chapter
  left the 30 kg design in place, until the last chapter reset it.
- **K** — the e2e helpers drew only the last frame of each `advance`. The interruption test
  checked the final scene and the camera height only.
- `PayloadProp.label()` built a new crate when the mass label changed and never disposed the
  old one.
- `Stage.render()` received the clamped simulation dt; the quality monitor never saw the real
  frame interval.
- `tsc --noEmit -p .` checked nothing: the root `tsconfig.json` only has project references.
  The builds used `tsc -b`, so the shipped code was type-checked.

## Hypotheses checked and set aside

- Walking planted-sole slip of 0.053 m/s (V1 and V2): these were single frames at touchdown,
  a heel corner counted as "in contact" inside a 4 mm band while still descending. With a
  1.5 mm band, the worst slip is 0.014 m/s, under half a millimetre per frame, from heel/toe roll.
  The feet do not slide.
- The hands close-up crowding the camera is the same in V1 and V2. It's a composition issue, handled
  in the framing work, not a motion defect.

The clips recorded from the V1 build are in `docs/recordings/v1/`. The same scenarios recorded
from V2 are in `docs/recordings/v2/`.
