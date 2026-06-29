import { describe, it, expect } from "vitest";
import { createPet, stepPet, PET_H, PET_W, type PetStepCtx } from "./pet";
import { createBall } from "./ball";
import type { Bounds, PetInstance } from "./types";

const B: Bounds = { left: 0, top: 0, right: 800, bottom: 400 };
// deterministic RNG: always returns 0.5
const rng = () => 0.5;
const ctx = (over: Partial<PetStepCtx> = {}): PetStepCtx =>
  ({ bounds: B, ball: null, clock: 0, rng, speedMul: 1, ...over });

const inst = (over: Partial<PetInstance> = {}): PetInstance =>
  ({ id: "p1", species: "dog", color: "brown", name: "Rex", ...over });

describe("pet", () => {
  it("derives locomotion from the species", () => {
    expect(createPet(inst(), B, rng).locomotion).toBe("floor");
    expect(createPet(inst({ species: "cat" }), B, rng).locomotion).toBe("climber");
    expect(createPet(inst({ species: "cockatiel" }), B, rng).locomotion).toBe("flyer");
  });

  it("a floor walker falls until it lands on the floor", () => {
    const pet = createPet(inst(), B, rng);
    pet.pos = { x: 100, y: 0 };
    pet.vel = { x: 0, y: 0 };
    for (let i = 0; i < 120; i++) stepPet(pet, ctx({ clock: i * 0.05 }), 0.05);
    expect(pet.pos.y).toBeCloseTo(B.bottom - PET_H, 0);
    expect(pet.state === "idle" || pet.state === "walk" || pet.state === "run" || pet.state === "lie").toBe(true);
  });

  it("a flyer never sinks to the floor", () => {
    const pet = createPet(inst({ species: "cockatiel" }), B, rng);
    pet.pos = { x: 100, y: 100 };
    for (let i = 0; i < 200; i++) stepPet(pet, ctx({ clock: i * 0.05 }), 0.05);
    expect(pet.pos.y).toBeLessThan(B.bottom - PET_H);
  });

  it("a walker chases a nearby resting ball", () => {
    const pet = createPet(inst(), B, rng);
    pet.pos = { x: 100, y: B.bottom - PET_H };
    const ball = createBall({ x: 300, y: B.bottom - 22 }, { x: 0, y: 0 });
    ball.resting = true;
    stepPet(pet, ctx({ ball, clock: 1 }), 0.05);
    expect(pet.state).toBe("chase");
    expect(pet.facing).toBe(1); // ball is to the right
  });

  it("enters withBall on contact with the ball", () => {
    const pet = createPet(inst(), B, rng);
    pet.pos = { x: 300, y: B.bottom - PET_H };
    const ball = createBall({ x: 305, y: B.bottom - 22 }, { x: 0, y: 0 });
    ball.resting = true;
    stepPet(pet, ctx({ ball, clock: 1 }), 0.05);
    expect(pet.state).toBe("withBall");
  });

  it("stays within horizontal bounds", () => {
    const pet = createPet(inst(), B, rng);
    pet.pos = { x: B.right - PET_W + 5, y: B.bottom - PET_H };
    for (let i = 0; i < 50; i++) stepPet(pet, ctx({ clock: i * 0.05 }), 0.05);
    expect(pet.pos.x).toBeLessThanOrEqual(B.right - PET_W);
    expect(pet.pos.x).toBeGreaterThanOrEqual(B.left);
  });
});
