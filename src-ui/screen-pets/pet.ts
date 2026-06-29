import type { PetEntity, PetInstance, Bounds, BallEntity, Rng } from "./types";
import { SPECIES } from "./sprites";
import { applyGravity, integrate, clampInside, distance } from "./physics";
import { BALL_SIZE } from "./ball";

export const PET_W = 48;
export const PET_H = 48;

const BASE_WALK = 55;     // px/s at speedMul 1
const RUN_MULT = 2.2;
const FLY_SPEED = 90;
const CHASE_RANGE = 260;  // px; within this a walker chases the ball
const CONTACT = 36;       // px center distance counted as "touching" the ball

export interface PetStepCtx {
  bounds: Bounds;
  ball: BallEntity | null;
  clock: number;   // seconds since world start
  rng: Rng;
  speedMul: number;
}

function center(pos: { x: number; y: number }, w: number, h: number) {
  return { x: pos.x + w / 2, y: pos.y + h / 2 };
}

export function createPet(inst: PetInstance, bounds: Bounds, rng: Rng): PetEntity {
  const locomotion = SPECIES[inst.species].locomotion;
  const x = bounds.left + rng() * Math.max(1, bounds.right - bounds.left - PET_W);
  const y = locomotion === "flyer"
    ? bounds.top + rng() * Math.max(1, bounds.bottom - bounds.top - PET_H)
    : bounds.bottom - PET_H;
  return {
    id: inst.id,
    species: inst.species,
    color: inst.color,
    name: inst.name,
    locomotion,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    state: "idle",
    facing: 1,
    target: null,
    stateUntil: 0,
    grabbed: false,
    el: null,
    img: null,
  };
}

export function stepPet(pet: PetEntity, ctx: PetStepCtx, dt: number): void {
  if (pet.grabbed) return;

  const ball = ctx.ball && !ctx.ball.grabbed ? ctx.ball : null;

  if (pet.locomotion === "flyer") {
    stepFlyer(pet, ctx, dt, ball);
  } else {
    stepGround(pet, ctx, dt, ball);
  }
}

function stepGround(pet: PetEntity, ctx: PetStepCtx, dt: number, ball: BallEntity | null): void {
  const { bounds } = ctx;
  const onFloor = pet.pos.y + PET_H >= bounds.bottom - 0.5;

  // Ball interaction takes priority once grounded.
  if (ball && onFloor) {
    const pc = center(pet.pos, PET_W, PET_H);
    const bc = center(ball.pos, BALL_SIZE, BALL_SIZE);
    const d = distance(pc, bc);
    if (d < CONTACT) {
      pet.state = "withBall";
      pet.vel.x = 0;
      // nudge the ball away in the direction the pet faces
      ball.resting = false;
      ball.vel.x = pet.facing * 220;
      ball.vel.y = -260;
      return;
    }
    if (d < CHASE_RANGE) {
      pet.state = "chase";
      pet.facing = bc.x >= pc.x ? 1 : -1;
      pet.vel.x = pet.facing * BASE_WALK * RUN_MULT * ctx.speedMul;
      applyGravity(pet.vel, dt);
      integrate(pet.pos, pet.vel, dt);
      const hit = clampInside(pet.pos, bounds, PET_W, PET_H);
      if (hit.floor) pet.vel.y = 0;
      return;
    }
  }

  // Re-decide behavior when the timer expires (and we're grounded).
  if (onFloor && ctx.clock >= pet.stateUntil) {
    pickGroundBehavior(pet, ctx);
  }

  // Horizontal motion per current state.
  if (pet.state === "walk") pet.vel.x = pet.facing * BASE_WALK * ctx.speedMul;
  else if (pet.state === "run") pet.vel.x = pet.facing * BASE_WALK * RUN_MULT * ctx.speedMul;
  else if (pet.state === "idle" || pet.state === "lie") pet.vel.x = 0;

  applyGravity(pet.vel, dt);
  integrate(pet.pos, pet.vel, dt);
  const hits = clampInside(pet.pos, bounds, PET_W, PET_H);
  if (hits.floor) {
    pet.vel.y = 0;
    if (pet.state === "falling") pickGroundBehavior(pet, ctx);
  } else if (pet.pos.y + PET_H < bounds.bottom - 1 && pet.state !== "falling") {
    pet.state = "falling";
  }
  if (hits.left) pet.facing = 1;
  if (hits.right) pet.facing = -1;
}

function pickGroundBehavior(pet: PetEntity, ctx: PetStepCtx): void {
  const r = ctx.rng();
  const canLie = SPECIES[pet.species].tokens.includes("lie");
  if (r < 0.25) {
    pet.state = "idle";
  } else if (canLie && r < 0.35) {
    pet.state = "lie";
  } else if (r < 0.55) {
    pet.state = "run";
    pet.facing = ctx.rng() < 0.5 ? -1 : 1;
  } else {
    pet.state = "walk";
    pet.facing = ctx.rng() < 0.5 ? -1 : 1;
  }
  pet.stateUntil = ctx.clock + 1.5 + ctx.rng() * 3;
}

function stepFlyer(pet: PetEntity, ctx: PetStepCtx, dt: number, ball: BallEntity | null): void {
  // MVP: flyers ignore the ball (kept for signature symmetry with stepGround).
  const { bounds } = ctx;
  if (!pet.target || ctx.clock >= pet.stateUntil) {
    pet.target = {
      x: bounds.left + ctx.rng() * Math.max(1, bounds.right - bounds.left - PET_W),
      y: bounds.top + ctx.rng() * Math.max(1, bounds.bottom - bounds.top - PET_H),
    };
    pet.stateUntil = ctx.clock + 2 + ctx.rng() * 3;
    pet.state = ctx.rng() < 0.25 ? "idle" : "walk";
  }

  const tc = pet.target;
  const dx = tc.x - pet.pos.x;
  const dy = tc.y - pet.pos.y;
  const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const speed = FLY_SPEED * ctx.speedMul;
  if (pet.state !== "idle") {
    pet.vel.x = (dx / dist) * speed;
    pet.vel.y = (dy / dist) * speed;
    pet.facing = dx >= 0 ? 1 : -1;
  } else {
    pet.vel.x = 0;
    pet.vel.y = 0;
  }
  integrate(pet.pos, pet.vel, dt);
  clampInside(pet.pos, bounds, PET_W, PET_H);

  // Reached target -> hover briefly then a new target is chosen next decision.
  if (dist < 8) pet.state = "idle";
}
