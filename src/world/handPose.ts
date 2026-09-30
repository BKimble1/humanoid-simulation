/**
 * Hand poses. A hand is six coupled finger actuators, so its pose is seven numbers: the flexion
 * of the four fingers, the thumb's flexion and opposition, and the spread. Hand poses are part
 * of the robot's displayed pose: every pose source states both hands every frame, and the pose
 * driver blends them with the body, so a hand never snaps and never keeps a stale grasp.
 */
import type { Side } from '../spec/body';

export interface HandPose {
  /** Flexion of index, middle, ring and little fingers, 0 (open) … 1 (closed fist). */
  fingers: [number, number, number, number];
  /** Thumb flexion (towards the palm) and opposition (across it), 0 … 1. */
  thumbFlex: number;
  thumbOpp: number;
  /** Spread of the fingers (abduction), 0 … 1. */
  spread: number;
}

/** Relaxed, slightly curled: how the hands rest. */
export const OPEN_HAND: Readonly<HandPose> = { fingers: [0.12, 0.12, 0.14, 0.16], thumbFlex: 0.1, thumbOpp: 0.2, spread: 0.1 };

export const HAND_N = 7;

export function handPose(p: Partial<HandPose> = {}): HandPose {
  return { fingers: [...(p.fingers ?? OPEN_HAND.fingers)] as HandPose['fingers'], thumbFlex: p.thumbFlex ?? OPEN_HAND.thumbFlex, thumbOpp: p.thumbOpp ?? OPEN_HAND.thumbOpp, spread: p.spread ?? OPEN_HAND.spread };
}

export function bothHands(p: Partial<HandPose> = {}): Record<Side, HandPose> {
  return { L: handPose(p), R: handPose(p) };
}

export function copyHand(dst: HandPose, src: Readonly<HandPose>): HandPose {
  dst.fingers[0] = src.fingers[0];
  dst.fingers[1] = src.fingers[1];
  dst.fingers[2] = src.fingers[2];
  dst.fingers[3] = src.fingers[3];
  dst.thumbFlex = src.thumbFlex;
  dst.thumbOpp = src.thumbOpp;
  dst.spread = src.spread;
  return dst;
}

/** Set a hand to the relaxed pose (optionally curled a little more). */
export function relax(dst: HandPose, curl = 0): HandPose {
  copyHand(dst, OPEN_HAND);
  if (curl) for (let i = 0; i < 4; i++) dst.fingers[i] += curl;
  return dst;
}

export function handToArray(h: Readonly<HandPose>, out: Float64Array | number[], at = 0) {
  out[at] = h.fingers[0];
  out[at + 1] = h.fingers[1];
  out[at + 2] = h.fingers[2];
  out[at + 3] = h.fingers[3];
  out[at + 4] = h.thumbFlex;
  out[at + 5] = h.thumbOpp;
  out[at + 6] = h.spread;
}

export function handFromArray(a: ArrayLike<number>, h: HandPose, at = 0): HandPose {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  h.fingers[0] = c(a[at]);
  h.fingers[1] = c(a[at + 1]);
  h.fingers[2] = c(a[at + 2]);
  h.fingers[3] = c(a[at + 3]);
  h.thumbFlex = c(a[at + 4]);
  h.thumbOpp = c(a[at + 5]);
  h.spread = c(a[at + 6]);
  return h;
}
