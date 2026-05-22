/**
 * Tool call deduplication.
 * Replaces duplicate tool calls with a placeholder pointing to the original.
 */

import crypto from "crypto"

// Maps hash(tool+args) -> original tool output
const sessionCache = new Map<string, { id: string; summary: string }>()

export const DEDUP_CACHE_MAX_ENTRIES = 1000

function enforceDedupCacheLimit(): void {
  while (sessionCache.size > DEDUP_CACHE_MAX_ENTRIES) {
    const oldestKey = sessionCache.keys().next().value
    if (!oldestKey) break
    sessionCache.delete(oldestKey)
  }
}

export function hashToolCall(toolName: string, args: Record<string, any>): string {
  const normalizedArgs = JSON.stringify(args, Object.keys(args).sort())
  const str = `${toolName}:${normalizedArgs}`
  return crypto.createHash("md5").update(str).digest("hex")
}

export function deduplicateToolOutput(
  toolName: string,
  args: Record<string, any>,
  output: string,
  messageId: string
): { isDuplicate: boolean; output: string } {
  // We only dedup read-only / deterministic tools
  const safeTools = ["bash", "read_file", "list_dir", "grep_search", "shell", "run_command"]
  if (!safeTools.includes(toolName)) {
    return { isDuplicate: false, output }
  }

  // Certain bash commands shouldn't be deduped as they change state
  if (toolName === "bash" || toolName === "shell" || toolName === "run_command") {
     const cmd = (args.command || args.cmd || "").toLowerCase()
     const mutableCmds = ["git commit", "git push", "npm install", "cargo build", "rm ", "touch ", "echo "]
     if (mutableCmds.some(m => cmd.includes(m))) {
        return { isDuplicate: false, output }
     }
  }

  const hash = hashToolCall(toolName, args)

  if (sessionCache.has(hash)) {
    const cached = sessionCache.get(hash)!
    // It's a duplicate. Replace output with a tiny reference.
    return {
      isDuplicate: true,
      output: `[Duplicate output. Identical to previous call #${cached.id.slice(0,6)}]\nSummary: ${cached.summary}`,
    }
  }

  // Not a duplicate. Store for future.
  // Generate a tiny summary of the output to help LLM remember what it was without seeing the full output again
  const summary = output.slice(0, 100).replace(/\n/g, " ") + (output.length > 100 ? "..." : "")
  sessionCache.set(hash, { id: messageId, summary })
  enforceDedupCacheLimit()

  return { isDuplicate: false, output }
}

export function clearDedupCache(): void {
  sessionCache.clear()
}

export function getDedupCacheSize(): number {
  return sessionCache.size
}
