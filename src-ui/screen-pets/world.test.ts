import { describe, it, expect } from "vitest";
import { createWorld, stepWorld, addPet, removePet, setBounds, throwBall } from "./world";
import type { Bounds } from "./types";

const B: Bounds = { left: 0, top: 0, right: 800, bottom: 400 };
const rng = () => 0.5;

describe("world", () => {
  it("adds and removes pets by id", () => {
    const w = createWorld(B, rng);
    addPet(w, { id: "a", species: "dog", color: "brown", name: "A" });
    addPet(w, { id: "b", species: "cat", color: "brown", name: "B" });
    expect(w.entities.map((e) => e.id)).toEqual(["a", "b"]);
    const removed = removePet(w, "a");
    expect(removed?.id).toBe("a");
    expect(w.entities.map((e) => e.id)).toEqual(["b"]);
  });

  it("advances the clock by clamped dt", () => {
    const w = createWorld(B, rng);
    stepWorld(w, 0.02);
    expect(w.clock).toBeCloseTo(0.02);
    stepWorld(w, 10); // clamped to 0.05
    expect(w.clock).toBeCloseTo(0.07);
  });

  it("steps the ball each frame", () => {
    const w = createWorld(B, rng);
    throwBall(w, { x: 100, y: 50 }, { x: 0, y: 0 });
    const y0 = w.ball!.pos.y;
    stepWorld(w, 0.05);
    expect(w.ball!.pos.y).toBeGreaterThan(y0);
  });

  it("replacing the ball via throwBall resets it", () => {
    const w = createWorld(B, rng);
    throwBall(w, { x: 10, y: 10 }, { x: 0, y: 0 });
    throwBall(w, { x: 700, y: 10 }, { x: -100, y: 0 });
    expect(w.ball!.pos.x).toBe(700);
    expect(w.ball!.resting).toBe(false);
  });

  it("setBounds updates the roam area", () => {
    const w = createWorld(B, rng);
    setBounds(w, { left: 0, top: 0, right: 200, bottom: 200 });
    expect(w.bounds.right).toBe(200);
  });
});
