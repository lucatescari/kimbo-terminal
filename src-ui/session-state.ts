// Persistent session state — the minimum needed to restore the user's open
// tabs on next launch when `prefs.startup === "last"`. We persist to
// localStorage (not the rust config) because the shape is UI-level and
// churns with tab lifecycle; Tauri's IPC has no measurable latency but the
// rust config.toml is not designed to be rewritten on every pane event.
//
// What we save: one entry per open tab, with its first-leaf cwd and the
// last-known tab name, plus the index of the active tab. What we don't
// save (yet): pane-split geometry, scrollback, running TUI state. Those
// are either impossible (no process-resume) or a bigger scope than this
// change aims for. On restore we spawn one fresh pane per persisted tab
// at the saved cwd, which is what users actually expect when they say
// "open where I left off".
//
// Safety rails:
//   - JSON.parse is wrapped; corrupt/partial state returns null instead of
//     nuking the launch flow.
//   - cwd is sanity-checked (must look like an absolute POSIX path) before
//     being handed to the shell. An attacker with localStorage-write access
//     can still inject paths, but that access level already owns your
//     session — the check mainly guards against accidental garbage.

const KEY = "kimbo-session-v1";

export interface PersistedTab {
  cwd: string | null;
  name: string;
}

export interface PersistedSession {
  tabs: PersistedTab[];
  activeIndex: number;
  savedAt: number;
}

export function saveSession(state: Omit<PersistedSession, "savedAt">): void {
  if (state.tabs.length === 0) {
    // Don't persist "zero tabs" — that happens briefly between tab close
    // and the next auto-save and would wipe the real state on next boot.
    return;
  }
  try {
    const payload: PersistedSession = { ...state, savedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch (_) {
    /* quota or serialization — not worth surfacing */
  }
}

export function loadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed || !Array.isArray(parsed.tabs)) return null;
    // Defense-in-depth: sanitize every cwd field before returning. Anything
    // that doesn't look like an absolute path is dropped (the tab will open
    // with the default cwd).
    const cleanTabs = parsed.tabs
      .filter((t) => t && typeof t === "object")
      .map((t) => ({
        cwd: isSafeCwd(t.cwd) ? t.cwd : null,
        name: typeof t.name === "string" ? t.name.slice(0, 64) : "~",
      }));
    if (cleanTabs.length === 0) return null;
    const activeIndex =
      typeof parsed.activeIndex === "number" && parsed.activeIndex >= 0
        ? Math.min(parsed.activeIndex, cleanTabs.length - 1)
        : 0;
    return {
      tabs: cleanTabs,
      activeIndex,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
    };
  } catch (_) {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch (_) {
    /* ignore */
  }
}

/** Poll a snapshot provider on an interval and persist when the shape
 *  changes. Cheaper than instrumenting every tab/pane mutation site and
 *  still catches OSC-7 cwd updates that only flip `session.cwd` without
 *  firing a kimboBus event. Returns a disposer for tests. */
export function startSessionAutosave(
  snapshot: () => Omit<PersistedSession, "savedAt">,
  intervalMs = 2000,
): () => void {
  let last = "";
  const tick = () => {
    const snap = snapshot();
    if (snap.tabs.length === 0) return;
    // Serialize and compare; only write when something actually moved. A
    // no-op setItem is cheap but fires storage events and wakes the
    // devtools — not something we want four times a minute per tab.
    const key = JSON.stringify(snap);
    if (key === last) return;
    last = key;
    saveSession(snap);
  };
  const handle = window.setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}

function isSafeCwd(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v.length === 0 || v.length > 4096) return false;
  // POSIX absolute path, no NUL byte, no '..' segment traversal. We allow
  // '~' prefix because some consumers may serialize it pre-expansion.
  if (!v.startsWith("/") && !v.startsWith("~")) return false;
  if (v.includes("\0")) return false;
  return true;
}
