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
import { createBlock, isMessageCompressed, getProtectedContextString } from "../dcp/compress-state.js"
import { estimateTokens } from "../utils/token-count.js"
import * as logger from "../utils/logger.js"

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

// ─── Auto-Compress (replaces nudge) ──────────────────────────────────────

/**
 * Auto-compress old messages when context is approaching limit.
 * Creates compression blocks for messages outside the preserveLastN window
 * that haven't been compressed yet. Returns count of messages compressed.
 *
 * Called from chat.message hook BEFORE the nudge check. If this returns > 0,
 * the nudge prompt is suppressed (auto-compress happened instead).
 */
export function autoCompressMessages(
  messages: Array<{ info?: { id: string; role: string }; id?: string; role?: string; parts?: any[] }>,
  config: SummarizationConfig,
): number {
  if (!config.enabled || !messages || messages.length === 0) return 0

  const preserveLastN = config.preserveLastN || 0
  const strictCutoff = preserveLastN > 0 ? Math.max(0, messages.length - preserveLastN) : 0

  if (strictCutoff <= 0) return 0 // All messages are within the preserve window

  // Collect eligible message IDs (not already compressed).
  // Compress messages strictly before the preserve window (strictCutoff)
  // AND messages in an "extended" zone closer to the preserve boundary
  // (between strictCutoff and extendedCutoff) which are low-value candidates.
  const extendedCutoff = messages.length - Math.max(1, Math.floor(preserveLastN / 2))

  const eligibleIds: string[] = []
  const extendedIds: string[] = []

  for (let i = 0; i < strictCutoff; i++) {
    const msg = messages[i]
    const msgId = msg.info?.id || msg.id
    if (!msgId) continue
    if (isMessageCompressed(msgId)) continue
    eligibleIds.push(msgId)
  }

  // Also compress messages in the extended zone (between strictCutoff and extendedCutoff)
  // Only compress them if scoring threshold is active (will be scored/pruned based on importance)
  if (config.scoreThreshold > 0) {
    for (let i = strictCutoff; i < extendedCutoff && i < messages.length; i++) {
      const msg = messages[i]
      const msgId = msg.info?.id || msg.id
      if (!msgId) continue
      if (isMessageCompressed(msgId)) continue
      extendedIds.push(msgId)
    }
  }

  // Merge strict + extended (strict first, extended second)
  const allEligible = [...eligibleIds, ...extendedIds]

  if (allEligible.length === 0) return 0

  // Create a single compression block for all eligible messages
  const firstId = allEligible[0]
  const lastId = allEligible[allEligible.length - 1]
  const topic = "auto-compressed"
  const summary = `[Auto-compressed: ${allEligible.length} older messages — use ultrapress_expand to restore]`
  const summaryTokens = estimateTokens(summary)

  createBlock(topic, firstId, lastId, summary, summaryTokens, allEligible, [], [])

  logger.info(`[L3] Auto-compressed ${allEligible.length} old messages into block${extendedIds.length > 0 ? ` (${eligibleIds.length} strict + ${extendedIds.length} extended)` : ''} (${firstId}..${lastId})`)

  return allEligible.length
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
