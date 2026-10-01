# Humanoid V2: release note

FO-H1 is an original humanoid designed for this simulation; it is not a real robot, and
nothing here implies one. V2 keeps its identity, its engineering models and the Explore,
Engineer, Simulate and Watch structure, and makes what is shown continuous, readable and
measurable.

## Sources and commits

| | repository, branch | commit |
|---|---|---|
| V1 (start) | `BKimble1/humanoid-simulation`, `claude/fab-one-humanoid` | `f5fa839190a31b4798cda117c73d83a70bca08a1` (`main` is `2014f6c`) |
| hub with Humanoid V1 and Photolithography | `BKimble1/Idlery-Simulations`, `claude/fab-one-humanoid` | `98c94b34269402209e9843c6901caef7cafddefe` |
| hub with Photolithography and Rocket V2 | `BKimble1/Idlery-Simulations`, `claude/clever-pascal-y4v4d8` | `a0be6732c1d7667bee7cde896d067aaaae556c3e` |
| **V2** | `BKimble1/humanoid-simulation`, **`claude/humanoid-v2`** | see below |
| **hub with all three** | `BKimble1/Idlery-Simulations`, **`claude/humanoid-v2`** (from `a0be673`) | see the hub's README, "Humanoid" |

The two hub branches diverge (one added Humanoid V1, the other Rocket V2 and new hub tooling).
The V2 hub branch starts from the rocket's (`a0be673`), so no rocket or hub work is replaced;
Humanoid is added the way the rocket is, by `scripts/import-simulation.mjs` from this
repository (its `SOURCE.json` records the commit), and its card entry, route tests and README
text were carried over from `98c94b3` and updated. The card is the third, after
Photolithography and Rocket Engineering.

V2 commits on `claude/humanoid-v2`:

| commit | what |
|---|---|
| `5ed76b7` | developer telemetry, collision proxies and the probe runner, observation only (V1 was measured with this) |
| `eb74b96` | the motion and state core: pose driver, hands, hand-overs, stance, manipulation stages, presentation clock, camera, energy, actuator hand-off, tour chapters |
| `bec0eda` | evidence tests, layout-aware framing, Watch pacing, lifecycle and performance instrumentation |
| `f9475f9` | a type fix in a test |
| `fb3324c` | camera move durations from travel, list legibility, contained panel scrolling |
| `008b4fc` | label halo; the per-tier rendering test; recording comparison tools |
| `3427394` | the reduced-motion test; the real-time pause recorder |
| `e9178af` | manipulation reach without IK chatter (warm start, least-change redundancy) |
| `aff52c8` | the real-time pause test waits for the page's own frames |
| `f861fff` | no snaps in stepping, push recovery or tour framing (found by playing the whole tour with telemetry); most V2 recordings and the card preview |
| `2ab9418` | the first framing happens before the page is seen (found in the recordings): **the code in FAB / ONE**, the Watch-pause and phone recordings |
| this note's commit | this note, the V2 recordings and their comparison (documents only) |

## What was wrong in V1, and what V2 does

Measured in V1 with the telemetry (details and reproduction: [V2-BASELINE.md](V2-BASELINE.md)).

| | V1 | V2 | evidence |
|---|---|---|---|
| **A** Retargeting | A change of preset or payload within one source bypassed blending: an elbow at 52 rad/s (100° in a frame), 1580 rad/s², the pelvis 2.2 m/s | Every change of source or posture is an inertialized blend under velocity and acceleration limits (joints 2.4 rad/s, 12 rad/s²; pelvis 0.4 m/s) | `continuity.spec` test 1; recording `clip-hands`: elbow 2.4 rad/s at most (V1 51.9), 19.5 rad/s² (V1 1558) |
| **B** Hands | A global hand pose that walking and reaching never set: 15.9/s jumps | Hands are part of each source's pose and of the blend | test 1, test 4; `clip-hands`: hand rate 1.1/s at most (V1 14.8) |
| **C** Manipulation | Stages eased with the previous stage's progress: 20–40 rad/s spikes, the object moved 15 cm in a frame (4.7 m/s) | Stages in order with carried-over time, the next stage starts from the displayed arm, the object attached where the hand closed | test 3 (box, tool, vial), test 4 (leaving mid-grasp); `clip-manip`: object 0.23 m/s at most (V1 4.7), joints 1.7 rad/s and 11 rad/s² (V1 38.6 and 2291); in both versions the object is placed from the displayed hand, so V1's jumps were the hand's own |
| **D** Pause | Stopped the tour's clock only: 116 paused frames with the robot still walking | A presentation clock: pause holds everything presented; play does not catch up | `watch.spec` tests 1–2 (six chapters frame-stepped; real time); `clip-pause`: 0 of 90 paused frames moved (V1 90 of 90); real-time screen recordings: V1 moved and its belt ran 4 mm during 5.7 s of pause, V2 changed nothing in 4.0 s, and neither caught up after play |
| **E** Camera collision | `keepOut` never filled | Capsule proxies of the robot; each move checked and swung out as little as needed; soft avoidance; a last-resort clamp reported as a failure | every continuity test checks clearance > 5 cm and no clamp |
| **F** Camera follow | Copied its anchor: 5.4 m/s, 161 m/s² in a frame | Filtered follow with a deadband, time-based damping, bounded carried velocity, one owner | test 1 (≤ 15 m/s²), test 6 (≤ 40 under 100–300 ms changes) |
| **G** Feet | No contact or support: any foot that moved lifted in a generic arc | Feet carry contact and support (floor or belt); hand-overs wait for support; the stance keeper steps one foot at a time | test 5: planted soles slide ≤ 0.02 m/s relative to their support through walk → balance → one foot → overview |
| **H** Energy | Stepped twice while blending into walking | One owner: the gait's 100 Hz loop when walking is shown, fixed 10 ms steps otherwise | test 7: 30, 60, 120 Hz and irregular steps agree (charge used within 1 %, winding temperature within 0.05 K, belt within 2 cm) |
| **I** Actuator switch | The next actuator appeared already exploded | Close, move, reveal; interruptible (reversing re-opens); focus by part identity | test 2: six directional hand-offs, every new assembly appears closed; `clip-actuator` (V1: each new assembly appeared at explode 1.0) |
| **J** Watch chapters | Chapters applied only their own changes (the 30 kg design stayed) | Each chapter starts from a baseline; timed actions once per visit; pause survives navigation; leaving restores the visitor | `watch.spec` test 3 |
| **K** Tests | Checked end states | Per-frame telemetry assertions, real `requestAnimationFrame` pause test, rendering checks per tier | this list |

Also found and fixed, by the telemetry and by playing the whole tour with it on:

- stopping a walk just after starting it moved a foot 1.2 m in one tick (`gait.ts
  truncateFuture`; unit test); changing gait while walking switched the stance knee at one tick
  (the gait parameters now blend); changing object snapped the head;
- a paused actuator view showed one more frame of rotor motion (read order);
- the manipulation reach chattered at the elbow (2° irregularities frame to frame, 120 rad/s²)
  and stepped 5° on its first frame: the arm solver now starts from the previous solution and
  resolves the arm's redundancy toward where it already is (at most 11 rad/s²);
- stepping feet (the balance lab's return steps, standing's stance steps, a blend's foot lift,
  a recovery step) left and landed at a quarter of a metre per second on a `sin` arc, and a leg
  pulled straight as the weight moved off a foot far out snapped its knee (6.9 rad/s, stopped in
  one frame): feet now lift on `sin²` (no vertical speed at either end) and the pelvis lowers
  softly before a knee straightens past 20°;
- the balance lab's wrists jumped 10° when its task took over from its return steps (the steps
  did not set them);
- a 300 N push: the recovery model stops its torso dead at its rotation limit, and the arms,
  driven by the torso's rate, snapped back 32° in one frame; the drawn lean and arm swing now
  follow the model through fast springs (the model's numbers are unchanged);
- in Watch, a caption of another length changed the caption bar's height and the framing
  jumped mid-move (128 m/s²), and a move ending while the framing drifted stopped dead
  (31 m/s²): the free area is followed by a spring, and the hold keeps the speed a move ended
  with. The whole tour now plays within the continuity limits (`watch.spec`, "the whole tour");
- the first framing for the page's layout was taken up to 0.1 s after the page appeared (a
  2.5 m camera jump in a frame-stepped recording; under the loading veil for a visitor), and the
  next move started from that jump's velocity: the layout is looked for every frame until it is
  known, and a snap resets the camera's velocity (`camera.spec`, "the first picture").

## Movement

- Standing is alive but quiet: sway comes and goes with quiet spells, and close inspection
  presets quieten it further.
- Balance: ankle, hip and stepping recovery stay distinct (the push lab reports which were used);
  the robot returns to its stance with distance-based steps.
- Walking: starts and stops finish their steps; gait changes blend; arms swing, or hold the
  box when carrying; soles stay planted on the moving belt.
- Manipulation: readable stages (reach, approach, close, lift, hold, place, release, retract),
  fingers close and open at a hand's pace, the object stays in the hand (≤ 2 mm). **Slip is
  drawn magnified ×4** and labelled so in the lab.
- Reaching (IK): starts from the displayed arm; the arm follows its solution through a
  rate- and acceleration-limited servo (no chatter). Manipulation's arms start each frame's
  solve from the previous solution and settle their redundancy toward where they are; the IK
  loop no longer allocates.
- Fixed simulation steps (gait 100 Hz, energy 10 ms); all outputs finite (checked by the rapid
  test).

## Picture

- Covers ghost with distance from the subject, so an x-ray or cutaway keeps the subject clear
  without flicker; labels resolve overlaps across sides and hide non-key labels that would be
  pushed far.
- AgX tone mapping everywhere, modest bloom on high and medium. Measured at 1280 × 800: high and
  medium agree within 0.1 % mean luminance; low (no ambient occlusion or vignette) is 3.5–6 %
  brighter overall and within 3.7 % on lit surfaces; the vision inset is identical across tiers.
  Low keeps the same composition, materials and lighting.
- The Explore list keeps a soft scrim where the robot's shell passes behind it.

## Transitions and framing

- Each camera move has an identity (telemetry) and starts from the current picture, carrying
  its velocity; a move to the shot already shown does not restart; channel reversals continue
  from where they are.
- Move durations come from how far the camera travels (for a planned acceleration of 8 m/s²)
  and how far the view turns: most take 0.8–1.8 s, at most 2.4 s (longer only when swinging out
  around the robot).
- Shots frame a subject box inside the part of the view the header, side panel, phone sheet
  and caption bar leave free, measured from the page, instead of per-device multipliers: a
  collapsed sheet, a turned phone or the caption bar reframes it.
- A quiet Recenter button appears when the visitor has orbited or zoomed away.
- Reduced motion (the system setting) turns camera moves into short moves (at most 0.5 s),
  makes channel changes (x-ray, opening, exploding) about three times quicker, and removes
  interface animation.

## Interface

- Watch: the chapter line shows at once; the caption follows its subject (after the camera
  arrives, after the demonstration it describes has begun) and keeps its room. The tour is
  captioned, not narrated, and says so. Pause, previous, next and leave work at any moment.
- Phone panels scroll on their own; a two-finger pinch zooms without orbiting and hands back to
  one finger without a jump; dragging the IK target never orbits the camera.

## Performance and lifecycle

- The quality monitor and statistics read the real frame interval, not the clamped step; tiers
  change with hysteresis (down on a sustained slow median, up only with lasting headroom, at most
  three changes).
- Medium keeps ambient occlusion and bloom at lower quality and resolution (about half of
  high's fill).
- Materials of variants that appear later (revealed, faded, x-ray, depth) are compiled at load.
- The payload's label texture is swapped instead of rebuilding the crate (V1 leaked one per
  change); the world disposes geometries, materials, textures and the context when it ends.

### Measured (and what the numbers cannot say)

Measured with `scripts/perf.mjs` against the production build of `2ab9418` on the page's own
frame loop: Chromium 141.0.7390.37 headless, **SwiftShader (software WebGL, no GPU)**,
1280 × 720 at DPR 1, quality chosen by the app (it picks **low** for a software renderer), a
4-core Intel Xeon at 2.8 GHz in a cloud container. Full results:
[perf/perf-swiftshader-1280x720.json](perf/perf-swiftshader-1280x720.json).

| | result |
|---|---|
| cold load to ready (empty cache, a fresh browser context per address) | 4.9–5.4 s for the opening, Explore, the actuators, walking, manipulation, Engineer and Watch |
| frame intervals on this machine | median 0.1–1.4 s, p95 1.5–4.5 s: a software renderer, **not a measure of real-time playback on any device** |
| first visits to every scene (hands, actuators closed and open, hip, power, thermal, vision, walking, manipulation, balance, joint, Engineer) | no errors and nothing missing; on this renderer every frame takes about a second, so a shader compile at first use cannot be told apart from an ordinary frame: first-use hitches are **not measured** (that needs a GPU) |
| real-time Watch | the tour clock advances by the clamped step (1/15 s per frame at most), so at about one frame a second it plays at 1/15 speed: 4.2 s of tour in 60 s; no errors |
| 10-minute soak (a scene change every 5 s, walking and picks included) | GPU geometries 217 → 253 (the scenes first visited), then **253 for the remaining 7.5 minutes**; textures 10 throughout; shader programs 23 → 24; JS heap 73–75 MB throughout; **no errors, no context loss** |

The targets (around 60 frames a second on a desktop, 30 or better on a phone) could not be
measured: no GPU, real phone or other browser was available. The tiers and the quality
monitor (it reads real frame intervals, with hysteresis) are in place for them; their
thresholds have not been tuned on hardware.

## Tests run for this release

All in Chromium 141 (Playwright 1.56.1) with SwiftShader, frame-stepped unless noted.

| what | where | result |
|---|---|---|
| unit tests (`npm test`, vitest): engine models, gait (including the new "no foot ever jumps when stopped at any moment" test), IK (the new least-change test), geometry | this repository | 69 of 69 passed |
| type check (`tsc -b`, as the build runs it: app, config and tests) | this repository | clean |
| every browser suite on the development server, desktop: `continuity.spec` (7), `watch.spec` (4), `camera.spec` (6), `rendering.spec` (1), and V1's `start.spec`, `modes.spec`, `engineering.spec` | this repository, `2ab9418` | 33 of 33 passed (16 minutes); `camera.spec`'s "first picture" test also run on the code before the fix, where it fails (70 m/s² at frame 4) |
| **the same suites, all four viewports** (desktop 1440 × 900, laptop 1280 × 720, tablet 820 × 1180 touch, phone 390 × 844 touch; the V2 evidence tests run on desktop, being about motion, not layout) | **inside FAB / ONE, at `/humanoid` on the built site** (`npm run e2e:humanoid`, the site's Netlify-style server), `2ab9418` | 78 passed, 0 failed; 54 skipped by design (the 18 desktop-only tests on the three other viewports); 49 minutes |
| the site's own suite (`npm run e2e`): homepage and its three cards, previews, routing, Photolithography (including its offline service worker), Rocket Engineering, Humanoid at its route, and Photolithography's worker not reaching `/`, `/rocket` or `/humanoid` | FAB / ONE, desktop and phone, the final build | 52 passed, 0 failed, 10 skipped by design (one-viewport tests); 23 minutes. An earlier run failed one phone test (a preview's play button clicked while its card was still lifting); the wait from the Humanoid V1 hub branch was ported and both viewports passed |
| package check (`npm run verify-package`) of `FAB_ONE_Humanoid_V2_Netlify.zip` (27.9 MB, 261 files, `index.html` at the top level) | FAB / ONE | 457 checks passed, 0 failed: layout, every route with and without the slash and with deep links (200, no redirect), 404s, every file each page and each simulation's code loads, preview clips (codec, size, length, no sound), types and headers |
| the same ZIP unzipped into an empty folder, served by the site's Netlify-style server, opened in Chromium | FAB / ONE | 32 of 32: `/`, `/photolithography`, `/rocket`, `/humanoid` and a deep link each open, draw, load nothing outside their route, log no errors and lead back to `/`; Photolithography's service worker controls `/photolithography` and not `/`, `/rocket`, `/rocket/`, `/humanoid`, `/humanoid/` or `/humanoid?mode=watch` |
| Netlify's own parsers and matcher on `_redirects` and `_headers` | FAB / ONE | 3 redirect rules and 8 header rules, no errors; every route and deep link matches its forced rule; missing files and `index.html` match none |

How the twelve checks asked for are covered:

| # | check | covered by |
|---|---|---|
| 1 | overview → hand → actuators → forces | `continuity.spec` 1 (every frame; repeated clicks and a payload change as well); recording `clip-hands` |
| 2 | knee → hip → elbow while open, reversed midway | `continuity.spec` 2 (six directional hand-offs, a reversal); recording `clip-actuator` |
| 3 | pick and place, one and two hands | `continuity.spec` 3 (box with two hands, tool and vial with one), 4 (leaving mid-grasp); recording `clip-manip` |
| 4 | walking: start, stop, gait change, carrying, walk → balance | `continuity.spec` 5; recording `clip-walk` |
| 5 | Watch paused in several chapters | `watch.spec` 1 (six chapters, frame-stepped), 2 (real time); recordings `clip-pause` (frame-stepped) and the real-time pause recordings |
| 6 | Watch navigation after the payload chapter | `watch.spec` 3 |
| 7 | rapid scene changes | `continuity.spec` 6 (a change every 100–300 ms, 50 times, while walking) |
| 8 | recenter, pointer cancel, pinch, IK drag, orientation, panel collapse | `camera.spec` 1–4; reduced motion: `camera.spec` 5; the first picture already framed: `camera.spec` 6 |
| 9 | variable time step and energy | `continuity.spec` 7 (30, 60, 120 Hz and irregular steps) |
| 10 | cold loads, first visits, a real-time tour | `scripts/perf.mjs` (below) |
| 11 | ten-minute soak | `scripts/perf.mjs --soak 600` (below) |
| 12 | the site serves all three | the site's suite, the package check and the smoke test of the unzipped package |

## Footage

In [`docs/recordings/`](recordings/) on this branch (what each is and how it was made:
[recordings/README.md](recordings/README.md); worst frames compared:
[recordings/COMPARISON.md](recordings/COMPARISON.md)). On GitHub:
`https://github.com/BKimble1/humanoid-simulation/tree/claude/humanoid-v2/docs/recordings`.

| scenario | V1 | V2 | side by side |
|---|---|---|---|
| Explore: overview → hands → actuators → forces | [v1](recordings/v1/clip-hands.mp4) | [v2](recordings/v2/clip-hands.mp4), [phone](recordings/v2/phone/clip-hands.mp4) | [compare](recordings/compare/clip-hands.mp4) |
| actuator switching while open | [v1](recordings/v1/clip-actuator.mp4) | [v2](recordings/v2/clip-actuator.mp4) | [compare](recordings/compare/clip-actuator.mp4) |
| pick and place | [v1](recordings/v1/clip-manip.mp4) | [v2](recordings/v2/clip-manip.mp4) | [compare](recordings/compare/clip-manip.mp4) |
| walking, stopping, balance | [v1](recordings/v1/clip-walk.mp4) | [v2](recordings/v2/clip-walk.mp4) | [compare](recordings/compare/clip-walk.mp4) |
| Watch paused (frame-stepped) | [v1](recordings/v1/clip-pause.mp4) | [v2](recordings/v2/clip-pause.mp4), [phone](recordings/v2/phone/clip-pause.mp4) | [compare](recordings/compare/clip-pause.mp4) |
| Watch paused (real time, screen recording) | [v1](recordings/realtime/v1-realtime-pause.mp4) | [v2](recordings/realtime/v2-realtime-pause.mp4) | [compare](recordings/compare/realtime-pause.mp4) |

The card preview on the FAB / ONE homepage was recorded from V2 as well (see the site's
`site/media/humanoid/PROVENANCE.md`).

## Known limits, and what could not be tested

- **No real device or GPU.** Every run here used Chromium with SwiftShader (software WebGL) in a
  4-core cloud container. The frame times above say nothing about real-time performance on a
  phone, a laptop or a desktop GPU; the quality tiers' real-world thresholds are untested.
  Safari (macOS, iOS) and Firefox were not tested at all.
- **Touch** was tested with pointer events dispatched on the canvas as a browser sends them
  (two fingers, cancel, a drag on the IK target), not with a touchscreen; a real iOS gesture
  (the page's own pinch-zoom, edge swipes) was not tested.
- **Sound** is not covered by any test (it starts muted).
- **The robot's motion is presented, not simulated**: poses come from planners and are tracked
  exactly; there is no rigid-body contact simulation (see ENGINEERING.md, section 10). The
  continuity limits are about what is drawn.
- **Tolerances.** The tests hold joint speed to 4.5 rad/s outside walking (12 when walking), joint
  acceleration to 90 rad/s², hand rate to 3.5/s, pelvis 0.5 m/s, planted-sole slip 0.02 m/s,
  object attachment 2 mm, camera acceleration 15 m/s² (40 when the scene changes every
  100–300 ms). A blend that starts while another is still moving can briefly add two motions;
  those limits allow for it.
- **Entering a tour chapter** blends from what is on screen (nothing teleports), so the first
  second of a chapter differs with where the visitor came from; its demonstration, design,
  settings, charge and temperatures start from the same baseline (temperatures agree within
  0.5 K after 6 s; the push is caught the same way).
- **Lab panels** keep V1's amount of detail; progressive disclosure was not attempted.
- **On phones** the framing counts the header, the sheet and the caption bar, but not the
  Explore chip row under the header: close-ups sit just below it rather than centred in the
  space beneath it.
- The V2 recordings of Explore, the actuator switch, pick and place, and walking, and the
  homepage card preview, were made from `f861fff`; the Watch-pause and phone recordings from
  `2ab9418`, the code FAB / ONE serves. The only change between the two is when the first framing
  happens after the page loads, which none of the earlier recordings or the card preview shows
  (their telemetry starts, or their setup runs, after it).
