/**
 * Context Monitoring — Real Token Tracking
 *
 * Tracks real context token counts from the OpenCode API.
 * Used by /up stats display.
 */

// ─── Real token tracking (from API) ──────────────────────────────────────
let realInputTokens = 0
let realOutputTokens = 0

export function setRealContextTokens(inputTokens: number, outputTokens: number) {
  if (inputTokens > 0) realInputTokens = inputTokens
  if (outputTokens > 0) realOutputTokens = outputTokens
}

export function getContextTokens() {
  return {
    realInput: realInputTokens,
    realOutput: realOutputTokens,
    hasRealData: realInputTokens > 0 || realOutputTokens > 0,
  }
}
