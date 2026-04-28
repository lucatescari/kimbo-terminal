import type { ClaudeStatus } from "./claude-status";
import type { AccountInfo } from "./claude-account";
import { estimateCost } from "./claude-pricing";

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
  prefs: ClaudeHudPrefs,
): HTMLElement | null {
  if (!prefs.hudEnabled) return null;
  if (!status) return null;

  const root = document.createElement("div");
  root.className = "claude-hud";

  const sep = () => {
    const s = document.createElement("span");
    s.className = "claude-hud__sep";
    s.textContent = " \u00b7 ";
    return s;
  };

  // Email (with optional plan)
  const emailSpan = document.createElement("span");
  emailSpan.className = "claude-hud__email";
  if (account && account.logged_in && account.email) {
    emailSpan.textContent = account.email + (prefs.showPlan && account.subscription_type ? ` (${account.subscription_type})` : "");
    emailSpan.classList.add("claude-hud__copyable");
    attachCopy(emailSpan, account.email);
  } else {
    emailSpan.textContent = "not logged in";
  }
  root.appendChild(emailSpan);

  // Session id (abbreviated, click-to-copy resume command)
  root.appendChild(sep());
  const sessionSpan = document.createElement("span");
  sessionSpan.className = "claude-hud__session claude-hud__copyable";
  sessionSpan.textContent = status.session_id.slice(0, 8);
  attachCopy(sessionSpan, `claude --resume ${status.session_id}`);
  root.appendChild(sessionSpan);

  // Model (abbreviated: drop the "claude-" prefix if present)
  if (status.model) {
    root.appendChild(sep());
    const modelSpan = document.createElement("span");
    modelSpan.className = "claude-hud__model";
    modelSpan.textContent = status.model.replace(/^claude-/, "");
    root.appendChild(modelSpan);
  }

  // Tokens
  root.appendChild(sep());
  const tokSpan = document.createElement("span");
  tokSpan.className = "claude-hud__tokens";
  tokSpan.textContent = `\u2191${formatTokens(status.input_tokens)} \u2193${formatTokens(status.output_tokens)}`;
  root.appendChild(tokSpan);

  // Cost (skip if model unknown)
  const cost = estimateCost(status.model, status.input_tokens, status.output_tokens);
  if (cost !== null) {
    root.appendChild(sep());
    const costSpan = document.createElement("span");
    costSpan.className = "claude-hud__cost";
    costSpan.textContent = formatCost(cost);
    root.appendChild(costSpan);
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

  return root;
}

function attachCopy(span: HTMLElement, value: string): void {
  span.addEventListener("click", () => {
    void navigator.clipboard.writeText(value);
    const original = span.textContent;
    span.textContent = "copied";
    span.classList.add("claude-hud__copied");
    setTimeout(() => {
      span.textContent = original;
      span.classList.remove("claude-hud__copied");
    }, 1500);
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
