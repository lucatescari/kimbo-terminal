/** Anthropic-published model prices in dollars per million tokens.
 *  Update by hand when Anthropic changes pricing — there's no API to
 *  pull this dynamically. Unknown models cause estimateCost to return
 *  null so the HUD hides the cost field gracefully. */
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Compute estimated cost in USD. Returns null when the model isn't in
 *  the pricing table — the caller hides the field instead of guessing. */
export function estimateCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (!model) return null;
  const rates = PRICING[model];
  if (!rates) return null;
  return (
    (inputTokens / 1_000_000) * rates.input +
    (outputTokens / 1_000_000) * rates.output
  );
}
