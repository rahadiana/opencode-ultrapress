/**
 * Token counting utilities for UltraPress.
 *
 * Two-tier approach:
 * 1. countTokens() — accurate model-specific counting via @huggingface/transformers AutoTokenizer
 * 2. estimateTokens() — fast heuristic fallback (~85% accurate, no model needed)
 */

// ─── Accurate Tokenizer (lazy-loaded) ───────────────────────────────────

let tokenizerPromise: Promise<any> | null = null

async function getTokenizer(): Promise<any> {
  if (!tokenizerPromise) {
    tokenizerPromise = (async () => {
      try {
        const { AutoTokenizer } = await import("@huggingface/transformers")
        // Use a small, fast tokenizer — GPT-family compatible
        return await AutoTokenizer.from_pretrained("Xenova/gpt2")
      } catch {
        return null
      }
    })()
  }
  return tokenizerPromise
}

/**
 * Accurate token count using HuggingFace AutoTokenizer.
 * Falls back to estimateTokens() if tokenizer can't load.
 * Only use in async contexts.
 */
export async function countTokens(text: string): Promise<number> {
  if (!text) return 0
  try {
    const tok = await getTokenizer()
    if (tok) {
      const encoded = tok.encode(text)
      return Array.isArray(encoded) ? encoded.length : 0
    }
  } catch {
    // Fall through to estimate
  }
  return estimateTokens(text)
}

// ─── Fast Heuristic (sync, no deps) ─────────────────────────────────────

/** Average chars per token for English text (GPT-family models) */
const CHARS_PER_TOKEN = 3.7

/** Average chars per token for code */
const CHARS_PER_TOKEN_CODE = 3.2

/**
 * Estimate token count from text using character-based heuristic.
 * ~85-90% accurate vs tiktoken for English/code mix.
 * Use countTokens() for model-accurate results when async is acceptable.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0

  // Detect if text is mostly code (has high symbol density)
  const codeIndicators = text.match(/[{}();=<>[\]|&!+\-*/]/g)?.length ?? 0
  const codeRatio = codeIndicators / text.length

  const charsPerToken = codeRatio > 0.05 ? CHARS_PER_TOKEN_CODE : CHARS_PER_TOKEN
  return Math.ceil(text.length / charsPerToken)
}

// ─── Formatting ─────────────────────────────────────────────────────────

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
