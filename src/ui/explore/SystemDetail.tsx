/**
 * Live parts of the Explore panels: the robot's camera view (Vision), the power budget
 * (Power), the heat readouts (Thermal), balance and force numbers.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { HEAD_CAMERAS } from '../../spec/sensing';
import { WINDING } from '../../spec/actuators';
import { stereoDepth } from '../../engine/sensing';
import { useApp } from '../../state/store';
import type { VisionMode } from '../../world/features/vision';
import type { World } from '../../world/world';
import { Plot, Readout, Segmented } from '../kit';
import { Bar, Split, n } from '../simulate/parts';

export function VisionView({ world }: { world: World }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const boxes = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<VisionMode>(world.vision.mode);
  useEffect(() => {
    const v = world.vision;
    v.view = ref.current;
    let raf = 0;
    // detection boxes follow the view every frame (DOM, no React updates)
    const draw = () => {
      const host = boxes.current;
      if (host) {
        const d = v.detections;
        while (host.children.length < d.length) {
          const el = document.createElement('div');
          el.className = 'det';
          el.innerHTML = '<span class="det__label"></span>';
          host.appendChild(el);
        }
        [...host.children].forEach((el, i) => {
          const e = el as HTMLDivElement;
          const x = d[i];
          e.style.display = x ? '' : 'none';
          if (!x) return;
          e.style.left = `${x.x0 * 100}%`;
          e.style.top = `${x.y0 * 100}%`;
          e.style.width = `${(x.x1 - x.x0) * 100}%`;
          e.style.height = `${(x.y1 - x.y0) * 100}%`;
          e.style.borderColor = x.color;
          const label = e.firstChild as HTMLSpanElement;
          label.textContent = `${x.label} ${x.range.toFixed(2)} m ±${(x.sigma * 1000).toFixed(1)} mm`;
          label.style.background = x.color;
          // near the right edge the label hangs to the left of the box
          label.style.left = x.x0 > 0.55 ? 'auto' : '-1.5px';
          label.style.right = x.x0 > 0.55 ? '-1.5px' : 'auto';
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      if (v.view === ref.current) v.view = null;
    };
  }, [world]);
  const S = HEAD_CAMERAS.stereo;
  const rows = [0.5, 1, 2, 4].map((z) => ({ z, s: stereoDepth(z).sigma }));
  return (
    <div className="vision">
      <Segmented
        value={mode}
        options={[
          { id: 'camera', label: 'Camera' },
          { id: 'depth', label: 'Depth' },
          { id: 'segmentation', label: 'Segmentation' },
        ]}
        onChange={(m) => {
          world.vision.mode = m;
          setMode(m);
        }}
      />
      <div className="vision__frame">
        <canvas className="vision__view" ref={ref} aria-label="What FO-H1's left camera sees" role="img" />
        <div className="vision__boxes" ref={boxes} aria-hidden />
        <span className="vision__tag">LEFT CAMERA · {S.width}×{S.height} · {S.rateHz} Hz</span>
      </div>
      <table className="jtable">
        <tbody>
          <tr>
            <td>Distance</td>
            {rows.map((r) => (
              <td key={r.z} className="num">
                {r.z} m
              </td>
            ))}
          </tr>
          <tr>
            <td>Depth error (1σ)</td>
            {rows.map((r) => (
              <td key={r.z} className="num">
                {r.s < 0.01 ? `${(r.s * 1000).toFixed(1)} mm` : `${(r.s * 100).toFixed(1)} cm`}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="note-small">Depth from disparity: z = f·B / d. With the 80 mm baseline and a tenth-of-a-pixel matching error, the error grows with the square of the distance. The image is rendered from the camera's pose; it is not a simulated sensor (no noise, blur or exposure).</p>
    </div>
  );
}

export function PowerLive() {
  const r = useApp((s) => s.readouts);
  const lv = Number(r.lvW ?? 0);
  const joints = Number(r.jointsW ?? 0);
  const standby = Number(r.standbyW ?? 0);
  return (
    <div className="lab">
      <div className="readouts readouts--3">
        <Readout label="Pack voltage" value={n(r.batteryV, 1)} unit="V" />
        <Readout label="Current" value={n(r.batteryA, 1)} unit="A" />
        <Readout label="Power" value={n(r.batteryW)} unit="W" />
        <Readout label="Charge" value={n(Number(r.soc) * 100)} unit="%" />
        <Readout label="Runtime now" value={n(r.runtimeH, 1)} unit="h" />
        <Readout label="Pack" value={n(r.packC)} unit="°C" />
      </div>
      <Bar label="Joints" value={joints} limit={Math.max(1, joints + lv + standby)} unit="W" />
      <Bar label="Computers and sensors (via DC/DC)" value={lv} limit={Math.max(1, joints + lv + standby)} unit="W" />
      <Bar label="Drives on standby" value={standby} limit={Math.max(1, joints + lv + standby)} unit="W" />
      <p className="note-small">Standing still, the computers draw more than the motors: most of a humanoid's standing power is electronics and holding torque.</p>
    </div>
  );
}

export function ThermalLive({ world }: { world: World }) {
  const r = useApp((s) => s.readouts);
  const hist = useRef<number[]>([]);
  useEffect(() => {
    hist.current.push(Number(r.hottestC ?? 30));
    if (hist.current.length > 300) hist.current.shift();
  }, [r]);
  const series = useMemo(() => [{ label: 'Hottest winding', color: '#ff8a74', values: () => hist.current }], []);
  const T = Number(r.hottestC ?? 30);
  void world;
  return (
    <div className="lab">
      <p className="note-small">FO-H1 is doing squats; heating is sped up 40× so minutes pass in seconds.</p>
      <Bar label={`Hottest winding · ${r.hottestJoint ?? ''}`} value={T} limit={WINDING.shutdown} soft={WINDING.derateStart} unit="°C" note={`Derating starts at ${WINDING.derateStart} °C, shutdown at ${WINDING.shutdown} °C.`} />
      <Plot title="Temperature" series={series} unit="°C" height={60} />
      <div className="readouts readouts--3">
        <Readout label="Perception computer" value={n(r.computeC)} unit="°C" />
        <Readout label="Battery" value={n(r.packC, 1)} unit="°C" />
        <Readout label="Copper loss now" value={n(r.copperW)} unit="W" />
      </div>
    </div>
  );
}

export function BalanceLive() {
  const r = useApp((s) => s.readouts);
  return (
    <div className="lab">
      <Split left={Number(r.loadL ?? 0.5)} right={Number(r.loadR ?? 0.5)} labels={['Left foot', 'Right foot']} />
      <div className="readouts readouts--3">
        <Readout label="COM height" value={n(Number(r.comY) * 100)} unit="cm" />
        <Readout label="Margin" value={n(Number(r.margin) * 1000)} unit="mm" />
        <Readout label="Ground force" value={n(Number(r.grfL ?? 0) + Number(r.grfR ?? 0))} unit="N" />
      </div>
    </div>
  );
}
