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

export interface MessageLike {
  id: string
  role: string
  parts?: any[]
  content?: string
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
  if (msg.parts) {
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool) tool = part.tool
      if (part.type === "text" && !content) content = part.text || content
    }
  }
  return { id: msg.id, role: msg.role, tool, content, index, totalMessages: total }
}

// ─── Main Pruning Entry ─────────────────────────────────────────────────

/**
 * Prune compressed messages from the messages array.
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
): { prunedCount: number; injectedCount: number } {
  const blocks = CompressState.getAllBlocks()
  if (blocks.length === 0) return { prunedCount: 0, injectedCount: 0 }

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

  for (const block of blocks) {
    const result = pruneBlock(messages, block, cutoffIdx, scoreKeepIds)
    prunedCount += result.removed
    injectedCount += result.injected
    if (result.removed > 0 && onBlockPruned && result.removedMessages) {
      onBlockPruned(block.blockId, result.removedMessages)
    }
  }

  return { prunedCount, injectedCount }
}

function pruneBlock(
  messages: MessageLike[],
  block: CompressionBlock,
  cutoffIdx: number = 0,
  scoreKeepIds?: Set<string>,
): { removed: number; injected: number; removedMessages?: MessageLike[] } {
  let injectedCount = 0

  const startIdx = messages.findIndex(m => m.id === block.startId)
  const endIdx = messages.findIndex(m => m.id === block.endId)

  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    return { removed: 0, injected: 0 }
  }

  // If scoring is active, build a keep set from block's messages
  const blockKeepIds = new Set(scoreKeepIds || [])

  // If the block overlaps preserved zone but scoring is active,
  // we may still partially prune low-scoring messages before the cutoff
  if (cutoffIdx > 0 && endIdx >= cutoffIdx) {
    if (!scoreKeepIds || scoreKeepIds.size === 0) {
      // No scoring — skip entire block (legacy behavior)
      return { removed: 0, injected: 0 }
    }
    // With scoring: we can still prune messages within this block
    // as long as they're below the score threshold
  }

  const rangeMessages = messages.slice(startIdx + 1, endIdx)
  const toRemove = rangeMessages.filter(m => {
    if (isProtectedMessage(m)) return false
    if (blockKeepIds.has(m.id)) return false // scorer says keep
    return true
  })

  if (toRemove.length === 0) return { removed: 0, injected: 0 }

  const removeIds = new Set(toRemove.map(m => m.id))
  const result = messages.filter(m => !removeIds.has(m.id))

  const effectiveSummary = CompressState.getEffectiveSummary(block.blockId)
  const summaryMsg: MessageLike = {
    id: `__dcp_summary_${block.blockId}__`,
    role: "system",
    content: `[Compressed summary: ${block.topic}] ${effectiveSummary}`,
  }

  const insertAfter = result.findIndex(m => m.id === block.startId)
  if (insertAfter >= 0) {
    result.splice(insertAfter + 1, 0, summaryMsg)
    injectedCount = 1
  }

  messages.length = 0
  messages.push(...result)

  return { removed: toRemove.length, injected: injectedCount, removedMessages: toRemove }
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
