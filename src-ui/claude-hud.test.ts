import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderClaudeHud,
  formatTokens,
  formatDuration,
  formatCost,
} from "./claude-hud";
import type { ClaudeStatus } from "./claude-status";
import type { AccountInfo } from "./claude-account";
import type { RateLimits } from "./claude-rate-limits";

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
    const el = renderClaudeHud(STATUS, ACCOUNT, null, { ...PREFS_DEFAULT, hudEnabled: false });
    expect(el).toBeNull();
  });

  it("returns null when status is null", () => {
    const el = renderClaudeHud(null, ACCOUNT, null, PREFS_DEFAULT);
    expect(el).toBeNull();
  });

  it("renders the default field set", () => {
    const el = renderClaudeHud(STATUS, ACCOUNT, null, PREFS_DEFAULT)!;
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
    const el = renderClaudeHud(STATUS, ACCOUNT, null, { ...PREFS_DEFAULT, extendedFields: true })!;
    const text = el.textContent ?? "";
    expect(text).toContain("default");
    expect(text).toContain("24 msgs");
    expect(text).toContain("87 tools");
  });

  it("appends plan when showPlan is on", () => {
    const el = renderClaudeHud(STATUS, ACCOUNT, null, { ...PREFS_DEFAULT, showPlan: true })!;
    expect(el.textContent ?? "").toContain("(max)");
  });

  it("hides cost when model is unknown", () => {
    const el = renderClaudeHud(
      { ...STATUS, model: "claude-totally-fake" },
      ACCOUNT,
      null,
      PREFS_DEFAULT,
    )!;
    expect(el.textContent ?? "").not.toContain("$");
  });

  it("renders 'not logged in' when account is null", () => {
    const el = renderClaudeHud(STATUS, null, null, PREFS_DEFAULT)!;
    expect(el.textContent ?? "").toContain("not logged in");
  });

  it("renders 'not logged in' when account.logged_in is false", () => {
    const el = renderClaudeHud(STATUS, { logged_in: false, email: null, subscription_type: null }, null, PREFS_DEFAULT)!;
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
      const el = renderClaudeHud(STATUS, ACCOUNT, null, PREFS_DEFAULT)!;
      const span = el.querySelector(".claude-hud__session") as HTMLElement;
      expect(span).toBeTruthy();
      span.click();
      // microtask flush
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith(`claude --resume ${STATUS.session_id}`);
    });

    it("clicking the email span copies the email", async () => {
      const el = renderClaudeHud(STATUS, ACCOUNT, null, PREFS_DEFAULT)!;
      const span = el.querySelector(".claude-hud__email") as HTMLElement;
      expect(span).toBeTruthy();
      span.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith("luca@tescari.dev");
    });

    it("not-logged-in email span has no click handler", async () => {
      const el = renderClaudeHud(STATUS, null, null, PREFS_DEFAULT)!;
      const span = el.querySelector(".claude-hud__email") as HTMLElement;
      // The span exists but should not be marked copyable.
      expect(span.classList.contains("claude-hud__copyable")).toBe(false);
      span.click();
      await Promise.resolve();
      expect(writeText).not.toHaveBeenCalled();
    });
  });
});

// resets_at is Unix seconds. Future = past Y2038 buffer.
const FUTURE_SEC = Math.floor(Date.now() / 1000) + 86400; // tomorrow
const PAST_SEC = 946684800; // 2000-01-01

const FRESH_LIMITS: RateLimits = {
  five_hour: { used_percentage: 47, resets_at: FUTURE_SEC },
  seven_day: { used_percentage: 23, resets_at: FUTURE_SEC },
  captured_at_ms: Date.now(),
  version_too_old: false,
};

const STALE_LIMITS: RateLimits = {
  ...FRESH_LIMITS,
  captured_at_ms: Date.now() - 90 * 60 * 1000, // 90 min ago
};

const VERSION_TOO_OLD: RateLimits = {
  five_hour: null,
  seven_day: null,
  captured_at_ms: Date.now(),
  version_too_old: true,
};

const STATUS_RL = {
  session_id: "5a7f9805-1234-5678-9abc-def012345678",
  model: "claude-opus-4-7",
  started_at_ms: Date.now() - 5 * 60_000,
  input_tokens: 1200,
  output_tokens: 3400,
  permission_mode: "default",
  message_count: 5,
  tool_count: 9,
};

const ACCOUNT_RL = { logged_in: true, email: "luca@tescari.dev", subscription_type: "max" };
const PREFS_RL = { hudEnabled: true, extendedFields: false, showPlan: false };

describe("renderClaudeHud with rateLimits", () => {
  it("renders 5h/Wk percentages and hides tokens/cost when fresh", () => {
    const el = renderClaudeHud(STATUS_RL, ACCOUNT_RL, FRESH_LIMITS, PREFS_RL)!;
    expect(el.querySelector(".claude-hud__limits")).toBeTruthy();
    expect(el.querySelector(".claude-hud__limits")!.textContent).toContain("5h");
    expect(el.querySelector(".claude-hud__limits")!.textContent).toContain("47%");
    expect(el.querySelector(".claude-hud__limits")!.textContent).toContain("23%");
    expect(el.querySelector(".claude-hud__tokens")).toBeNull();
    expect(el.querySelector(".claude-hud__cost")).toBeNull();
  });

  it("falls back to tokens/cost when rateLimits is null", () => {
    const el = renderClaudeHud(STATUS_RL, ACCOUNT_RL, null, PREFS_RL)!;
    expect(el.querySelector(".claude-hud__limits")).toBeNull();
    expect(el.querySelector(".claude-hud__tokens")).toBeTruthy();
  });

  it("applies the stale class when captured_at is older than 60min", () => {
    const el = renderClaudeHud(STATUS_RL, ACCOUNT_RL, STALE_LIMITS, PREFS_RL)!;
    const limits = el.querySelector(".claude-hud__limits");
    expect(limits).toBeTruthy();
    expect(limits!.classList.contains("claude-hud__limits--stale")).toBe(true);
    expect(limits!.getAttribute("title")).toMatch(/last seen \d+ min ago/);
  });

  it("applies warn class at 80-94% and danger class at 95+%", () => {
    const warn: RateLimits = { ...FRESH_LIMITS, five_hour: { used_percentage: 80, resets_at: FUTURE_SEC } };
    const elWarn = renderClaudeHud(STATUS_RL, ACCOUNT_RL, warn, PREFS_RL)!;
    expect(elWarn.querySelector(".claude-hud__limits-warn")).toBeTruthy();

    const danger: RateLimits = { ...FRESH_LIMITS, seven_day: { used_percentage: 95, resets_at: FUTURE_SEC } };
    const elDanger = renderClaudeHud(STATUS_RL, ACCOUNT_RL, danger, PREFS_RL)!;
    expect(elDanger.querySelector(".claude-hud__limits-danger")).toBeTruthy();
  });

  it("renders ↻ for windows with resets_at in the past", () => {
    const past: RateLimits = {
      ...FRESH_LIMITS,
      five_hour: { used_percentage: 47, resets_at: PAST_SEC },
    };
    const el = renderClaudeHud(STATUS_RL, ACCOUNT_RL, past, PREFS_RL)!;
    expect(el.querySelector(".claude-hud__limits")!.textContent).toContain("↻");
  });

  it("falls back to tokens/cost AND emits upgrade pill when version_too_old", () => {
    const el = renderClaudeHud(STATUS_RL, ACCOUNT_RL, VERSION_TOO_OLD, PREFS_RL)!;
    expect(el.querySelector(".claude-hud__limits")).toBeNull();
    expect(el.querySelector(".claude-hud__tokens")).toBeTruthy();
    expect(el.querySelector(".claude-hud__upgrade-pill")).toBeTruthy();
  });
});
