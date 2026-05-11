/**
 * Layer 3 — Smart Summarization (DCP)
 * Orchestrates nudges and context compaction hooks.
 */

import type { SummarizationConfig, SessionStats } from "../config/schema.js"
import { checkNudgeRequired, buildNudgePrompt, updateContextTokens } from "../dcp/context-monitor.js"
import { getProtectedContextString } from "../dcp/summary-store.js"
import { estimateTokens } from "../utils/token-count.js"

export interface Layer3Deps {
  config: SummarizationConfig
  stats: SessionStats
}

// Check if we need to nudge the LLM based on turn ticks and context size
export function processTurnForDCP(
  currentMessageContent: string, 
  deps: Layer3Deps
): { nudgePrompt: string | null } {
  
  // Update token estimate roughly based on incoming message
  updateContextTokens(estimateTokens(currentMessageContent))

  if (checkNudgeRequired(deps.config)) {
    return { nudgePrompt: buildNudgePrompt(deps.config) }
  }

  return { nudgePrompt: null }
}

// Hook logic for experimental.session.compacting
export function processCompactingHook(sessionId: string, deps: Layer3Deps): string {
  if (!deps.config.enabled) return ""

  const protectedInfo = getProtectedContextString(sessionId)
  
  return `
--- UltraPress DCP Protected Context ---
The following information must be maintained throughout all compressions:
${protectedInfo}
----------------------------------------
`
}
