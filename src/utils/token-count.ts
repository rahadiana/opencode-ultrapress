/**
 * Approximate token counter using character/word heuristics.
 * Not perfect but good enough for compression ratio tracking.
 * Avoids heavy dependencies like tiktoken.
 */

/** Average chars per token for English text (GPT-family models) */
const CHARS_PER_TOKEN = 3.7

/** Average chars per token for code */
const CHARS_PER_TOKEN_CODE = 3.2

/**
 * Estimate token count from text using character-based heuristic.
 * ~85-90% accurate vs tiktoken for English/code mix.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0

  // Detect if text is mostly code (has high symbol density)
  const codeIndicators = text.match(/[{}();=<>[\]|&!+\-*/]/g)?.length ?? 0
  const codeRatio = codeIndicators / text.length

  const charsPerToken = codeRatio > 0.05 ? CHARS_PER_TOKEN_CODE : CHARS_PER_TOKEN
  return Math.ceil(text.length / charsPerToken)
}

/**
 * Format token count for display.
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return `${count}`
}

/**
 * Calculate savings percentage.
 */
export function savingsPercent(original: number, compressed: number): number {
  if (original === 0) return 0
  return Math.round(((original - compressed) / original) * 100)
}

/**
 * Format a savings summary.
 */
export function formatSavings(original: number, compressed: number): string {
  const saved = original - compressed
  const pct = savingsPercent(original, compressed)
  return `${formatTokens(original)} → ${formatTokens(compressed)} (−${pct}%, saved ${formatTokens(saved)})`
}
