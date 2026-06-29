import { describe, it, expect } from "vitest";
import { SPECIES, spriteUrl, tokenForState, speciesList } from "./sprites";

describe("sprites", () => {
  it("builds the vendored url convention", () => {
    expect(spriteUrl("dog", "brown", "walk")).toBe("/pets/dog/brown_walk_8fps.gif");
  });

  it("knows the cat climbs and the cockatiel flies", () => {
    expect(SPECIES.cat.locomotion).toBe("climber");
    expect(SPECIES.cockatiel.locomotion).toBe("flyer");
    expect(SPECIES.dog.locomotion).toBe("floor");
  });

  it("maps logical states to existing sprite tokens", () => {
    expect(tokenForState("dog", "chase")).toBe("run");
    expect(tokenForState("dog", "withBall")).toBe("with_ball");
    expect(tokenForState("cat", "wallclimb")).toBe("wallclimb");
  });

  it("falls back when a species lacks a token", () => {
    // dog has no wallclimb sprite -> degrade to walk
    expect(tokenForState("dog", "wallclimb")).toBe("walk");
    // snake has no lie sprite -> degrade to idle
    expect(tokenForState("snake", "lie")).toBe("idle");
    // floor walker falling -> idle (no fall_from_grab sprite)
    expect(tokenForState("dog", "falling")).toBe("idle");
    // cat falling uses its fall_from_grab sprite
    expect(tokenForState("cat", "fallFromGrab")).toBe("fall_from_grab");
  });

  it("lists every shipped species with a valid default color", () => {
    const list = speciesList();
    expect(list).toContain("cat");
    for (const sp of list) {
      expect(SPECIES[sp].colors).toContain(SPECIES[sp].defaultColor);
      expect(SPECIES[sp].tokens).toContain("idle");
    }
  });
});
