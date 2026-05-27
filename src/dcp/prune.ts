/**
 * Message Pruning — removes compressed messages from the message array
 * and replaces them with a synthetic summary message.
 *
 * Supports two strategies:
 * 1. preserveLastN — simple recency cutoff (binary)
 * 2. Multi-signal scoring — per-message importance for partial-block pruning
 */

import type { CompressionBlock } from "./compress-state.js"
import * as CompressState from "./compress-state.js"
import { isProtectedTool } from "./protected-content.js"
import { scoreMessage, type MessageMeta } from "./scorer.js"
import * as logger from "../utils/logger.js"
import { estimateTokens } from "../utils/token-count.js"

export interface MessageLike {
  id: string
  role?: string
  parts?: any[]
  content?: string
  info?: { id?: string; role?: string }
}

const IMPORTANT_CONTEXT_MARKERS = [
  /(?:^|\s)(TODO|FIXME|HACK)\b/i,
  /\bACTION\s+ITEM\b/i,
  /\bROOT\s+CAUSE\b/i,
  /\bRCA\b/i,
  /\bDECISION(?:\s+LOG)?\b/i,
  /\bBLOCKER\b/i,
]

function getMessageText(msg: MessageLike): string {
  const contentChunks: string[] = []

  if (typeof msg.content === "string" && msg.content.length > 0) {
    contentChunks.push(msg.content)
  }

  if (msg.parts) {
    for (const part of msg.parts) {
      if (part.type === "text" && typeof part.text === "string") {
        contentChunks.push(part.text)
      }
    }
  }

  return contentChunks.join("\n")
}

function hasImportantMarker(msg: MessageLike): boolean {
  const text = getMessageText(msg)
  if (!text) return false
  return IMPORTANT_CONTEXT_MARKERS.some((pattern) => pattern.test(text))
}

// ─── MessageLike → MessageMeta conversion ───────────────────────────────

function toMeta(msg: MessageLike, index: number, total: number): MessageMeta {
  let tool: string | undefined
  let content = msg.content || ""
  const msgId = msg.info?.id || msg.id
  const msgRole = msg.info?.role || msg.role || "unknown"
  if (msg.parts) {
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool) tool = part.tool
      if (part.type === "text" && !content) content = part.text || content
    }
  }
  return { id: msgId, role: msgRole, tool, content, index, totalMessages: total }
}

// ─── Main Pruning Entry ─────────────────────────────────────────────────

// ─── Already-pruned block tracking ──────────────────────────────────────
const prunedBlockIds = new Set<number>()

/**
 * Reset pruning state (for testing / session reset).
 */
export function resetPruneState(): void {
  prunedBlockIds.clear()
}

/**
 * Prune compressed messages from the messages array.
 *
 * Uses in-place mutation (messages.length = 0; messages.push(...)) which
 * preserves the array reference OpenCode's pipeline holds — unlike
 * reassigning output.messages which would break the LLM pipeline.
 *
 * @param preserveLastN - Keep last N messages safe from pruning (0 = disable)
 * @param scoreThreshold - If > 0, use multi-signal scoring. Messages scoring
 *   above this threshold are preserved even if inside a compression block.
 *   Default 0 = no scoring (binary preserveLastN only).
 * @returns number of tokens removed (estimated from summary token count)
 */
export function applyPruning(
  messages: MessageLike[],
  preserveLastN: number = 0,
  scoreThreshold: number = 0,
  onBlockPruned?: (blockId: number, removedMessages: MessageLike[]) => void,
): { prunedCount: number; injectedCount: number; estimatedTokensSaved: number } {
  const blocks = CompressState.getAllBlocks()
  if (blocks.length === 0) return { prunedCount: 0, injectedCount: 0, estimatedTokensSaved: 0 }

  // Calculate cutoff index: messages at or after this index are preserved
  const cutoffIdx = preserveLastN > 0 ? Math.max(0, messages.length - preserveLastN) : 0

  // Build score-based keep set if scoring is enabled
  let scoreKeepIds: Set<string> | undefined
  if (scoreThreshold > 0) {
    scoreKeepIds = new Set()
    const metas = messages.map((m, i) => toMeta(m, i, messages.length))
    for (const meta of metas) {
      const s = scoreMessage(meta)
      if (s >= scoreThreshold) {
        scoreKeepIds.add(meta.id)
      }
    }
    const scoredCount = scoreKeepIds.size
    if (scoredCount > 0) {
      logger.debug(`[Prune] Scoring keeps ${scoredCount}/${messages.length} messages (threshold ${scoreThreshold})`)
    }
  }

  let prunedCount = 0
  let injectedCount = 0
  let estimatedTokensSaved = 0

  for (const block of blocks) {
    // Skip blocks that have already been pruned
    if (prunedBlockIds.has(block.blockId)) continue

    const result = pruneBlock(messages, block, cutoffIdx, scoreKeepIds)
    prunedCount += result.removed
    injectedCount += result.injected
    estimatedTokensSaved += result.estimatedSavedTokens
    if (result.removed > 0) {
      prunedBlockIds.add(block.blockId)
      if (onBlockPruned && result.removedMessages) {
        onBlockPruned(block.blockId, result.removedMessages)
      }
    }
  }

  return { prunedCount, injectedCount, estimatedTokensSaved }
}

/**
 * Find the last user message before a given index, to copy info from
 * for the synthetic summary message.
 */
function findLastUserMessage(messages: MessageLike[], beforeIdx: number): MessageLike | undefined {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    const role = messages[i].info?.role || messages[i].role
    if (role === "user") return messages[i]
  }
  return undefined
}

/**
 * Create a proper synthetic user message that OpenCode's pipeline can handle.
 * Critical: uses "user" role with proper info object — matches the format
 * that the opencode-dynamic-context-pruning plugin uses successfully.
 */
function createSummaryMessage(block: CompressionBlock, template?: MessageLike): MessageLike {
  const effectiveSummary = CompressState.getEffectiveSummary(block.blockId)
  const summaryText = `[Compressed summary: ${block.topic}] ${effectiveSummary}`
  const now = Date.now()

  const msgId = `__dcp_summary_${block.blockId}__`
  const partId = `__prt_dcp_summary_${block.blockId}__`

  const info: Record<string, any> = {
    id: msgId,
    role: "user",
    time: { created: now },
  }

  // Copy session info from template if available
  if (template?.info) {
    const tInfo = template.info as Record<string, any>
    if (tInfo.sessionID) info.sessionID = tInfo.sessionID
    if (tInfo.agent) info.agent = tInfo.agent
    if (tInfo.model) info.model = tInfo.model
  }

  return {
    id: msgId,
    content: summaryText,
    info,
    parts: [
      {
        id: partId,
        messageID: msgId,
        type: "text" as const,
        text: summaryText,
      },
    ],
  }
}

function pruneBlock(
  messages: MessageLike[],
  block: CompressionBlock,
  cutoffIdx: number = 0,
  scoreKeepIds?: Set<string>,
): { removed: number; injected: number; removedMessages?: MessageLike[]; estimatedSavedTokens: number } {
  let injectedCount = 0
  let estimatedSavedTokens = 0

  const resolveId = (m: MessageLike) => m.info?.id || m.id
  const startIdx = messages.findIndex(m => resolveId(m) === block.startId)
  const endIdx = messages.findIndex(m => resolveId(m) === block.endId)

  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    return { removed: 0, injected: 0, estimatedSavedTokens: 0 }
  }

  // If scoring is active, build a keep set from block's messages
  const blockKeepIds = new Set(scoreKeepIds || [])

  // If the block overlaps preserved zone but scoring is active,
  // we may still partially prune low-scoring messages before the cutoff
  if (cutoffIdx > 0 && endIdx >= cutoffIdx) {
    if (!scoreKeepIds || scoreKeepIds.size === 0) {
      // No scoring — skip entire block (legacy behavior)
      return { removed: 0, injected: 0, estimatedSavedTokens: 0 }
    }
    // With scoring: we can still prune messages within this block
    // as long as they're below the score threshold
  }

  // Use block's directMessageIds (not index range) to find removable messages.
  // Index-based slicing (slice(startIdx+1, endIdx)) fails for 1-2 message blocks
  // where start and end are adjacent/identical — range is empty, nothing gets pruned.
  // Using message IDs directly works for ANY block size.
  const blockIdSet = new Set(block.directMessageIds)
  blockIdSet.delete(block.startId) // Keep startId as anchor for summary insertion

  const toRemove: MessageLike[] = []
  for (const msg of messages) {
    const mid = msg.info?.id || msg.id
    if (!blockIdSet.has(mid)) continue
    if (isProtectedMessage(msg)) continue
    if (blockKeepIds.has(mid)) continue
    toRemove.push(msg)
  }

  if (toRemove.length === 0) return { removed: 0, injected: 0, estimatedSavedTokens: 0 }

  const removedTokenEstimate = toRemove.reduce((sum, msg) => sum + estimateTokens(getMessageText(msg)), 0)

  const removeIds = new Set(toRemove.map(m => m.info?.id || m.id))
  const result = messages.filter(m => !removeIds.has(m.info?.id || m.id))

  // Create synthetic user message with proper OpenCode format
  const userTemplate = findLastUserMessage(messages, startIdx)
  const summaryMsg = createSummaryMessage(block, userTemplate)
  const summaryText = (summaryMsg.parts?.[0] as any)?.text || ""
  const summaryTokenEstimate = estimateTokens(summaryText)
  estimatedSavedTokens = Math.max(0, removedTokenEstimate - summaryTokenEstimate)

  const insertAfter = result.findIndex(m => (m.info?.id || m.id) === block.startId)
  if (insertAfter >= 0) {
    result.splice(insertAfter + 1, 0, summaryMsg)
    injectedCount = 1
  }

  // In-place mutation — preserves the array reference OpenCode's pipeline holds
  messages.length = 0
  messages.push(...result)

  return { removed: toRemove.length, injected: injectedCount, removedMessages: toRemove, estimatedSavedTokens }
}

/**
 * Check if a message should be protected from pruning.
 */
function isProtectedMessage(msg: MessageLike): boolean {
  if (hasImportantMarker(msg)) return true

  if (!msg.parts) return false
  for (const part of msg.parts) {
    if (part.type === "tool") {
      if (isProtectedTool(part.tool)) return true
    }
  }
  return false
}
