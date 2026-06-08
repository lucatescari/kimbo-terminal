// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const initMock = vi.fn();
vi.mock("@sentry/browser", () => ({ init: (...args: unknown[]) => initMock(...args) }));
vi.mock("tauri-plugin-sentry-api", () => ({ defaultOptions: { _marker: true } }));

beforeEach(() => {
  vi.resetModules(); // reset telemetry.ts's module-level `started` flag
  initMock.mockClear();
});

async function loadInit() {
  return (await import("./telemetry")).initTelemetry;
}

describe("initTelemetry (opt-in gate)", () => {
  it("does nothing when telemetry is disabled", async () => {
    const initTelemetry = await loadInit();
    initTelemetry(false);
    expect(initMock).not.toHaveBeenCalled();
  });

  it("initializes Sentry once when enabled, with PII disabled", async () => {
    const initTelemetry = await loadInit();
    initTelemetry(true);
    initTelemetry(true); // idempotent — must not double-init
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock.mock.calls[0][0]).toMatchObject({ sendDefaultPii: false, _marker: true });
  });
});
