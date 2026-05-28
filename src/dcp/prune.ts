/**
 * Message Pruning — DCP-style placeholder replacement.
 *
 * Instead of removing messages from the array (which breaks array length
 * and causes model confusion), we replace each compressed message's
 * content with a compact placeholder and store original content in
 * persistent JSON storage for Reversible expansion.
 *
 * Key insight from opencode-dynamic-context-pruning:
 * - Keep the messages array exactly the same length
 * - Replace tool outputs with `[Old tool result content cleared]`
 * - Replace text content with brief placeholders
 * - Original content lives in JSON storage, not LLM context
 *
 * Matching strategy:
 * Instead of relying on message IDs (which differ between session.messages()
 * and output.messages in the transform hook), we use position-based matching.
 * Messages before the last `preserveLastN` are compressed positionally.
 * This is deterministic and ID-independent.
 */

import type { CompressionBlock } from "./compress-state.js"
import * as CompressState from "./compress-state.js"
import type { CompressedMessageEntry, SessionStorage } from "./storage.js"

/**
 * Placeholder text used when replacing compressed tool output parts.
 * Must be very compact to maximize token savings.
 */
const TOOL_OUTPUT_PLACEHOLDER = "[Old tool result content cleared]"

/**
 * How many chars of the summary to include in the text placeholder.
 */
const SUMMARY_PREVIEW_MAX_CHARS = 120

/**
 * Truncate a string for placeholder use.
 */
function truncateSummary(text: string, max = SUMMARY_PREVIEW_MAX_CHARS): string {
  if (text.length <= max) return text
  return text.slice(0, max - 3) + "..."
}

/**
 * Replace the content of a compressed message with a placeholder.
 * Returns a CompressedMessageEntry containing both the placeholder
 * and the original content for storage.
 */
function replaceWithPlaceholder(
  msg: any,
  block: CompressionBlock,
): CompressedMessageEntry {
  // Extract original content before replacement
  const originalContent = typeof msg.content === "string" ? msg.content : undefined
  const originalParts = msg.parts ? JSON.parse(JSON.stringify(msg.parts)) : undefined

  // Build placeholder based on role
  const role = msg.info?.role || msg.role || "unknown"
  const summaryPreview = truncateSummary(block.summary)

  let placeholder: string

  if (role === "assistant") {
    placeholder = `[Compressed: ${block.topic} — ${summaryPreview}]`
  } else if (role === "user") {
    placeholder = `[Compressed user message: ${block.topic} — ${summaryPreview}]`
  } else {
    placeholder = `[Compressed: ${block.topic}]`
  }

  // Replace the message content
  if (typeof msg.content === "string") {
    msg.content = placeholder
  }

  // Replace parts — keep structure but shrink tool outputs
  if (msg.parts && Array.isArray(msg.parts)) {
    for (const part of msg.parts) {
      if (part.type === "tool" && part.state?.status === "completed") {
        part.state.output = TOOL_OUTPUT_PLACEHOLDER
      }
      if (part.type === "text" && typeof part.text === "string") {
        part.text = placeholder
      }
    }
  }

  return {
    placeholder,
    originalContent,
    originalParts,
  }
}

/**
 * Generate a deterministic internal ID for a message based on its
 * position from the end of the array. Used for storage indexing.
 */
function makeMsgId(index: number, total: number): string {
  return `up_pos_${total - 1 - index}`
}

/**
 * Apply DCP-style compression to messages:
 * Replace compressed message content with placeholders instead of removing them.
 *
 * Uses position-based matching (from end of array) rather than message IDs.
 * Messages beyond preserveLastN from the end are eligible for compression.
 *
 * @param messages - The messages array (mutated in-place)
 * @param preserveLastN - Number of recent messages to preserve
 * @param storage - Session storage for saving original content
 * @returns Number of compressed message entries saved
 */
export function applyPlaceholderCompression(
  messages: any[],
  preserveLastN: number = 0,
  storage?: SessionStorage,
): { compressedCount: number; estimatedTokensSaved: number } {
  if (messages.length === 0) return { compressedCount: 0, estimatedTokensSaved: 0 }

  const total = messages.length
  const cutoff = preserveLastN >= 0 ? Math.max(0, total - preserveLastN) : 0

  // Messages beyond the preserve window from the end are compressible
  const compressibleEnd = cutoff

  if (compressibleEnd <= 0) return { compressedCount: 0, estimatedTokensSaved: 0 }

  // Get existing blocks (from auto-compress in chat.message hook)
  const blocks = CompressState.getAllBlocks()
  const hasBlocks = blocks.length > 0

  let compressedCount = 0
  let estimatedTokensSaved = 0

  for (let i = 0; i < compressibleEnd; i++) {
    const msg = messages[i]
    if (!msg) continue

    // Skip non-compressible roles (system prompts, etc.)
    const role = msg.info?.role || msg.role || "unknown"
    if (role === "system" || role === "context") continue

    // Use position-based ID for storage indexing
    const posId = makeMsgId(i, total)

    // Check if already compressed (either by block ID or position ID)
    const isAlreadyCompressed = storage?.compressedMessages?.[posId]
    if (isAlreadyCompressed && msg.content?.startsWith?.("[Compressed:")) {
      // Already handled
      compressedCount++
      continue
    }

    // Find matching block (if blocks exist) for topic/summary
    let block: CompressionBlock | undefined

    if (hasBlocks) {
      // Try to match by position — blocks are ordered chronologically
      // Block index roughly corresponds to position in message array
      // Use the first block that hasn't been fully consumed yet
      for (const b of blocks) {
        const firstBlockIdx = messages.findIndex((m) => {
          const mId = m.info?.id || m.id
          return mId && b.directMessageIds.includes(mId)
        })
        if (firstBlockIdx >= 0 && firstBlockIdx <= i) {
          block = b
          break
        }
      }
    }

    // If no matching block, create a minimal virtual block on-the-fly
    // using the message's own content as summary
    if (!block) {
      const msgText = msg.content || ""
      const summary = msgText.slice(0, SUMMARY_PREVIEW_MAX_CHARS)
      // Create inline block — just enough for placeholder construction
      block = {
        blockId: -1,
        topic: "auto-compressed",
        startId: posId,
        endId: posId,
        summary,
        summaryTokens: 0,
        directMessageIds: [posId],
        consumedBlockIds: [],
        preservedToolIds: [],
        createdAt: Date.now(),
      }
    }

    // Replace with placeholder — block is guaranteed set here
    const entry = replaceWithPlaceholder(msg, block!)

    // Store original content in session storage
    if (storage) {
      storage.compressedMessages[posId] = {
        placeholder: entry.placeholder,
        originalContent: entry.originalContent,
        originalParts: entry.originalParts,
      }
    }

    // Also store rawContent if it's a string message (newer format)
    compressedCount++

    // Estimate tokens saved
    const originalLen = (entry.originalContent || "").length +
      (entry.originalParts ? JSON.stringify(entry.originalParts).length : 0)
    const placeholderLen = entry.placeholder.length
    estimatedTokensSaved += Math.round((originalLen - placeholderLen) / 4)
  }

  return { compressedCount, estimatedTokensSaved }
}

/**
 * Restore original content for a specific message (for Reversible expand tool).
 *
 * @param msgId - The message ID to restore
 * @param msg - The message object to restore content into
 * @param storage - Session storage containing original content
 * @returns true if the message was restored
 */
export function restoreMessageContent(
  msgId: string,
  msg: any,
  storage: SessionStorage,
): boolean {
  const entry = storage.compressedMessages[msgId]
  if (!entry) return false

  // Restore content
  if (entry.originalContent !== undefined) {
    msg.content = entry.originalContent
  }

  // Restore parts
  if (entry.originalParts !== undefined) {
    msg.parts = JSON.parse(JSON.stringify(entry.originalParts))
  }

  // Remove from compressed messages (no longer compressed)
  delete storage.compressedMessages[msgId]

  return true
}

/**
 * Get placeholder info for a compressed message.
 */
export function getCompressedEntry(
  msgId: string,
  storage: SessionStorage,
): CompressedMessageEntry | undefined {
  return storage.compressedMessages[msgId]
}

/**
 * Get count of compressed messages.
 */
export function getCompressedCount(storage: SessionStorage): number {
  return Object.keys(storage.compressedMessages).length
}
