/** The generic-animal species Kimbo ships (license-clean subset of VS Code Pets). */
export type Species =
  | "cat" | "dog" | "snake" | "crab" | "chicken"
  | "turtle" | "fox" | "snail" | "panda" | "cockatiel";

/** How a species moves. */
export type Locomotion = "floor" | "climber" | "flyer";

/** Logical behavior state of a pet (not all map 1:1 to a sprite). */
export type PetState =
  | "falling" | "idle" | "walk" | "run" | "lie" | "swipe"
  | "chase" | "withBall" | "wallgrab" | "wallclimb" | "land" | "fallFromGrab";

/** Sprite-file token as it appears in the vendored filenames. */
export type SpriteToken =
  | "idle" | "walk" | "walk_fast" | "run" | "swipe" | "with_ball"
  | "lie" | "wallclimb" | "wallgrab" | "land" | "fall_from_grab";

export interface Vec2 { x: number; y: number; }

/** Pixel rectangle of the roam area, relative to the pets-layer top-left. */
export interface Bounds { left: number; top: number; right: number; bottom: number; }

/** Persisted shape of one pet (stored in ui-prefs.screenPets). */
export interface PetInstance {
  id: string;
  species: Species;
  color: string;
  name: string;
}

/** Runtime entity. `pos` is the sprite's top-left in layer pixels. */
export interface PetEntity {
  id: string;
  species: Species;
  color: string;
  name: string;
  locomotion: Locomotion;
  pos: Vec2;
  vel: Vec2;
  state: PetState;
  facing: 1 | -1;          // 1 = facing right, -1 = facing left (scaleX)
  target: Vec2 | null;     // current movement target
  stateUntil: number;      // world.clock (seconds) at which to re-decide
  grabbed: boolean;        // being dragged by the pointer
  el: HTMLElement | null;
  img: HTMLImageElement | null;
}

export interface BallEntity {
  pos: Vec2;
  vel: Vec2;
  resting: boolean;
  grabbed: boolean;
  el: HTMLElement | null;
}

export type Rng = () => number;
