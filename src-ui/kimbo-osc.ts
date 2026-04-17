export type Osc133Message =
  | { kind: "command-start" }
  | { kind: "command-end"; exit: number };

export function parseOsc133(payload: string): Osc133Message | null {
  if (!payload) return null;
  const [kind, arg] = payload.split(";", 2);
  if (kind === "C") return { kind: "command-start" };
  if (kind === "D") {
    const n = Number(arg);
    return { kind: "command-end", exit: Number.isFinite(n) ? n : 0 };
  }
  return null;
}
