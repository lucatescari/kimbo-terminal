import { describe, it, expect, beforeEach } from "vitest";
import { kimboBus, resetBusForTests } from "./kimbo-bus";

describe("kimbo-bus", () => {
  beforeEach(() => resetBusForTests());

  it("delivers emitted events to subscribers", () => {
    const seen: unknown[] = [];
    kimboBus.subscribe((e) => seen.push(e));
    kimboBus.emit({ type: "tab-created" });
    kimboBus.emit({ type: "command-end", exit: 0 });
    expect(seen).toEqual([
      { type: "tab-created" },
      { type: "command-end", exit: 0 },
    ]);
  });

  it("supports multiple subscribers", () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    kimboBus.subscribe((e) => a.push(e));
    kimboBus.subscribe((e) => b.push(e));
    kimboBus.emit({ type: "launcher-open" });
    expect(a).toEqual([{ type: "launcher-open" }]);
    expect(b).toEqual([{ type: "launcher-open" }]);
  });

  it("unsubscribe removes listener", () => {
    const seen: unknown[] = [];
    const unsub = kimboBus.subscribe((e) => seen.push(e));
    unsub();
    kimboBus.emit({ type: "settings-open" });
    expect(seen).toEqual([]);
  });

  it("isolates subscriber errors (one throwing does not block others)", () => {
    const seen: unknown[] = [];
    kimboBus.subscribe(() => { throw new Error("boom"); });
    kimboBus.subscribe((e) => seen.push(e));
    expect(() => kimboBus.emit({ type: "user-typed" })).not.toThrow();
    expect(seen).toEqual([{ type: "user-typed" }]);
  });

  it("duplicate subscribe: each unsubscribe removes only one registration", () => {
    const seen: unknown[] = [];
    const listener = (e: unknown) => seen.push(e);
    const unsub1 = kimboBus.subscribe(listener);
    kimboBus.subscribe(listener);
    unsub1();
    kimboBus.emit({ type: "tab-created" });
    expect(seen).toEqual([{ type: "tab-created" }]);
  });
});
