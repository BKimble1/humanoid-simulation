/**
 * ZMP preview control (Kajita et al., "Biped walking pattern generation by using preview
 * control of zero-moment point", ICRA 2003), in its LQ-tracking form.
 *
 * The COM moves as a cart on a table: state x = [c, ċ, c̈], input u = jerk, output the ZMP
 *   x_{k+1} = A x_k + B u_k,     p_k = C x_k,     C = [1, 0, −z_c/g]
 * and the jerk minimises  Σ Q·(p − p_ref)² + R·u²  knowing the next N ZMP references:
 *   u_k = −K x_k + Σ_{j=0}^{N−1} f_j · p_ref(k+j+1)
 * K and f_j come from the discrete Riccati equation, solved once at start-up.
 */
import { GRAVITY } from '../spec/motion';

export interface PreviewGains {
  dt: number;
  zc: number;
  N: number;
  K: [number, number, number];
  f: Float64Array;
  A: number[];
  B: number[];
  C: number[];
}

type M3 = number[]; // row-major 3×3

const mm = (a: M3, b: M3): M3 => {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
};
const tr = (a: M3): M3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
const mv = (a: M3, v: number[]) => [0, 1, 2].map((i) => a[i * 3] * v[0] + a[i * 3 + 1] * v[1] + a[i * 3 + 2] * v[2]);

export function previewGains(dt = 0.01, zc = 0.93, horizon = 1.6, Q = 1, R = 1e-6): PreviewGains {
  const A: M3 = [1, dt, (dt * dt) / 2, 0, 1, dt, 0, 0, 1];
  const B = [(dt * dt * dt) / 6, (dt * dt) / 2, dt];
  const C = [1, 0, -zc / GRAVITY];
  // Riccati iteration
  let P: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const CtQC: M3 = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => C[i] * C[j] * Q));
  const At = tr(A);
  for (let it = 0; it < 20000; it++) {
    const PB = mv(P, B);
    const s = R + B[0] * PB[0] + B[1] * PB[1] + B[2] * PB[2];
    const BtPA = mv(tr(mm(P, A)), B); // (BᵀPA)ᵀ = AᵀPᵀB = AᵀPB (P symmetric)
    const AtPA = mm(At, mm(P, A));
    const next: M3 = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) next[i * 3 + j] = AtPA[i * 3 + j] + CtQC[i * 3 + j] - (BtPA[i] * BtPA[j]) / s;
    let diff = 0;
    for (let i = 0; i < 9; i++) diff = Math.max(diff, Math.abs(next[i] - P[i]));
    P = next;
    if (diff < 1e-12 * Math.max(1, Math.abs(P[0]))) break;
  }
  const PB = mv(P, B);
  const s = R + B[0] * PB[0] + B[1] * PB[1] + B[2] * PB[2];
  const BtPA = mv(tr(mm(P, A)), B);
  const K: [number, number, number] = [BtPA[0] / s, BtPA[1] / s, BtPA[2] / s];
  // closed loop Ac = A − B K ; f_j = (1/s) Bᵀ (Acᵀ)^j Cᵀ Q
  const Ac: M3 = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Ac[i * 3 + j] = A[i * 3 + j] - B[i] * K[j];
  const Act = tr(Ac);
  const N = Math.round(horizon / dt);
  const f = new Float64Array(N);
  let X = [C[0] * Q, C[1] * Q, C[2] * Q];
  let sum = 0;
  for (let j = 0; j < N; j++) {
    f[j] = (B[0] * X[0] + B[1] * X[1] + B[2] * X[2]) / s;
    sum += f[j];
    X = mv(Act, X);
  }
  // A finite horizon drops the tail of the series; rescale so that a constant reference is
  // tracked exactly at rest (Σf = K₀), which is what the infinite-horizon law guarantees.
  for (let j = 0; j < N; j++) f[j] *= K[0] / sum;
  return { dt, zc, N, K, f, A, B, C };
}

/** One axis of the cart-table model under preview control. */
export class PreviewAxis {
  x = [0, 0, 0];
  constructor(public g: PreviewGains) {}
  reset(pos: number, vel = 0, acc = 0) {
    this.x = [pos, vel, acc];
  }
  /** Advance one dt given the reference function ref(j) = p_ref(k + j), j ≥ 1. */
  step(ref: (j: number) => number): number {
    const { K, f, N, A, B } = this.g;
    let u = -(K[0] * this.x[0] + K[1] * this.x[1] + K[2] * this.x[2]);
    for (let j = 0; j < N; j++) u += f[j] * ref(j + 1);
    const x = this.x;
    this.x = [
      A[0] * x[0] + A[1] * x[1] + A[2] * x[2] + B[0] * u,
      A[3] * x[0] + A[4] * x[1] + A[5] * x[2] + B[1] * u,
      A[6] * x[0] + A[7] * x[1] + A[8] * x[2] + B[2] * u,
    ];
    return u;
  }
  get zmp(): number {
    const C = this.g.C;
    return C[0] * this.x[0] + C[1] * this.x[1] + C[2] * this.x[2];
  }
}
