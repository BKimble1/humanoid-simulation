# Recordings: V1 and V2

The same five scenarios (`scripts/scenarios.mjs`) recorded from V1 and from V2, frame by
frame on the app's frame-stepped clock (`?virt=1`: every frame is exactly 1/30 s, however long
the software renderer takes to draw it), at 960 × 540, `quality=high`, in Chromium with
SwiftShader (software WebGL, no GPU). Each clip comes with the developer telemetry of every
frame (`*.telemetry.json`, `src/world/telemetry.ts`) and its summary (`*.summary.txt`).

| folder | build |
|---|---|
| `v1/` | V1 (`f5fa839`, branch `claude/fab-one-humanoid`) with the observation-only telemetry of `5ed76b7` added, built and served on its own |
| `v2/` | V2 (branch `claude/humanoid-v2`), production builds: `clip-hands`, `clip-actuator`, `clip-manip`, `clip-walk` from `f861fff`; `clip-pause` from `2ab9418` (they differ only in when the first framing happens after load, which shows at the start of `clip-pause`) |
| `v2/phone/` | `2ab9418` at 390 × 844 with touch (phone) |
| `realtime/` | the Watch pause in real time, V1 (port of the V1 build) and V2 (`2ab9418`): the page's own frame loop recorded as a screen video, with what changed while paused (`scripts/realtime-pause.mjs`, 960 × 540, `quality=low`; the software renderer draws about one frame a second, so the videos are choppy). V1: the pose and camera moved and the belt ran 4.2 mm during 5.7 s of pause; V2: nothing changed in 4.0 s |
| `compare/` | V1 and V2 side by side, frame for frame (`scripts/side-by-side.mjs`) |

[`COMPARISON.md`](COMPARISON.md) lists the worst frame of each measurement in each scenario,
V1 against V2 (`node scripts/compare-recordings.mjs docs/recordings/v1 docs/recordings/v2`).

| scenario | what happens |
|---|---|
| `clip-hands` | Explore: Overview, then Hands, Actuators and Forces, 3 s each |
| `clip-actuator` | the knee actuator opened; then Hip, Elbow and (after 0.8 s, mid-change) Hip again while open |
| `clip-manip` | manipulation lab: the cordless driver picked up, held, put down |
| `clip-walk` | walking lab: start walking, stop, then the balance lab |
| `clip-pause` | Watch: the Walking chapter, paused for 3 s, played again, then leaving the tour |

To record them again (a server of the build on port 4182):

```sh
node scripts/probe.mjs clip-hands --url http://127.0.0.1:4182 --out docs/recordings/v2 --video --size 960x540 --quality high
```

`probe.mjs` writes `<scenario>.json` (the telemetry, renamed `*.telemetry.json` here) and
`<scenario>.mp4`. These files are development evidence: FAB / ONE's import leaves
`docs/recordings/` out of the site.
