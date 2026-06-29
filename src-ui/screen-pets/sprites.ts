import type { Species, Locomotion, SpriteToken, PetState } from "./types";

export interface SpeciesSpec {
  locomotion: Locomotion;
  colors: string[];
  defaultColor: string;
  tokens: SpriteToken[];
}

const BASE: SpriteToken[] = ["idle", "walk", "walk_fast", "run", "swipe", "with_ball"];
const BASE_LIE: SpriteToken[] = [...BASE, "lie"];

export const SPECIES: Record<Species, SpeciesSpec> = {
  cat: {
    locomotion: "climber",
    colors: ["black", "brown", "gray", "lightbrown", "orange", "white"],
    defaultColor: "brown",
    tokens: [...BASE, "wallclimb", "wallgrab", "land", "fall_from_grab"],
  },
  dog:       { locomotion: "floor", colors: ["akita", "black", "brown", "red", "white"], defaultColor: "brown", tokens: BASE_LIE },
  snake:     { locomotion: "floor", colors: ["green"], defaultColor: "green", tokens: BASE },
  crab:      { locomotion: "floor", colors: ["red"], defaultColor: "red", tokens: BASE },
  chicken:   { locomotion: "floor", colors: ["brown", "white"], defaultColor: "white", tokens: BASE },
  turtle:    { locomotion: "floor", colors: ["green", "orange"], defaultColor: "green", tokens: BASE_LIE },
  fox:       { locomotion: "floor", colors: ["red", "white"], defaultColor: "red", tokens: BASE_LIE },
  snail:     { locomotion: "floor", colors: ["brown"], defaultColor: "brown", tokens: BASE },
  panda:     { locomotion: "floor", colors: ["black", "brown"], defaultColor: "black", tokens: BASE_LIE },
  cockatiel: { locomotion: "flyer", colors: ["brown", "gray"], defaultColor: "gray", tokens: BASE },
};

export function speciesList(): Species[] {
  return Object.keys(SPECIES) as Species[];
}

export function spriteUrl(species: Species, color: string, token: SpriteToken): string {
  return `/pets/${species}/${color}_${token}_8fps.gif`;
}

/** Preference-ordered fallbacks for each logical state. First token the species has wins. */
const STATE_TOKENS: Record<PetState, SpriteToken[]> = {
  idle:        ["idle"],
  walk:        ["walk", "idle"],
  run:         ["run", "walk", "idle"],
  chase:       ["run", "walk", "idle"],
  withBall:    ["with_ball", "walk", "idle"],
  swipe:       ["swipe", "idle"],
  lie:         ["lie", "idle"],
  falling:     ["fall_from_grab", "idle"],
  fallFromGrab:["fall_from_grab", "idle"],
  land:        ["land", "idle"],
  wallgrab:    ["wallgrab", "walk", "idle"],
  wallclimb:   ["wallclimb", "walk", "idle"],
};

export function tokenForState(species: Species, state: PetState): SpriteToken {
  const have = SPECIES[species].tokens;
  for (const t of STATE_TOKENS[state]) {
    if (have.includes(t)) return t;
  }
  return "idle";
}
