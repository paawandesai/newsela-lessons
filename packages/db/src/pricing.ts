// USD per million tokens. A model missing here (e.g. a server-side fallback) is
// priced at the highest rate listed, so spend caps err on the safe side.
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
};
export const MAX_PRICE = { input: 5, output: 25 };

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function costUsd(model: string, u: Usage) {
  const p = PRICES[model] ?? MAX_PRICE;
  const input = u.input_tokens + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0);
  return (input * p.input + u.output_tokens * p.output) / 1_000_000;
}

/** The most `requests` calls of this size can cost, at the highest listed price. */
export function worstCaseUsd(inputTokens: number, maxOutputTokens: number, requests = 1) {
  return (requests * (inputTokens * MAX_PRICE.input + maxOutputTokens * MAX_PRICE.output)) / 1_000_000;
}
