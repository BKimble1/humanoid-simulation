/**
 * Small interface parts shared by every panel: spec rows with their provenance, readouts,
 * sliders, segmented choices, and a canvas plot that draws itself from a data callback
 * (without re-rendering React every frame).
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { PROVENANCE_HELP, PROVENANCE_LABEL, type Provenance } from '../spec/provenance';

export function Dot({ kind }: { kind: Provenance }) {
  return <span className={`prov prov--${kind}`} title={`${PROVENANCE_LABEL[kind]}: ${PROVENANCE_HELP[kind]}`} aria-label={PROVENANCE_LABEL[kind]} />;
}

export function SpecRow({ label, value, unit, kind, tone }: { label: string; value: ReactNode; unit?: string; kind: Provenance; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`spec ${tone ? `spec--${tone}` : ''}`}>
      <span className="spec__label">{label}</span>
      <span className="spec__value num">
        {value}
        {unit && <span className="spec__unit"> {unit}</span>}
      </span>
      <Dot kind={kind} />
    </div>
  );
}

export function Legend() {
  const kinds: Provenance[] = ['calculated', 'design', 'estimate', 'visual'];
  return (
    <div className="legend" aria-label="What the dots mean">
      {kinds.map((k) => (
        <span key={k} className="legend__item" title={PROVENANCE_HELP[k]}>
          <Dot kind={k} />
          {PROVENANCE_LABEL[k]}
        </span>
      ))}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider pe">
      <div className="slider__head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="num">
          {format ? format(value) : value}
          {unit && <span className="spec__unit"> {unit}</span>}
        </output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ['--pct' as string]: `${pct}%` }} />
      {hint && <p className="slider__hint">{hint}</p>}
    </div>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label?: string; value: T; options: { id: T; label: string; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg pe" role="radiogroup" aria-label={label}>
      {label && <span className="seg__label">{label}</span>}
      <div className="seg__row">
        {options.map((o) => (
          <button key={o.id} role="radio" aria-checked={value === o.id} className="seg__btn" onClick={() => onChange(o.id)} title={o.title}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Readout({ label, value, unit, kind = 'calculated', tone }: { label: string; value: string; unit?: string; kind?: Provenance; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`readout ${tone ? `readout--${tone}` : ''}`}>
      <span className="readout__label">
        {label} <Dot kind={kind} />
      </span>
      <span className="readout__value num">
        {value}
        {unit && <span className="readout__unit"> {unit}</span>}
      </span>
    </div>
  );
}

export interface Series {
  label: string;
  color: string;
  values: () => number[];
  dashed?: boolean;
}

/** A small live plot: draws on every animation frame from `series`, no React updates. */
export function Plot({ series, min, max, height = 86, unit, title }: { series: Series[]; min?: number; max?: number; height?: number; unit?: string; title: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const data = series.map((s) => s.values());
      let lo = min ?? Infinity;
      let hi = max ?? -Infinity;
      if (min === undefined || max === undefined)
        for (const d of data)
          for (const v of d) {
            if (min === undefined) lo = Math.min(lo, v);
            if (max === undefined) hi = Math.max(hi, v);
          }
      if (!isFinite(lo) || !isFinite(hi)) {
        lo = 0;
        hi = 1;
      }
      if (hi - lo < 1e-6) {
        hi += 0.5;
        lo -= 0.5;
      }
      const pad = (hi - lo) * 0.08;
      lo -= min === undefined ? pad : 0;
      hi += max === undefined ? pad : 0;
      // grid
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = Math.round((h * i) / 4) + 0.5;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      if (lo < 0 && hi > 0) {
        const y0 = h - ((0 - lo) / (hi - lo)) * h;
        g.strokeStyle = 'rgba(255,255,255,0.14)';
        g.beginPath();
        g.moveTo(0, y0);
        g.lineTo(w, y0);
        g.stroke();
      }
      series.forEach((s, k) => {
        const d = data[k];
        if (d.length < 2) return;
        g.strokeStyle = s.color;
        g.lineWidth = 1.6;
        g.setLineDash(s.dashed ? [4, 3] : []);
        g.beginPath();
        d.forEach((v, i) => {
          const x = (i / (d.length - 1)) * w;
          const y = h - ((v - lo) / (hi - lo)) * h;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.stroke();
      });
      g.setLineDash([]);
      g.fillStyle = 'rgba(183,187,196,0.7)';
      g.font = '10px Inter Variable, system-ui';
      g.fillText(`${fmt(hi)}${unit ? ' ' + unit : ''}`, 4, 11);
      g.fillText(fmt(lo), 4, h - 4);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [series, min, max, unit]);
  return (
    <figure className="plot">
      <figcaption className="plot__head">
        <span>{title}</span>
        <span className="plot__keys">
          {series.map((s) => (
            <span key={s.label} className="plot__key">
              <i style={{ background: s.color, opacity: s.dashed ? 0.6 : 1 }} />
              {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      <canvas ref={ref} className="plot__canvas" style={{ height }} aria-hidden />
    </figure>
  );
}

function fmt(v: number): string {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

export function Btn({ children, onClick, primary, disabled, title, pressed }: { children: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string; pressed?: boolean }) {
  return (
    <button className={`btn pe ${primary ? 'btn--primary' : ''}`} onClick={onClick} disabled={disabled} title={title} aria-pressed={pressed}>
      {children}
    </button>
  );
}
