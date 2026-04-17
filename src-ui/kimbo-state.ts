export type Mood =
  | "idle" | "happy" | "love" | "sad"
  | "sleepy" | "focused" | "excited" | "curious" | "wave";

export interface KimboStateOpts {
  /** Milliseconds of user inactivity before entering sleepy. Default 120_000. */
  idleMs?: number;
}

interface MoodSpec {
  priority: number;
  durationMs: number | null; // null = holds until release() called
}

const SPEC: Record<Mood, MoodSpec> = {
  idle:     { priority: 0, durationMs: null },
  sleepy:   { priority: 1, durationMs: null },
  focused:  { priority: 2, durationMs: null },
  curious:  { priority: 3, durationMs: 1600 },
  happy:    { priority: 4, durationMs: 1200 },
  excited:  { priority: 4, durationMs: 1200 },
  love:     { priority: 5, durationMs: 1800 },
  sad:      { priority: 5, durationMs: 1800 },
  wave:     { priority: 5, durationMs: 1800 },
};

type Subscriber = (mood: Mood) => void;

export interface KimboState {
  current(): Mood;
  trigger(mood: Mood): void;
  release(mood: Mood): void;      // exits `focused`/`sleepy` back to idle
  noteActivity(): void;            // keystroke — resets idle timer, exits sleepy
  subscribe(s: Subscriber): () => void;
  dispose(): void;
}

export function createKimboState(opts: KimboStateOpts = {}): KimboState {
  const idleMs = opts.idleMs ?? 120_000;

  let current: Mood = "idle";
  let reactionTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let happyStreak = 0;
  const subs = new Set<Subscriber>();

  function setMood(next: Mood) {
    if (next === current) return;
    current = next;
    for (const s of [...subs]) {
      try { s(next); } catch (e) { console.error("kimbo-state sub error:", e); }
    }
  }

  function clearReactionTimer() {
    if (reactionTimer !== null) { clearTimeout(reactionTimer); reactionTimer = null; }
  }

  function scheduleIdle() {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      setMood("sleepy");
    }, idleMs);
  }

  scheduleIdle();

  return {
    current: () => current,

    trigger(raw: Mood) {
      // Enforce happy-streak → love promotion BEFORE priority check.
      let mood = raw;
      if (raw === "happy") {
        happyStreak++;
        if (happyStreak >= 20) { mood = "love"; happyStreak = 0; }
      } else if (raw !== "idle") {
        happyStreak = 0;
      }

      const incoming = SPEC[mood].priority;
      const existing = SPEC[current].priority;
      if (incoming < existing) return; // dropped

      clearReactionTimer();
      setMood(mood);

      const dur = SPEC[mood].durationMs;
      if (dur !== null) {
        reactionTimer = setTimeout(() => setMood("idle"), dur);
      }
    },

    release(mood: Mood) {
      if (current === mood) {
        clearReactionTimer();
        setMood("idle");
      }
    },

    noteActivity() {
      if (current === "sleepy") setMood("idle");
      scheduleIdle();
    },

    subscribe(s: Subscriber) {
      subs.add(s);
      return () => subs.delete(s);
    },

    dispose() {
      clearReactionTimer();
      if (idleTimer !== null) clearTimeout(idleTimer);
      subs.clear();
    },
  };
}
