/**
 * Error input purging.
 * Tracks tool errors and purges the input/args after N turns.
 */

// Format: Map<messageId, { turnsAlive: number, isError: boolean }>
const errorHistory = new Map<string, { turnsAlive: number; isError: boolean }>()

export const ERROR_HISTORY_MAX_ENTRIES = 2000
export const NON_ERROR_RETENTION_MULTIPLIER = 2

function enforceErrorHistoryLimit(): void {
  while (errorHistory.size > ERROR_HISTORY_MAX_ENTRIES) {
    const oldestKey = errorHistory.keys().next().value
    if (!oldestKey) break
    errorHistory.delete(oldestKey)
  }
}

export function registerToolResult(messageId: string, isError: boolean) {
  errorHistory.set(messageId, { turnsAlive: 0, isError })
  enforceErrorHistoryLimit()
}

export function incrementTurnAndGetPurgeable(maxTurns: number): string[] {
  const toPurge: string[] = []
  const safeMaxTurns = Math.max(1, maxTurns)
  const nonErrorRetentionTurns = Math.max(
    safeMaxTurns + 1,
    safeMaxTurns * NON_ERROR_RETENTION_MULTIPLIER,
  )

  for (const [msgId, data] of errorHistory.entries()) {
    data.turnsAlive++
    if (data.isError && data.turnsAlive >= safeMaxTurns) {
      toPurge.push(msgId)
      errorHistory.delete(msgId) // We purge it now
      continue
    }

    if (!data.isError && data.turnsAlive >= nonErrorRetentionTurns) {
      errorHistory.delete(msgId)
    }
  }

  return toPurge
}

export function resetErrorHistory(): void {
  errorHistory.clear()
}

export function getErrorHistorySize(): number {
  return errorHistory.size
}
