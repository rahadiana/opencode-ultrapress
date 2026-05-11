/**
 * Context Monitoring & Nudging System.
 */

import type { SummarizationConfig } from "../config/schema.js"

// In a real plugin, we would use OpenCode's context inspection API.
// For MVP, we track an estimated global context count.
let currentContextTokens = 0
let turnCount = 0

export function updateContextTokens(delta: number) {
  currentContextTokens = Math.max(0, currentContextTokens + delta)
}

export function resetContextTokens(amount: number = 0) {
  currentContextTokens = amount
}

export function checkNudgeRequired(config: SummarizationConfig): boolean {
  if (!config.enabled) return false
  
  turnCount++
  
  if (turnCount % config.nudgeFrequency === 0) {
    if (currentContextTokens > config.maxContextLimit) {
      return true
    }
  }
  
  return false
}

export function buildNudgePrompt(config: SummarizationConfig): string {
  return `[SYSTEM ALERT: CONTEXT WINDOW LARGE]
Current active context size is approaching the limit (${config.maxContextLimit} tokens).
To prevent context overflow and preserve important facts, PLEASE CALL the 'ultrapress_compress' tool immediately to summarize stale spans of this conversation.`
}
