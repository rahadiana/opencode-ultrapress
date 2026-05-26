/**
 * Layer 4 — Auto Cleanup
 * Orchestrates deduplication and error purging
 */

import type { CleanupConfig, SessionStats } from "../config/schema.js"
import { deduplicateToolOutput } from "../cleanup/dedup.js"
import { registerToolResult, incrementTurnAndGetPurgeable } from "../cleanup/purge-errors.js"
import { estimateTokens } from "../utils/token-count.js"
import * as logger from "../utils/logger.js"

export interface Layer4Deps {
  config: CleanupConfig
  stats: SessionStats
}

export function applyCleanup(
  toolName: string,
  args: Record<string, any>,
  output: string,
  isError: boolean,
  messageId: string,
  deps: Layer4Deps
): string {
  let finalOutput = output

  // 1. Register for Error Purging
  if (deps.config.purgeErrors.enabled) {
     registerToolResult(messageId, isError)
  }

  // 2. Deduplication
  if (deps.config.deduplication.enabled && !isError) {
     const { isDuplicate, output: dedupedOutput } = deduplicateToolOutput(toolName, args, output, messageId)
     if (isDuplicate) {
        const originalTokens = estimateTokens(finalOutput)
        const dedupedTokens = estimateTokens(dedupedOutput)
        const saved = originalTokens - dedupedTokens

         finalOutput = dedupedOutput
         deps.stats.deduplicationCount++
        if (saved > 0) {
          deps.stats.savedByLayer.cleanup += saved
        }
         logger.debug(`[L4] Deduplicated tool call: ${toolName}`)
     }
  }

  return finalOutput
}

// Called every turn (e.g., when the assistant responds)
export function handleTurnTick(deps: Layer4Deps): string[] {
  if (!deps.config.purgeErrors.enabled) return []

  const idsToPurge = incrementTurnAndGetPurgeable(deps.config.purgeErrors.turns)
  if (idsToPurge.length > 0) {
     deps.stats.errorPurgeCount += idsToPurge.length
     logger.debug(`[L4] Purging ${idsToPurge.length} stale error inputs`)
  }
  return idsToPurge
}
