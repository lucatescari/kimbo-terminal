import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderClaudeHud,
  formatTokens,
  formatDuration,
  formatCost,
} from "./claude-hud";
import type { ClaudeStatus } from "./claude-status";
import type { AccountInfo } from "./claude-account";

const STATUS: ClaudeStatus = {
  session_id: "5a7f9805-2543-4dd9-94ce-9563047d2c26",
  model: "claude-opus-4-7",
  started_at_ms: Date.now() - 12 * 60 * 1000, // 12 min ago
  input_tokens: 1_200_000,
  output_tokens: 45_000,
  permission_mode: "default",
  message_count: 24,
  tool_count: 87,
};

const ACCOUNT: AccountInfo = {
  logged_in: true,
  email: "luca@tescari.dev",
  subscription_type: "max",
};

const PREFS_DEFAULT = { hudEnabled: true, extendedFields: false, showPlan: false };

describe("formatTokens", () => {
  it("formats below 1K verbatim", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });
  it("formats thousands as Nk with one decimal under 10K", () => {
    expect(formatTokens(1_500)).toBe("1.5K");
    expect(formatTokens(45_000)).toBe("45K");
  });
  it("formats millions as Nm with one decimal", () => {
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(2_000_000)).toBe("2M");
  });
});

describe("formatDuration", () => {
  it("under a minute renders as 0m", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(59_000)).toBe("0m");
  });
  it("renders minutes only under an hour", () => {
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(12 * 60_000)).toBe("12m");
  });
  it("renders hours and minutes above an hour", () => {
    expect(formatDuration(3_600_000)).toBe("1h 0m");
    expect(formatDuration(3_600_000 + 5 * 60_000)).toBe("1h 5m");
  });
});

describe("formatCost", () => {
  it("formats with two decimals and dollar sign", () => {
    expect(formatCost(2.3)).toBe("~$2.30");
    expect(formatCost(0)).toBe("~$0.00");
    expect(formatCost(123.456)).toBe("~$123.46");
  });
});

describe("renderClaudeHud", () => {
  it("returns null when hudEnabled is false", () => {
    const el = renderClaudeHud(STATUS, ACCOUNT, { ...PREFS_DEFAULT, hudEnabled: false });
    expect(el).toBeNull();
  });

  it("returns null when status is null", () => {
    const el = renderClaudeHud(null, ACCOUNT, PREFS_DEFAULT);
    expect(el).toBeNull();
  });

  it("renders the default field set", () => {
    const el = renderClaudeHud(STATUS, ACCOUNT, PREFS_DEFAULT)!;
    const text = el.textContent ?? "";
    expect(text).toContain("luca@tescari.dev");
    expect(text).toContain("5a7f9805"); // abbreviated session id
    expect(text).toContain("opus-4-7");
    expect(text).toContain("1.2M");
    expect(text).toContain("45K");
    expect(text).toContain("12m");
    expect(text).toContain("$"); // cost present
    // No extended fields by default
    expect(text).not.toContain("default \u00b7 ");
    expect(text).not.toContain("msgs");
    expect(text).not.toContain("tools");
    // No plan parenthesis by default
    expect(text).not.toContain("(max)");
  });

  it("appends extended fields when extendedFields is on", () => {
    const el = renderClaudeHud(STATUS, ACCOUNT, { ...PREFS_DEFAULT, extendedFields: true })!;
    const text = el.textContent ?? "";
    expect(text).toContain("default");
    expect(text).toContain("24 msgs");
    expect(text).toContain("87 tools");
  });

  it("appends plan when showPlan is on", () => {
    const el = renderClaudeHud(STATUS, ACCOUNT, { ...PREFS_DEFAULT, showPlan: true })!;
    expect(el.textContent ?? "").toContain("(max)");
  });

  it("hides cost when model is unknown", () => {
    const el = renderClaudeHud(
      { ...STATUS, model: "claude-totally-fake" },
      ACCOUNT,
      PREFS_DEFAULT,
    )!;
    expect(el.textContent ?? "").not.toContain("$");
  });

  it("renders 'not logged in' when account is null", () => {
    const el = renderClaudeHud(STATUS, null, PREFS_DEFAULT)!;
    expect(el.textContent ?? "").toContain("not logged in");
  });

  it("renders 'not logged in' when account.logged_in is false", () => {
    const el = renderClaudeHud(STATUS, { logged_in: false, email: null, subscription_type: null }, PREFS_DEFAULT)!;
    expect(el.textContent ?? "").toContain("not logged in");
  });

  describe("click-to-copy", () => {
    let writeText: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
    });
    afterEach(() => {
      // jsdom doesn't ship a real clipboard; leave the override in place.
    });

    it("clicking the session span copies the resume command", async () => {
      const el = renderClaudeHud(STATUS, ACCOUNT, PREFS_DEFAULT)!;
      const span = el.querySelector(".claude-hud__session") as HTMLElement;
      expect(span).toBeTruthy();
      span.click();
      // microtask flush
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith(`claude --resume ${STATUS.session_id}`);
    });

    it("clicking the email span copies the email", async () => {
      const el = renderClaudeHud(STATUS, ACCOUNT, PREFS_DEFAULT)!;
      const span = el.querySelector(".claude-hud__email") as HTMLElement;
      expect(span).toBeTruthy();
      span.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith("luca@tescari.dev");
    });

    it("not-logged-in email span has no click handler", async () => {
      const el = renderClaudeHud(STATUS, null, PREFS_DEFAULT)!;
      const span = el.querySelector(".claude-hud__email") as HTMLElement;
      // The span exists but should not be marked copyable.
      expect(span.classList.contains("claude-hud__copyable")).toBe(false);
      span.click();
      await Promise.resolve();
      expect(writeText).not.toHaveBeenCalled();
    });
  });
});
