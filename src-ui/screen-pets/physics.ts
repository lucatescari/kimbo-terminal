import type { Bounds, Vec2 } from "./types";

/** Downward acceleration in pixels / second². */
export const GRAVITY = 1400;

export interface EdgeHits { left: boolean; right: boolean; top: boolean; floor: boolean; }

export function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function applyGravity(vel: Vec2, dt: number, g = GRAVITY): void {
  vel.y += g * dt;
}

export function integrate(pos: Vec2, vel: Vec2, dt: number): void {
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
}

/**
 * Clamp a w×h box (top-left at `pos`) inside `bounds`, mutating `pos`.
 * Returns which edges were touched so callers can reflect velocity.
 */
export function clampInside(pos: Vec2, bounds: Bounds, w: number, h: number): EdgeHits {
  const hits: EdgeHits = { left: false, right: false, top: false, floor: false };
  if (pos.x < bounds.left) { pos.x = bounds.left; hits.left = true; }
  if (pos.x + w > bounds.right) { pos.x = bounds.right - w; hits.right = true; }
  if (pos.y < bounds.top) { pos.y = bounds.top; hits.top = true; }
  if (pos.y + h > bounds.bottom) { pos.y = bounds.bottom - h; hits.floor = true; }
  return hits;
}
