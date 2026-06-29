import { describe, it, expect } from "vitest";
import { GRAVITY, distance, applyGravity, integrate, clampInside } from "./physics";
import type { Bounds, Vec2 } from "./types";

const B: Bounds = { left: 0, top: 0, right: 100, bottom: 100 };

describe("physics", () => {
  it("computes euclidean distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("applies gravity to vertical velocity", () => {
    const v: Vec2 = { x: 0, y: 0 };
    applyGravity(v, 0.5);
    expect(v.y).toBeCloseTo(GRAVITY * 0.5);
  });

  it("integrates position by velocity*dt", () => {
    const p: Vec2 = { x: 0, y: 0 };
    integrate(p, { x: 10, y: -20 }, 0.5);
    expect(p).toEqual({ x: 5, y: -10 });
  });

  it("clamps to the floor and reports the floor hit", () => {
    const p: Vec2 = { x: 10, y: 90 };       // h=20 -> bottom edge at 110, past floor 100
    const hits = clampInside(p, B, 20, 20);
    expect(hits.floor).toBe(true);
    expect(p.y).toBe(80);                     // 100 - 20
  });

  it("clamps to side walls and reports the edge", () => {
    const p: Vec2 = { x: -5, y: 10 };
    const hits = clampInside(p, B, 20, 20);
    expect(hits.left).toBe(true);
    expect(p.x).toBe(0);
  });

  it("reports no hits when fully inside", () => {
    const p: Vec2 = { x: 40, y: 40 };
    expect(clampInside(p, B, 20, 20)).toEqual({ left: false, right: false, top: false, floor: false });
  });
});
