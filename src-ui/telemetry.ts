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
  } catch (e) {
    console.warn("[kimbo.telemetry] init failed:", e);
  }
}
