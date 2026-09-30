/**
 * Building blocks shared by the labs: number formatting, the signal-chain list, limit
 * callouts, load bars.
 */
import type { ReactNode } from 'react';

/** A number for display, or a dash. */
export const n = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—');

export interface ChainStep {
  label: string;
  formula?: string;
  value: string;
  tone?: 'bad' | 'warn';
}

/** A vertical chain of stages joined by arrows: what each does and its live value. */
export function Chain({ steps, active }: { steps: ChainStep[]; active?: number }) {
  return (
    <ol className="chain" aria-label="Signal chain">
      {steps.map((s, i) => (
        <li key={s.label} className={`chain__step ${s.tone ? `chain__step--${s.tone}` : ''} ${active === i ? 'chain__step--on' : ''}`}>
          <span className="chain__label">
            {s.label}
            {s.formula && <span className="chain__formula">{s.formula}</span>}
          </span>
          <span className="chain__value num">{s.value}</span>
        </li>
      ))}
    </ol>
  );
}

export function Callout({ tone = 'warn', title, children }: { tone?: 'warn' | 'bad' | 'ok'; title: string; children: ReactNode }) {
  return (
    <div className={`callout callout--${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <b className="callout__title">{title}</b>
      <div className="callout__body">{children}</div>
    </div>
  );
}

/** A horizontal bar: value against a limit (and a second, softer limit). */
export function Bar({ label, value, limit, soft, unit, note }: { label: string; value: number; limit: number; soft?: number; unit: string; note?: string }) {
  const max = Math.max(limit, value) * 1.1;
  const pct = Math.min(100, (value / max) * 100);
  const tone = value > limit ? 'bad' : soft !== undefined && value > soft ? 'warn' : 'ok';
  return (
    <div className={`bar bar--${tone}`}>
      <div className="bar__head">
        <span>{label}</span>
        <span className="num">
          {value.toFixed(0)} / {limit.toFixed(0)} {unit}
        </span>
      </div>
      <div className="bar__track">
        <div className="bar__fill" style={{ width: `${pct}%` }} />
        <i className="bar__limit" style={{ left: `${(limit / max) * 100}%` }} />
        {soft !== undefined && <i className="bar__soft" style={{ left: `${(soft / max) * 100}%` }} />}
      </div>
      {note && <p className="bar__note">{note}</p>}
    </div>
  );
}

/** Two-way split bar (left / right foot load). */
export function Split({ left, right, labels }: { left: number; right: number; labels: [string, string] }) {
  const t = Math.max(1e-6, left + right);
  const l = (left / t) * 100;
  return (
    <div className="split">
      <div className="split__head">
        <span>
          {labels[0]} <b className="num">{l.toFixed(0)} %</b>
        </span>
        <span>
          <b className="num">{(100 - l).toFixed(0)} %</b> {labels[1]}
        </span>
      </div>
      <div className="split__track">
        <div className="split__l" style={{ width: `${l}%` }} />
      </div>
    </div>
  );
}
