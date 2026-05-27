/**
 * Compression Block State — tracks which message ranges have been compressed,
 * with nesting support (compression on top of previous compression).
 */

export interface CompressionBlock {
  blockId: number
  topic: string
  startId: string
  endId: string
  summary: string
  summaryTokens: number
  /** IDs of messages directly claimed by this block */
  directMessageIds: string[]
  /** IDs of blocks that were consumed (nested) inside this block */
  consumedBlockIds: number[]
  /** IDs of tool calls whose outputs were preserved in the summary */
  preservedToolIds: string[]
  createdAt: number
  /** Original message contents stored for reversible expansion (plugin memory, not LLM context) */
  originalEntries?: Array<{ id: string; role: string; content: string }>
}

let blockCounter = 0
let resetGeneration = 0
const blocksByMessageId = new Map<string, number[]>() // messageId → blockIds
const blocksById = new Map<number, CompressionBlock>()

function generateBlockId(): number {
  blockCounter++
  // Keep IDs below Number.MAX_SAFE_INTEGER while preserving ordering and reset uniqueness.
  const timePrefix = Date.now() % 1_000_000_000
  return timePrefix * 1_000_000 + resetGeneration * 10_000 + blockCounter
}

export function createBlock(
  topic: string,
  startId: string,
  endId: string,
  summary: string,
  summaryTokens: number,
  messageIds: string[],
  consumedBlockIds: number[],
  preservedToolIds: string[],
): CompressionBlock {
  const block: CompressionBlock = {
    blockId: generateBlockId(),
    topic,
    startId,
    endId,
    summary,
    summaryTokens,
    directMessageIds: messageIds,
    consumedBlockIds,
    preservedToolIds,
    createdAt: Date.now(),
  }
  blocksById.set(block.blockId, block)
  for (const msgId of messageIds) {
    const existing = blocksByMessageId.get(msgId) || []
    existing.push(block.blockId)
    blocksByMessageId.set(msgId, existing)
  }
  return block
}

/** Get all blocks sorted by creation time (oldest first) */
export function getAllBlocks(): CompressionBlock[] {
  return Array.from(blocksById.values()).sort((a, b) => a.createdAt - b.createdAt)
}

/** Check if a message is already claimed by a compression block */
export function isMessageCompressed(msgId: string): boolean {
  return blocksByMessageId.has(msgId)
}

/** Get block IDs for a message */
export function getBlockIdsForMessage(msgId: string): number[] {
  return blocksByMessageId.get(msgId) || []
}

/** Get a specific block */
export function getBlock(blockId: number): CompressionBlock | undefined {
  return blocksById.get(blockId)
}

/** Get the effective summary for a block (including nested block summaries) */
export function getEffectiveSummary(blockId: number): string {
  const block = blocksById.get(blockId)
  if (!block) return ""
  
  // Gather nested summaries from consumed blocks
  const nestedSummaries = block.consumedBlockIds
    .map(id => blocksById.get(id))
    .filter((b): b is CompressionBlock => !!b)
    .map(b => `[Previously compressed summary: ${b.summary}]`)

  if (nestedSummaries.length === 0) return block.summary
  
  return [...nestedSummaries, block.summary].join("\n\n")
}

// ─── Reversible Compression ────────────────────────────────────────────

/**
 * Store original message content alongside a compression block.
 * This keeps original text in plugin memory (NOT in LLM context)
 * so the LLM can call ultrapress_expand to retrieve details it needs.
 */
export function storeOriginalContent(
  blockId: number,
  messages: Array<{ id?: string; role?: string; content?: string; parts?: any[]; info?: { id?: string; role?: string } }>,
): void {
  const block = blocksById.get(blockId)
  if (!block) return

  const entries: Array<{ id: string; role: string; content: string }> = []
  for (const msg of messages) {
    let content = msg.content || ""
    if (!content && msg.parts) {
      for (const part of msg.parts) {
        if (part.type === "text" || part.type === "tool") {
          content += (content ? "\n" : "") + (part.text || part.output || "")
        }
      }
    }
    if (content) {
      const entryId = msg.info?.id || msg.id || `msg_unknown_${blockId}_${entries.length}`
      entries.push({ id: entryId, role: msg.role || "unknown", content })
    }
  }
  block.originalEntries = entries
}

/**
 * Expand a compressed block — return original message contents.
 * Used by ultrapress_expand tool to restore context when LLM needs details.
 */
export function expandBlock(blockId: number): Array<{ id: string; role: string; content: string }> | null {
  const block = blocksById.get(blockId)
  if (!block || !block.originalEntries) return null
  return block.originalEntries
}

/**
 * Find a block by topic substring or blockId.
 */
export function findBlock(query: string): CompressionBlock | undefined {
  const id = parseInt(query, 10)
  if (!isNaN(id)) return blocksById.get(id)
  for (const block of blocksById.values()) {
    if (block.topic.toLowerCase().includes(query.toLowerCase())) return block
  }
  return undefined
}

/** Reset all state (for testing) */
export function resetCompressionState(): void {
  blockCounter = 0
  resetGeneration++
  blocksByMessageId.clear()
  blocksById.clear()
  protectedContext.clear()
}

// ─── Protected Context (moved from summary-store.ts) ────────────────────

const protectedContext = new Map<string, Set<string>>()

export function addProtectedContext(sessionId: string, topic: string, content: string) {
  if (!protectedContext.has(sessionId)) {
    protectedContext.set(sessionId, new Set())
  }
  protectedContext.get(sessionId)!.add(`[${topic}] ${content}`)
}

export function getProtectedContextString(sessionId: string): string {
  const ctx = protectedContext.get(sessionId)
  if (!ctx || ctx.size === 0) return "No critical protected context."
  return Array.from(ctx).join("\n")
}
