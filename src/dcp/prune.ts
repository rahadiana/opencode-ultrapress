/**
 * Message Pruning — removes compressed messages from the message array
 * and replaces them with a synthetic summary message.
 */

import type { CompressionBlock } from "./compress-state.js"
import * as CompressState from "./compress-state.js"
import { isProtectedTool } from "./protected-content.js"

export interface MessageLike {
  id: string
  role: string
  parts?: any[]
  content?: string
}

/**
 * Prune compressed messages from the messages array.
 * Replaces compressed ranges with synthetic summary messages.
 * 
 * @param preserveLastN - Keep last N messages safe from pruning (0 = disable)
 * @returns number of tokens removed (estimated from summary token count)
 */
export function applyPruning(
  messages: MessageLike[],
  preserveLastN: number = 0,
): { prunedCount: number; injectedCount: number } {
  const blocks = CompressState.getAllBlocks()
  if (blocks.length === 0) return { prunedCount: 0, injectedCount: 0 }

  // Calculate cutoff index: messages at or after this index are preserved
  const cutoffIdx = preserveLastN > 0 ? Math.max(0, messages.length - preserveLastN) : 0

  let prunedCount = 0
  let injectedCount = 0

  // Process blocks from oldest to newest
  for (const block of blocks) {
    const { removed, injected } = pruneBlock(messages, block, cutoffIdx)
    prunedCount += removed
    injectedCount += injected
  }

  return { prunedCount, injectedCount }
}

function pruneBlock(
  messages: MessageLike[],
  block: CompressionBlock,
  cutoffIdx: number = 0,
): { removed: number; injected: number } {
  // Find message indices for the block's range
  const startIdx = messages.findIndex(m => m.id === block.startId)
  const endIdx = messages.findIndex(m => m.id === block.endId)

  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    return { removed: 0, injected: 0 } // range not found in current messages
  }

  // If the block's range overlaps with the preserved zone, skip entirely
  // This protects recent messages from being removed
  if (cutoffIdx > 0 && endIdx > cutoffIdx) {
    return { removed: 0, injected: 0 }
  }

  // Count messages in range (exclusive of boundaries — keep start/end for context)
  const rangeMessages = messages.slice(startIdx + 1, endIdx)
  const toRemove = rangeMessages.filter(m => !isProtectedMessage(m))

  if (toRemove.length === 0) return { removed: 0, injected: 0 }

  // Mark for removal by id
  const removeIds = new Set(toRemove.map(m => m.id))
  const result = messages.filter(m => !removeIds.has(m.id))

  // Inject summary message after startIdx
  const effectiveSummary = CompressState.getEffectiveSummary(block.blockId)
  const summaryMsg: MessageLike = {
    id: `__dcp_summary_${block.blockId}__`,
    role: "system",
    content: `[Compressed summary: ${block.topic}] ${effectiveSummary}`,
  }

  // Find where to insert (after the start message, in the filtered array)
  const insertAfter = result.findIndex(m => m.id === block.startId)
  if (insertAfter >= 0) {
    result.splice(insertAfter + 1, 0, summaryMsg)
    injectedCount = 1
  }

  // Update the original array
  messages.length = 0
  messages.push(...result)

  return { removed: toRemove.length, injected: 1 }
}

/**
 * Check if a message should be protected from pruning.
 * Protected messages include those with protected tool outputs.
 */
function isProtectedMessage(msg: MessageLike): boolean {
  if (!msg.parts) return false
  for (const part of msg.parts) {
    if (part.type === "tool") {
      if (isProtectedTool(part.tool)) return true
    }
  }
  return false
}
