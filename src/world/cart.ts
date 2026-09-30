/**
 * The mobile cart (an autonomous mobile robot base with a tray and a shelf) parked in front of
 * FO-H1, and what stands on it. Shared by the props (drawing), the manipulation lab (grasps)
 * and the vision view (segmentation classes). Positions in the world; the robot faces +Z.
 */
import { Vector3 } from 'three';

export const CART = {
  /** Centre of the base on the floor. */
  pos: new Vector3(0.02, 0, 0.62),
  /** Tray: top surface height, width (X) and depth (Z). */
  deckY: 0.9,
  deckW: 0.72,
  deckD: 0.48,
  /** Upper shelf height (on a mast at the back) and its depth. */
  shelfY: 1.3,
  shelfD: 0.32,
  baseH: 0.3,
};

export type ItemId = 'box' | 'vial' | 'tool' | 'cup' | 'wet';

export interface CartItem {
  id: ItemId;
  label: string;
  /** Resting centre (world). */
  rest: Vector3;
  /** Bounding size (X, Y, Z), m. */
  size: Vector3;
  shape: 'tote' | 'vial' | 'driver' | 'beaker' | 'bottle';
  /** Hands used: the right hand alone or both. */
  hands: 'R' | 'both';
  /** Grasp point relative to the item's centre (for one hand), m. */
  grip: Vector3;
  /** Finger closure when holding (0 open … 1 closed) and the pinch (thumb and index only). */
  closure: number;
  pinch: boolean;
  /** Segmentation class colour in the robot's view. */
  seg: string;
}

const d = CART.deckY;

export const ITEMS: Record<ItemId, CartItem> = {
  box: { id: 'box', label: 'Parts box', rest: new Vector3(0.12, d + 0.075, 0.5), size: new Vector3(0.3, 0.15, 0.2), shape: 'tote', hands: 'both', grip: new Vector3(0.155, 0.02, 0), closure: 0.3, pinch: false, seg: '#e0a84f' },
  vial: { id: 'vial', label: 'Glass vial', rest: new Vector3(-0.05, d + 0.045, 0.45), size: new Vector3(0.024, 0.09, 0.024), shape: 'vial', hands: 'R', grip: new Vector3(0, 0.025, 0), closure: 0.58, pinch: true, seg: '#5fc7d8' },
  tool: { id: 'tool', label: 'Cordless driver', rest: new Vector3(-0.21, d + 0.105, 0.6), size: new Vector3(0.06, 0.21, 0.19), shape: 'driver', hands: 'R', grip: new Vector3(0, 0.0, -0.02), closure: 0.78, pinch: false, seg: '#e2685a' },
  cup: { id: 'cup', label: 'Beaker', rest: new Vector3(-0.16, d + 0.06, 0.45), size: new Vector3(0.08, 0.12, 0.08), shape: 'beaker', hands: 'R', grip: new Vector3(0, 0.0, 0), closure: 0.55, pinch: false, seg: '#9f8cff' },
  wet: { id: 'wet', label: 'Wet bottle', rest: new Vector3(-0.28, d + 0.1, 0.46), size: new Vector3(0.07, 0.2, 0.07), shape: 'bottle', hands: 'R', grip: new Vector3(0, 0.0, 0), closure: 0.6, pinch: false, seg: '#6fcf8f' },
};

/** Where the parts box goes in the shelf task. */
export const SHELF_SPOT = new Vector3(0.1, CART.shelfY + 0.075, 0.62);
