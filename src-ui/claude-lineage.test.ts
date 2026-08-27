// @vitest-environment jsdom
//
// Deciding what a Claude session transition MEANS is the whole risk in the
// branch/fork split feature, so it lives in a pure function that can be
// tested without a terminal, a PTY, or a running claude.
//
// The two commands leave different fingerprints, which is why one predicate
// cannot cover both:
//
//   /branch  the pane's OWN session id changes A -> B, and B's transcript
//            records forkedFrom.sessionId === A. The original stops running.
//   /fork    the pane's session id does NOT change. A new background session
//            appears alongside it and both keep running.
//
// The costly mistake here is splitting when nothing happened — most of all on
// startup, when every pane reports its session for the first time and a naive
// "id changed" check fires for all of them at once.

import { describe, it, expect } from "vitest";
import { classifyTransition, type LineageEvent } from "./claude-lineage";

const NONE: LineageEvent = { kind: "none" };

describe("classifyTransition", () => {
  it("says nothing on the first observation of a pane", () => {
    // Startup: Kimbo has never seen this pane before. Its session id is not
    // "new", we simply had not looked. Splitting here would split every pane
    // with claude already running, at launch, all at once.
    expect(
      classifyTransition({
        previousSessionId: null,
        currentSessionId: "aaaa",
        forkedFromSessionId: null,
        newBackgroundSessionIds: [],
      }),
    ).toEqual(NONE);
  });

  it("says nothing when a first observation coincides with a background session", () => {
    // Same startup case, but claude agents happens to report a background
    // session that has been running for hours. Not a fork we caused.
    expect(
      classifyTransition({
        previousSessionId: null,
        currentSessionId: "aaaa",
        forkedFromSessionId: null,
        newBackgroundSessionIds: ["bbbb"],
      }),
    ).toEqual(NONE);
  });

  it("says nothing when the session is unchanged and nothing else appeared", () => {
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "aaaa",
        forkedFromSessionId: null,
        newBackgroundSessionIds: [],
      }),
    ).toEqual(NONE);
  });

  it("detects a branch when the new session was forked from the old one", () => {
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "bbbb",
        forkedFromSessionId: "aaaa",
        newBackgroundSessionIds: [],
      }),
    ).toEqual({ kind: "branch", originSessionId: "aaaa", newSessionId: "bbbb" });
  });

  it("does NOT call it a branch when the session changed for another reason", () => {
    // The user quit claude and started a fresh one, or resumed something
    // unrelated. The id changed but there is no lineage, so there is no
    // original worth reopening.
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "bbbb",
        forkedFromSessionId: null,
        newBackgroundSessionIds: [],
      }),
    ).toEqual(NONE);
  });

  it("does NOT call it a branch when forkedFrom points somewhere else", () => {
    // The new session is a branch of something, but not of what this pane was
    // running. Reopening "the original" would open a conversation the user
    // never had in this pane.
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "bbbb",
        forkedFromSessionId: "cccc",
        newBackgroundSessionIds: [],
      }),
    ).toEqual(NONE);
  });

  it("detects a fork when a background session appears and the pane's session is unchanged", () => {
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "aaaa",
        forkedFromSessionId: null,
        newBackgroundSessionIds: ["bbbb"],
      }),
    ).toEqual({ kind: "fork", forkSessionId: "bbbb" });
  });

  it("picks the last of several new background sessions", () => {
    // Callers pass these newest-last. Two appearing between polls is rare but
    // possible; acting on the most recent matches what the user just did.
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "aaaa",
        forkedFromSessionId: null,
        newBackgroundSessionIds: ["bbbb", "cccc"],
      }),
    ).toEqual({ kind: "fork", forkSessionId: "cccc" });
  });

  it("prefers the branch when a branch and a fork are both visible", () => {
    // A branch moves the pane's own conversation and is the more disruptive
    // of the two, so it wins. The fork is still a live background session and
    // remains reachable from claude agents.
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "bbbb",
        forkedFromSessionId: "aaaa",
        newBackgroundSessionIds: ["cccc"],
      }),
    ).toEqual({ kind: "branch", originSessionId: "aaaa", newSessionId: "bbbb" });
  });

  it("never reports a branch whose origin is the session we are already in", () => {
    // Defensive: a self-referential forkedFrom would make Kimbo open a second
    // pane on the conversation already in front of the user.
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "aaaa",
        forkedFromSessionId: "aaaa",
        newBackgroundSessionIds: [],
      }),
    ).toEqual(NONE);
  });
});
