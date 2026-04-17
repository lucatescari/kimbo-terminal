import type { KimboEvent } from "./kimbo-bus";
import type { Mood } from "./kimbo-state";

export interface MilestoneResult {
  bubble?: string;
  mood?: Mood;
}

export interface MilestoneTracker {
  /** Consult counters for the incoming event. Returns a bubble/mood override if a milestone fires, else null. */
  onEvent(event: KimboEvent, currentMood: Mood): MilestoneResult | null;
  reset(): void;
}

interface Counters {
  surfaces: number;
  successStreak: number;
  failStreak: number;
  clicks: number;
  firstCommandSeen: boolean;
  appStartedAt: number;
  lastUptimeHour: number;
  burstStartedAt: number | null;
  lastTypedAt: number;
  lastBurstFiredAt: number | null;
}

export interface MilestoneOpts {
  now?: () => number;
  /** Gap longer than this ends the current typing burst. Default 3000ms. */
  burstGapMs?: number;
  /** Sustained typing duration required to fire a burst. Default 20000ms. */
  burstDurationMs?: number;
  /** Cooldown between burst firings. Default 300000ms. */
  burstCooldownMs?: number;
}

export function createMilestoneTracker(opts: MilestoneOpts = {}): MilestoneTracker {
  const now = opts.now ?? (() => Date.now());
  const burstGap = opts.burstGapMs ?? 3000;
  const burstDur = opts.burstDurationMs ?? 20_000;
  const burstCooldown = opts.burstCooldownMs ?? 300_000;

  let c: Counters = fresh();

  function fresh(): Counters {
    return {
      surfaces: 0,
      successStreak: 0,
      failStreak: 0,
      clicks: 0,
      firstCommandSeen: false,
      appStartedAt: now(),
      lastUptimeHour: 0,
      burstStartedAt: null,
      lastTypedAt: 0,
      lastBurstFiredAt: null,
    };
  }

  function checkUptime(): MilestoneResult | null {
    const hours = Math.floor((now() - c.appStartedAt) / 3_600_000);
    if (hours > c.lastUptimeHour && hours >= 1) {
      c.lastUptimeHour = hours;
      const lines = ["an hour in!", "still going strong!", "we've been at it a while!"];
      return { bubble: lines[(hours - 1) % lines.length], mood: "happy" };
    }
    return null;
  }

  function greet(): MilestoneResult {
    const h = new Date(now()).getHours();
    let bubble: string;
    if (h >= 5 && h < 12)       bubble = "good morning!";
    else if (h >= 12 && h < 17) bubble = "afternoon!";
    else if (h >= 17 && h < 22) bubble = "evening!";
    else                         bubble = "late night, huh?";
    return { bubble, mood: "wave" };
  }

  return {
    reset() { c = fresh(); },

    onEvent(e: KimboEvent, currentMood: Mood): MilestoneResult | null {
      const uptime = checkUptime();
      if (uptime) return uptime;

      switch (e.type) {
        case "app-start":
          return greet();

        case "tab-created":
        case "pane-split":
        case "project-opened": {
          c.surfaces++;
          if (c.surfaces === 4)  return { bubble: "impressive!", mood: "excited" };
          if (c.surfaces === 8)  return { bubble: "busy bee!", mood: "excited" };
          if (c.surfaces === 16) return { bubble: "okay wow", mood: "excited" };
          return null;
        }

        case "command-end": {
          if (e.exit === 0) {
            c.successStreak++;
            c.failStreak = 0;
            if (!c.firstCommandSeen) {
              c.firstCommandSeen = true;
              return { bubble: "let's go!", mood: "happy" };
            }
            if (c.successStreak === 10) return { bubble: "you're on fire!", mood: "love" };
            if (c.successStreak === 25) return { bubble: "unstoppable!", mood: "love" };
          } else {
            c.successStreak = 0;
            c.failStreak++;
            c.firstCommandSeen = true;
            if (c.failStreak === 3) return { bubble: "you got this!", mood: "sad" };
          }
          return null;
        }

        case "kimbo-click": {
          c.clicks++;
          if (c.clicks === 5)  return { bubble: "hehe", mood: "love" };
          if (c.clicks === 15) return { bubble: "okay okay, I'm flattered!", mood: "love" };
          return null;
        }

        case "user-typed": {
          const t = now();
          if (currentMood === "sleepy") {
            c.lastTypedAt = t;
            c.burstStartedAt = null;
            return { bubble: "welcome back!", mood: "happy" };
          }
          if (c.burstStartedAt === null || (t - c.lastTypedAt) > burstGap) {
            c.burstStartedAt = t;
          }
          c.lastTypedAt = t;
          const span = t - c.burstStartedAt;
          const cooldownPassed = c.lastBurstFiredAt === null || (t - c.lastBurstFiredAt) >= burstCooldown;
          if (span >= burstDur && cooldownPassed) {
            c.lastBurstFiredAt = t;
            c.burstStartedAt = t;
            return { bubble: "in the zone!", mood: "focused" };
          }
          return null;
        }
      }
      return null;
    },
  };
}
