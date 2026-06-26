// Short synthesized terminal beep. No audio asset is shipped; this generates
// a brief oscillator pulse via the WebAudio API. Safe to call repeatedly.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  const Ctor = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

export function playBeep(): void {
  try {
    const c = getCtx();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(c.destination);
    const now = c.currentTime;
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.start(now);
    osc.stop(now + 0.09);
  } catch {
    /* audio unavailable — ignore */
  }
}
