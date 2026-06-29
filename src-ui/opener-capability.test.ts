import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Regression guard for the "Cmd+click opens a file" feature.
//
// The Tauri opener `open_path` command enforces a PATH SCOPE at the Rust layer
// (tauri-plugin-opener scope.rs: `fs_scope.is_allowed(path) && allowed.any(...)`).
// Granting the permission as a bare string — "opener:allow-open-path" — enables
// the command with an EMPTY scope, so every open_path call is silently
// forbidden and Cmd+click does nothing. (reveal_item_in_dir takes no scope,
// which is why Cmd+Shift+click kept working even while this was broken.)
//
// The frontend unit tests mock @tauri-apps/plugin-opener, so they verify the JS
// dispatch (open vs reveal) but CANNOT observe this Rust-side scope denial. This
// static test reads the capability file directly and asserts the permission is
// the object form carrying a non-empty path scope that covers absolute paths.
const cap = JSON.parse(
  readFileSync(
    resolve(__dirname, "../src-tauri/capabilities/default.json"),
    "utf-8",
  ),
) as { permissions: unknown[] };

describe("opener open_path capability", () => {
  it("grants open-path with a non-empty path scope (not a bare string)", () => {
    const entry = cap.permissions.find(
      (p): p is { identifier: string; allow?: Array<{ path?: string }> } =>
        typeof p === "object" &&
        p !== null &&
        (p as { identifier?: string }).identifier === "opener:allow-open-path",
    );

    // A bare "opener:allow-open-path" string is a plain string, so `.find`
    // above won't match it — only the scoped object form is accepted.
    expect(
      entry,
      "open-path must be granted in object form with a path scope",
    ).toBeTruthy();
    expect(entry!.allow?.length ?? 0).toBeGreaterThan(0);
    // resolve_existing_path canonicalizes every clicked path to an absolute
    // path before openPath sees it, so the scope must cover absolute paths.
    expect(
      entry!.allow!.some(
        (s) => typeof s.path === "string" && s.path.includes("**"),
      ),
    ).toBe(true);
  });
});
