/**
 * Session Summary State Store.
 * Keeps track of nested summaries and protected context.
 */

export interface SummarySpan {
  id: string
  fromId: string
  toId: string
  content: string
  focus?: string
  createdAt: number
}

const activeSummaries = new Map<string, SummarySpan>()
const protectedContext = new Map<string, Set<string>>()

export function storeSummary(
  fromId: string, 
  toId: string, 
  content: string, 
  focus?: string
): SummarySpan {
  const id = `sum_${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const span: SummarySpan = {
    id,
    fromId,
    toId,
    content,
    focus,
    createdAt: Date.now()
  }
  activeSummaries.set(id, span)
  return span
}

export function getSummary(id: string): SummarySpan | undefined {
  return activeSummaries.get(id)
}

export function getAllSummaries(): SummarySpan[] {
  return Array.from(activeSummaries.values()).sort((a, b) => a.createdAt - b.createdAt)
}

// Protected context management (files being worked on, key decisions)
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

export function clearSummaryStore() {
  activeSummaries.clear()
  protectedContext.clear()
}
