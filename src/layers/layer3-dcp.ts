/**
 * Layer 3 — Dynamic Context Pruning (DCP)
 *
 * Two responsibilities:
 * 1. Context monitoring + nudge injection
 * 2. experimental.session.compacting — protected context injection
 *
 * Note: Message pruning (applyPruning) is called directly from
 * the chat.message hook in index.ts.
 */

import type { SummarizationConfig, SessionStats } from "../config/schema.js"
import { checkNudgeRequired, buildNudgePrompt, updateContextTokens } from "../dcp/context-monitor.js"
import { getProtectedContextString } from "../dcp/summary-store.js"
import { estimateTokens } from "../utils/token-count.js"

export interface Layer3Deps {
  config: SummarizationConfig
  stats: SessionStats
}

// ─── Existing: Turn-level nudge ──────────────────────────────────────────

export function processTurnForDCP(
  currentMessageContent: string, 
  deps: Layer3Deps
): { nudgePrompt: string | null } {
  updateContextTokens(estimateTokens(currentMessageContent))

  if (checkNudgeRequired(deps.config)) {
    return { nudgePrompt: buildNudgePrompt(deps.config) }
  }

  return { nudgePrompt: null }
}

// ─── Existing: Compacting hook ───────────────────────────────────────────

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
