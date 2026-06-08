import * as Sentry from "@sentry/browser";
import { defaultOptions } from "tauri-plugin-sentry-api";

let started = false;

/** Initialize opt-in error reporting for the webview. No-op unless telemetry is
 *  enabled (Settings → Privacy, persisted in config.toml). Events are routed
 *  through the Tauri Sentry plugin to the Rust client — which only carries a
 *  DSN when telemetry is enabled — so nothing leaves the machine when off.
 *  `sendDefaultPii: false` keeps IPs/usernames out; only error reports are sent. */
export function initTelemetry(enabled: boolean): void {
  if (!enabled || started) return;
  started = true;
  try {
    Sentry.init({ ...defaultOptions, sendDefaultPii: false });
    console.log("[kimbo.telemetry] initialized (opt-in enabled)");
  } catch (e) {
    console.warn("[kimbo.telemetry] init failed:", e);
  }
}

export interface TestEventResult {
  /** Sentry event id — search for this in the dashboard. */
  id: string;
  /** True if the SDK transport flushed the envelope (left the app) within the
   *  timeout. False localizes the failure to the frontend→Rust hop. */
  flushed: boolean;
}

/** Send a test exception so the user can confirm reports reach their Sentry.
 *  Returns null when telemetry isn't active yet (needs enabling + a restart). */
export async function sendTestEvent(): Promise<TestEventResult | null> {
  if (!started) return null;
  const id = Sentry.captureException(new Error("Kimbo telemetry test event"));
  const flushed = await Sentry.flush(3000);
  console.log(`[kimbo.telemetry] test event id=${id} flushed=${flushed}`);
  return { id, flushed };
}
