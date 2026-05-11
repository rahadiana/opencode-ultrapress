/**
 * Error input purging.
 * Tracks tool errors and purges the input/args after N turns.
 */

// Format: Map<messageId, { turnsAlive: number, isError: boolean }>
const errorHistory = new Map<string, { turnsAlive: number; isError: boolean }>()

export function registerToolResult(messageId: string, isError: boolean) {
  errorHistory.set(messageId, { turnsAlive: 0, isError })
}

export function incrementTurnAndGetPurgeable(maxTurns: number): string[] {
  const toPurge: string[] = []

  for (const [msgId, data] of errorHistory.entries()) {
    data.turnsAlive++
    if (data.isError && data.turnsAlive >= maxTurns) {
      toPurge.push(msgId)
      errorHistory.delete(msgId) // We purge it now
    }
  }

  return toPurge
}
