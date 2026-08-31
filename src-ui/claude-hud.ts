import type { ClaudeStatus } from "./claude-status";
import type { AccountInfo } from "./claude-account";
import type { RateLimits } from "./claude-rate-limits";
import { estimateCost } from "./claude-pricing";
import { showToast } from "./toast";

// Rate-limit numbers only change when Claude Code runs a turn (which rewrites
// the statusline cache). When the user is idle or out of tokens, no turn fires
// and the cache freezes — so a snapshot more than a few minutes old may no
// longer reflect real usage. There's no live local source to reconcile against
// (issue #8), so we flag staleness early and visibly rather than imply the
// number is current. Tunable.
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

export interface ClaudeHudPrefs {
  hudEnabled: boolean;
  extendedFields: boolean;
  showPlan: boolean;
}

/** Build the per-pane Claude HUD strip. Returns null when the strip
 *  should be absent (HUD disabled, no live session). */
export function renderClaudeHud(
  status: ClaudeStatus | null,
  account: AccountInfo | null,
  rateLimits: RateLimits | null,
  prefs: ClaudeHudPrefs,
): HTMLElement | null {
  if (!prefs.hudEnabled) return null;
  if (!status) return null;

  const root = document.createElement("div");
  root.className = "claude-hud";

  const sep = () => {
    const s = document.createElement("span");
    s.className = "claude-hud__sep";
    s.textContent = "\u00b7";
    return s;
  };

  // Leading "this is claude" mark — small theme-accent glyph anchoring the
  // strip so it reads as a feature surface rather than another pane-head row.
  const badge = document.createElement("span");
  badge.className = "claude-hud__badge";
  badge.textContent = "\u25C9"; // ◉ — solid circle with inner dot
  badge.title = "Claude Code session";
  root.appendChild(badge);

  // Email (with optional plan)
  const emailSpan = document.createElement("span");
  emailSpan.className = "claude-hud__email";
  if (account && account.logged_in && account.email) {
    emailSpan.textContent = account.email + (prefs.showPlan && account.subscription_type ? ` (${account.subscription_type})` : "");
    emailSpan.classList.add("claude-hud__copyable");
    attachCopy(emailSpan, account.email, "email");
  } else {
    emailSpan.textContent = "not logged in";
  }
  root.appendChild(emailSpan);

  // Session id (abbreviated, click-to-copy resume command)
  root.appendChild(sep());
  const sessionSpan = document.createElement("span");
  sessionSpan.className = "claude-hud__session claude-hud__copyable";
  sessionSpan.textContent = status.session_id.slice(0, 8);
  attachCopy(sessionSpan, `claude --resume ${status.session_id}`, "resume command");
  root.appendChild(sessionSpan);

  // Model (abbreviated: drop the "claude-" prefix if present)
  if (status.model) {
    root.appendChild(sep());
    const modelSpan = document.createElement("span");
    modelSpan.className = "claude-hud__model";
    modelSpan.textContent = status.model.replace(/^claude-/, "");
    root.appendChild(modelSpan);
  }

  // Decide limits-vs-tokens path. Show limits when we have version-supported
  // data for the *current* account. The rate-limit cache is stamped with the
  // account it was captured under (sidecar reads ~/.claude.json); after a
  // login switch the stale cache still holds the previous account's numbers
  // until that account's next turn rewrites it, so we suppress them on a known
  // mismatch and fall back to tokens/cost. A null cached email (older cache)
  // can't be verified — stay lenient and show it.
  const accountMismatch =
    account?.email != null &&
    rateLimits?.account_email != null &&
    account.email !== rateLimits.account_email;
  const showLimits = rateLimits != null && !rateLimits.version_too_old && !accountMismatch;

  if (showLimits && rateLimits) {
    root.appendChild(sep());
    root.appendChild(renderLimits(rateLimits));
  } else {
    // Tokens/cost fallback (preserved unchanged from the original code below).
    root.appendChild(sep());
    const tokSpan = document.createElement("span");
    tokSpan.className = "claude-hud__tokens";
    const upArrow = document.createElement("span");
    upArrow.className = "claude-hud__arrow";
    upArrow.textContent = "\u2191";
    const upNum = document.createTextNode(formatTokens(status.input_tokens));
    const downArrow = document.createElement("span");
    downArrow.className = "claude-hud__arrow";
    downArrow.textContent = "\u2193";
    const downNum = document.createTextNode(formatTokens(status.output_tokens));
    tokSpan.appendChild(upArrow);
    tokSpan.appendChild(upNum);
    tokSpan.appendChild(document.createTextNode(" "));
    tokSpan.appendChild(downArrow);
    tokSpan.appendChild(downNum);
    root.appendChild(tokSpan);

    const cost = estimateCost(status.model, status.input_tokens, status.output_tokens);
    if (cost !== null) {
      root.appendChild(sep());
      const costSpan = document.createElement("span");
      costSpan.className = "claude-hud__cost";
      costSpan.textContent = formatCost(cost);
      root.appendChild(costSpan);
    }
  }

  // Duration
  root.appendChild(sep());
  const durSpan = document.createElement("span");
  durSpan.className = "claude-hud__duration";
  durSpan.textContent = formatDuration(Date.now() - status.started_at_ms);
  root.appendChild(durSpan);

  // Extended fields
  if (prefs.extendedFields) {
    if (status.permission_mode) {
      root.appendChild(sep());
      const pmSpan = document.createElement("span");
      pmSpan.className = "claude-hud__perm";
      pmSpan.textContent = status.permission_mode;
      root.appendChild(pmSpan);
    }
    root.appendChild(sep());
    const msgSpan = document.createElement("span");
    msgSpan.className = "claude-hud__msgs";
    msgSpan.textContent = `${status.message_count} msgs`;
    root.appendChild(msgSpan);
    root.appendChild(sep());
    const toolSpan = document.createElement("span");
    toolSpan.className = "claude-hud__tools";
    toolSpan.textContent = `${status.tool_count} tools`;
    root.appendChild(toolSpan);
  }

  // Upgrade pill (independent of the fallback decision)
  if (rateLimits?.version_too_old) {
    root.appendChild(renderUpgradePill());
  }

  return root;
}

function attachCopy(span: HTMLElement, value: string, label: string): void {
  span.addEventListener("click", () => {
    void navigator.clipboard.writeText(value);
    showToast({
      kind: "success",
      message: `Copied ${label}`,
      detail: value,
    });
  });
}

/** Format token count as "0", "999", "45K", "1.2M". */
export function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1_000;
    return k >= 10 ? `${Math.round(k)}K` : `${trimTrailingZero(k.toFixed(1))}K`;
  }
  const m = n / 1_000_000;
  return `${trimTrailingZero(m.toFixed(1))}M`;
}

function trimTrailingZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** Format duration in milliseconds as "0m", "12m", "1h 5m". */
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

/** Format cost as "~$2.30" with two decimals. */
export function formatCost(dollars: number): string {
  return `~$${dollars.toFixed(2)}`;
}

function renderLimits(rl: RateLimits): HTMLElement {
  const span = document.createElement("span");
  span.className = "claude-hud__limits";
  const ageMs = Date.now() - rl.captured_at_ms;
  const stale = ageMs > STALE_THRESHOLD_MS;
  appendWindow(span, "5h", rl.five_hour);
  span.appendChild(document.createTextNode(" \u00b7 "));
  appendWindow(span, "Wk", rl.seven_day);
  if (stale) {
    span.classList.add("claude-hud__limits--stale");
    const mins = Math.floor(ageMs / 60_000);
    span.title = `last seen ${mins} min ago \u2014 may be out of date`;
    // Visible marker: a hover-only title doesn't tell the user the number
    // isn't live (issue #8). Show the age inline.
    const marker = document.createElement("span");
    marker.className = "claude-hud__limits-stale-age";
    marker.textContent = ` \u00b7 stale ${formatDuration(ageMs)}`;
    span.appendChild(marker);
  }
  return span;
}

function appendWindow(parent: HTMLElement, label: string, w: RateLimits["five_hour"]): void {
  const lbl = document.createElement("span");
  lbl.className = "claude-hud__limits-label";
  lbl.textContent = label + " ";
  parent.appendChild(lbl);
  if (!w) {
    parent.appendChild(document.createTextNode("—%"));
    return;
  }
  // resets_at is Unix seconds. Convert to ms for Date arithmetic.
  const resetMs = w.resets_at * 1000;
  if (resetMs < Date.now()) {
    parent.appendChild(document.createTextNode("↻"));
    return;
  }
  const pct = document.createElement("span");
  pct.textContent = `${w.used_percentage}%`;
  if (w.used_percentage >= 95) pct.classList.add("claude-hud__limits-danger");
  else if (w.used_percentage >= 80) pct.classList.add("claude-hud__limits-warn");
  pct.title = `${label} resets in ${formatDuration(resetMs - Date.now())}`;
  parent.appendChild(pct);
}

function renderUpgradePill(): HTMLElement {
  const pill = document.createElement("span");
  pill.className = "claude-hud__upgrade-pill";
  pill.textContent = "Update Claude Code ≥2.1.80 for limits";
  pill.title = "Rate-limit display requires Claude Code 2.1.80 or newer.";
  return pill;
}
