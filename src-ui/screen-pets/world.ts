import type { PetEntity, BallEntity, PetInstance, Bounds, Vec2, Rng } from "./types";
import { createPet, stepPet, type PetStepCtx } from "./pet";
import { createBall, stepBall } from "./ball";

const MAX_DT = 0.05; // clamp to avoid huge jumps after the tab was backgrounded

export interface World {
  entities: PetEntity[];
  ball: BallEntity | null;
  bounds: Bounds;
  clock: number;
  rng: Rng;
  speedMul: number;
}

export function createWorld(bounds: Bounds, rng: Rng, speedMul = 1): World {
  return { entities: [], ball: null, bounds: { ...bounds }, clock: 0, rng, speedMul };
}

export function addPet(world: World, inst: PetInstance): PetEntity {
  const pet = createPet(inst, world.bounds, world.rng);
  world.entities.push(pet);
  return pet;
}

export function removePet(world: World, id: string): PetEntity | null {
  const i = world.entities.findIndex((e) => e.id === id);
  if (i < 0) return null;
  return world.entities.splice(i, 1)[0];
}

export function setBounds(world: World, bounds: Bounds): void {
  world.bounds = { ...bounds };
}

export function throwBall(world: World, from: Vec2, vel: Vec2): void {
  world.ball = createBall(from, vel);
}

export function stepWorld(world: World, dt: number): void {
  const step = Math.min(dt, MAX_DT);
  world.clock += step;
  if (world.ball) stepBall(world.ball, world.bounds, step);
  const ctx: PetStepCtx = {
    bounds: world.bounds,
    ball: world.ball,
    clock: world.clock,
    rng: world.rng,
    speedMul: world.speedMul,
  };
  for (const pet of world.entities) stepPet(pet, ctx, step);
}
