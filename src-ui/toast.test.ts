import { describe, it, expect, beforeEach, vi } from "vitest";
import { showToast, clearToastsForTesting } from "./toast";

beforeEach(() => {
  clearToastsForTesting();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function host(): HTMLElement | null {
  return document.querySelector("#toast-host");
}

describe("showToast", () => {
  it("creates a single host element on first call and reuses it", () => {
    showToast({ message: "first" });
    showToast({ message: "second" });
    const hosts = document.querySelectorAll("#toast-host");
    expect(hosts.length).toBe(1);
    expect(host()!.querySelectorAll(".toast").length).toBe(2);
  });

  it("renders the message and detail text", () => {
    showToast({ message: "Copied", detail: "claude --resume abc" });
    const toast = host()!.querySelector(".toast")!;
    expect(toast.querySelector(".toast__message")!.textContent).toBe("Copied");
    expect(toast.querySelector(".toast__detail")!.textContent).toBe("claude --resume abc");
  });

  it("omits the detail row when no detail is provided", () => {
    showToast({ message: "Hello" });
    const toast = host()!.querySelector(".toast")!;
    expect(toast.querySelector(".toast__detail")).toBeNull();
  });

  it("defaults to the info kind", () => {
    showToast({ message: "x" });
    expect(host()!.querySelector(".toast")!.classList.contains("toast--info")).toBe(true);
  });

  it("applies the success / error kind class", () => {
    showToast({ message: "ok", kind: "success" });
    expect(host()!.querySelector(".toast--success")).toBeTruthy();
    showToast({ message: "no", kind: "error" });
    expect(host()!.querySelector(".toast--error")).toBeTruthy();
  });

  it("auto-dismisses after the configured duration", async () => {
    vi.useFakeTimers();
    showToast({ message: "x", durationMs: 50 });
    expect(host()!.querySelectorAll(".toast").length).toBe(1);
    vi.advanceTimersByTime(60);
    // After the dismiss timer fires, the toast gets the leaving class.
    expect(host()!.querySelector(".toast")!.classList.contains("toast--leaving")).toBe(true);
    // The defensive cleanup setTimeout fires within 400ms.
    vi.advanceTimersByTime(400);
    expect(host()!.querySelectorAll(".toast").length).toBe(0);
  });

  it("dismisses early on click", () => {
    showToast({ message: "click me", durationMs: 9999 });
    const toast = host()!.querySelector(".toast") as HTMLElement;
    expect(toast).toBeTruthy();
    toast.click();
    expect(toast.classList.contains("toast--leaving")).toBe(true);
  });
});
