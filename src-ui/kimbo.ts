import { kimboBus, KimboEvent } from "./kimbo-bus";
import { createKimboState, KimboState, Mood } from "./kimbo-state";
import { createKimboDom, Corner, KimboDom, OverlayKind } from "./kimbo-dom";
import { createMilestoneTracker, MilestoneTracker } from "./kimbo-milestones";

export interface KimboInitOpts {
  enabled: boolean;
  corner: Corner;
  shellIntegration?: boolean;
  /** ms idle before sleepy. Default 120_000. */
  idleMs?: number;
}

// Which overlay (if any) to show for each mood.
const OVERLAY_FOR: Partial<Record<Mood, OverlayKind>> = {
  happy: "sparkleA",
  love: "heart",
  sad: "drop",
  sleepy: "zzz",
  excited: "sparkleA",
  curious: "question",
  wave: "wave",
};

// Optional speech bubble text per mood (randomised).
const BUBBLES: Partial<Record<Mood, string[]>> = {
  happy:   ["nice!", "yay!", "\ud83d\udc4d"],
  sad:     ["oops", "oof\u2026", "aw"],
  wave:    ["hi!", "hello!"],
  love:    ["<3", "you're the best!"],
  excited: ["fresh tab!", "more room!"],
  curious: ["ooh", "what's this?"],
};

let root: HTMLElement | null = null;
let opts: KimboInitOpts | null = null;
let state: KimboState | null = null;
let dom: KimboDom | null = null;
let milestones: MilestoneTracker | null = null;
let unsubBus: (() => void) | null = null;
// Set when a milestone supplies its own bubble — the mood subscriber skips
// its random bubble/overlay roll so they don't collide with the milestone one.
let suppressNextBubble = false;
// sessionHidden: set by the right-click menu ("Hide for this session").
// viewHidden: set automatically when a non-terminal view is showing
// (settings, and any future views). Kimbo is rendered only when BOTH are false.
let sessionHidden = false;
let viewHidden = false;
let onSettingsOpen: (() => void) | null = null;

function applyVisibility(): void {
  dom?.setHidden(sessionHidden || viewHidden);
}

export function initKimbo(rootEl: HTMLElement, o: KimboInitOpts): void {
  if (dom) unmount();
  root = rootEl;
  opts = o;
  if (!o.enabled) return;
  mount();
  // Emit app-start once after mount.
  setTimeout(() => kimboBus.emit({ type: "app-start" }), 0);
}

export function hideKimbo(): void {
  sessionHidden = true;
  applyVisibility();
}

export function showKimbo(): void {
  sessionHidden = false;
  applyVisibility();
}

/**
 * Toggle Kimbo visibility based on which app view is active. Kimbo is only
 * meant to be visible in the terminal/console view — callers that switch to
 * a non-terminal view (settings, future pages) should pass `false` on show
 * and `true` on hide.
 */
export function setKimboInConsoleView(inConsole: boolean): void {
  viewHidden = !inConsole;
  applyVisibility();
}

export function setKimboEnabled(enabled: boolean): void {
  if (!opts) return;
  opts.enabled = enabled;
  if (enabled && !dom) mount();
  if (!enabled && dom) unmount();
}

/** Install a callback to open the settings panel (invoked by right-click menu). */
export function setKimboSettingsHandler(fn: () => void): void {
  onSettingsOpen = fn;
}

export function isKimboShellIntegrationEnabled(): boolean {
  return !!opts?.shellIntegration;
}

export function setKimboShellIntegration(v: boolean): void {
  if (opts) opts.shellIntegration = v;
}

export function setKimboCorner(corner: Corner): void {
  if (opts) opts.corner = corner;
  dom?.setCorner(corner);
}

/** For tests: clean up everything. */
export function disposeKimbo(): void {
  unmount();
  opts = null;
  root = null;
  sessionHidden = false;
  viewHidden = false;
  onSettingsOpen = null;
  suppressNextBubble = false;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function mount(): void {
  if (!root || !opts || dom) return;
  state = createKimboState({ idleMs: opts.idleMs });
  milestones = createMilestoneTracker();
  dom = createKimboDom(root);
  dom.mount();
  dom.setCorner(opts.corner);
  if (sessionHidden || viewHidden) dom.setHidden(true);

  state.subscribe((mood) => {
    dom?.setMood(mood);
    if (suppressNextBubble) return; // milestone handles bubble; skip overlay+random
    // Show overlay XOR bubble: both live above Kimbo's head and would collide.
    const bubbles = BUBBLES[mood];
    const showBubble = !!bubbles && Math.random() < 0.6;
    if (showBubble) {
      dom?.showBubble(pick(bubbles!));
    } else {
      const ov = OVERLAY_FOR[mood];
      if (ov) dom?.showOverlay(ov);
    }
  });

  dom.onClick(() => kimboBus.emit({ type: "kimbo-click" }));
  dom.onContextMenu((x, y) => showContextMenu(x, y));
  dom.onDragEnd((corner) => { if (opts) opts.corner = corner; persistCorner(corner); });

  unsubBus = kimboBus.subscribe(onEvent);
}

function unmount(): void {
  unsubBus?.(); unsubBus = null;
  dom?.unmount(); dom = null;
  state?.dispose(); state = null;
  milestones = null;
}

function defaultMoodFor(e: KimboEvent): Mood | null {
  switch (e.type) {
    case "app-start":       return "wave";
    case "tab-created":
    case "pane-split":
    case "project-opened":  return "excited";
    case "launcher-open":
    case "settings-open":   return "curious";
    case "command-start":   return "focused";
    case "command-end":     return e.exit === 0 ? "happy" : "sad";
    case "kimbo-click":     return "love";
    case "user-typed":      return null;
  }
}

function onEvent(e: KimboEvent): void {
  if (!state) return;

  const currentMood = state.current();
  const ms = milestones?.onEvent(e, currentMood) ?? null;

  // Side effects that must happen regardless of milestone outcome.
  if (e.type === "command-end") state.release("focused");
  if (e.type === "user-typed")  state.noteActivity();

  const mood = ms?.mood ?? defaultMoodFor(e);

  suppressNextBubble = !!ms?.bubble;
  if (mood) state.trigger(mood);
  suppressNextBubble = false;

  if (ms?.bubble) dom?.showBubble(ms.bubble);
}

function showContextMenu(x: number, y: number): void {
  document.querySelectorAll(".kimbo-menu").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className = "kimbo-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const close = () => {
    menu.remove();
    window.removeEventListener("mousedown", dismiss);
  };

  const dismiss = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) close();
  };

  const item = (label: string, onClick: () => void) => {
    const el = document.createElement("div");
    el.className = "kimbo-menu-item";
    el.textContent = label;
    el.addEventListener("click", () => { onClick(); close(); });
    return el;
  };

  menu.appendChild(item("Hide for this session", () => hideKimbo()));
  menu.appendChild(item("Kimbo settings\u2026", () => { onSettingsOpen?.(); }));

  setTimeout(() => window.addEventListener("mousedown", dismiss), 0);

  document.body.appendChild(menu);
}

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

async function persistCorner(corner: Corner): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const cfg = await invoke<any>("get_config");
    cfg.kimbo.corner = corner;
    await invoke("save_config", { config: cfg });
  } catch (e) {
    console.warn("Failed to persist kimbo corner:", e);
  }
}
