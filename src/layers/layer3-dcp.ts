/**
 * Layer 3 — DCP Auto-Compress
 *
 * Auto-compress: creates compressed summary blocks via the LLM.
 * Called from the chat.message hook when token limits are exceeded.
 */

import type { SummarizationConfig } from "../config/schema.js"
import { createBlock, isMessageCompressed } from "../dcp/compress-state.js"
import { estimateTokens } from "../utils/token-count.js"
import * as logger from "../utils/logger.js"

// ─── Auto-Compress (replaces nudge) ──────────────────────────────────────

/** Minimum total token count of the eligible batch before auto-compress triggers.
 *  Below ~500 tokens, the prompt overhead of creating a block exceeds the savings.
 *  500 tokens ≈ 1 user prompt worth of text; small-talk (< 50 tokens) never triggers. */
const MIN_AUTO_TOKEN_BATCH = 500

/** Extract text content from a message's parts for token estimation. */
function extractMessageText(msg: { parts?: any[] }): string {
  if (!msg.parts) return ""
  const chunks: string[] = []
  for (const p of msg.parts) {
    if (p.type === "text" && typeof p.text === "string") {
      chunks.push(p.text)
    }
  }
  return chunks.join("\n")
}

/**
 * Auto-compress old messages when context is approaching limit.
 * Creates compression blocks for messages outside the preserveLastN window
 * that haven't been compressed yet. Returns count of messages compressed.
 *
 * Uses token-aware thresholding: skips batches whose total token content is
 * below MIN_AUTO_TOKEN_BATCH, even if many messages exist. This prevents
 * compressing small-talk ("hai", "ok") that costs more to compress than keep.
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
  let eligibleTokenTotal = 0

  for (let i = 0; i < strictCutoff; i++) {
    const msg = messages[i]
    const msgId = msg.info?.id || msg.id
    if (!msgId) continue
    if (isMessageCompressed(msgId)) continue
    eligibleIds.push(msgId)
    eligibleTokenTotal += estimateTokens(extractMessageText(msg))
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
      eligibleTokenTotal += estimateTokens(extractMessageText(msg))
    }
  }

  // Merge strict + extended (strict first, extended second)
  const allEligible = [...eligibleIds, ...extendedIds]

  // Token-aware skip: if total content is below threshold, the prompt-token
  // cost of compression exceeds the savings. Protects against compressing
  // small-talk conversations ("hai", "ok", "sip") where 10 messages = ~30 tokens.
  if (eligibleTokenTotal < MIN_AUTO_TOKEN_BATCH) return 0

  // Create a single compression block for all eligible messages
  const firstId = allEligible[0]
  const lastId = allEligible[allEligible.length - 1]
  const topic = "auto-compressed"
  const summary = `[Auto-compressed: ${allEligible.length} older messages — use ultrapress_expand to restore]`
  const summaryTokens = estimateTokens(summary)

  createBlock(topic, firstId, lastId, summary, summaryTokens, allEligible, [], [])

  logger.info(`[L3] Auto-compressed ${allEligible.length} messages (~${eligibleTokenTotal} tokens) into block${extendedIds.length > 0 ? ` (${eligibleIds.length} strict + ${extendedIds.length} extended)` : ''} (${firstId}..${lastId})`)

  return allEligible.length
}
