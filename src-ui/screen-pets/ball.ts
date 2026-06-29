import type { BallEntity, Bounds, Vec2 } from "./types";
import { applyGravity, integrate, clampInside } from "./physics";

export const BALL_SIZE = 22;
const DAMPING = 0.6;          // energy kept per bounce
const REST_SPEED = 40;        // below this vertical speed on the floor, the ball rests

export function createBall(pos: Vec2, vel: Vec2): BallEntity {
  return { pos: { ...pos }, vel: { ...vel }, resting: false, grabbed: false, el: null };
}

export function stepBall(ball: BallEntity, bounds: Bounds, dt: number): void {
  if (ball.resting || ball.grabbed) return;

  applyGravity(ball.vel, dt);
  integrate(ball.pos, ball.vel, dt);
  const hits = clampInside(ball.pos, bounds, BALL_SIZE, BALL_SIZE);

  if (hits.left || hits.right) ball.vel.x = -ball.vel.x * DAMPING;
  if (hits.top) ball.vel.y = Math.abs(ball.vel.y) * DAMPING;
  if (hits.floor) {
    ball.vel.y = -Math.abs(ball.vel.y) * DAMPING;
    ball.vel.x *= DAMPING;
    if (Math.abs(ball.vel.y) < REST_SPEED && Math.abs(ball.vel.x) < REST_SPEED) {
      ball.vel.x = 0;
      ball.vel.y = 0;
      ball.resting = true;
    }
  }
}
