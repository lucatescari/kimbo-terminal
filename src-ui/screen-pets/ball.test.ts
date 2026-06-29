import { describe, it, expect } from "vitest";
import { createBall, stepBall, BALL_SIZE } from "./ball";
import type { Bounds } from "./types";

const B: Bounds = { left: 0, top: 0, right: 500, bottom: 300 };

describe("ball", () => {
  it("falls under gravity", () => {
    const ball = createBall({ x: 100, y: 0 }, { x: 0, y: 0 });
    stepBall(ball, B, 0.1);
    expect(ball.pos.y).toBeGreaterThan(0);
  });

  it("bounces off the floor with damping (loses energy)", () => {
    const ball = createBall({ x: 100, y: B.bottom - BALL_SIZE }, { x: 0, y: 600 });
    stepBall(ball, B, 0.05);
    expect(ball.vel.y).toBeLessThan(0); // reflected upward
    expect(Math.abs(ball.vel.y)).toBeLessThan(600); // damped
  });

  it("comes to rest on the floor", () => {
    const ball = createBall({ x: 100, y: B.bottom - BALL_SIZE }, { x: 0, y: 5 });
    for (let i = 0; i < 200; i++) stepBall(ball, B, 0.05);
    expect(ball.resting).toBe(true);
    expect(ball.pos.y).toBeCloseTo(B.bottom - BALL_SIZE, 0);
  });

  it("does not move once resting", () => {
    const ball = createBall({ x: 100, y: B.bottom - BALL_SIZE }, { x: 0, y: 0 });
    ball.resting = true;
    const before = { ...ball.pos };
    stepBall(ball, B, 0.1);
    expect(ball.pos).toEqual(before);
  });
});
