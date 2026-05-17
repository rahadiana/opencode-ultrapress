/**
 * Context Monitoring & Nudging System.
 *
 * Tracks context tokens using:
 * - Real API data from AssistantMessage.tokens when available (set via setRealContextTokens)
 * - Estimated token count as fallback (set via updateContextTokens / resetContextTokens)
 */

import type { SummarizationConfig } from "../config/schema.js"

// Estimated token tracking (fallback when real API data is unavailable)
let currentContextTokens = 0
let turnCount = 0

// Real token tracking (from AssistantMessage.tokens API data)
let realInputTokens = 0
let realOutputTokens = 0
let hasRealData = false

export function updateContextTokens(delta: number) {
  currentContextTokens = Math.max(0, currentContextTokens + delta)
}

export function resetContextTokens(amount: number = 0) {
  currentContextTokens = amount
}

export function resetTurnCount(count: number = 0) {
  turnCount = count
}

/**
 * Set real token counts from OpenCode API (AssistantMessage.tokens).
 * When real data is available, it overrides the estimated count for nudge decisions.
 */
export function setRealContextTokens(input: number, output: number): void {
  realInputTokens = input
  realOutputTokens = output
  hasRealData = true
  // Sync the estimated counter to real input tokens for nudge consistency
  currentContextTokens = input
}

export function getContextTokens(): { estimated: number; realInput: number; realOutput: number; hasRealData: boolean } {
  return {
    estimated: currentContextTokens,
    realInput: realInputTokens,
    realOutput: realOutputTokens,
    hasRealData,
  }
}

export function checkNudgeRequired(config: SummarizationConfig): boolean {
  if (!config.enabled) return false
  
  turnCount++
  
  if (turnCount % config.nudgeFrequency === 0) {
    // Use real input tokens when available, otherwise fall back to estimated
    const effectiveContext = hasRealData ? realInputTokens : currentContextTokens
    if (effectiveContext > config.maxContextLimit) {
      return true
    }
  }
  
  return false
}

export function buildNudgePrompt(config: SummarizationConfig): string {
  const source = hasRealData ? "actual" : "estimated"
  return `[SYSTEM ALERT: CONTEXT WINDOW LARGE]
Current active context size (${source}) is approaching the limit (${config.maxContextLimit} tokens).
To prevent context overflow and preserve important facts, PLEASE CALL the 'ultrapress_compress' tool immediately to summarize stale spans of this conversation.`
}
