/**
 * Protected Tool & Content Patterns.
 * Certain tool outputs are always preserved in compression summaries
 * because they represent user intent/actions (task, write, edit, etc.).
 */

// Tools whose outputs should never be pruned without preservation
const PROTECTED_TOOLS = new Set([
  "task",
  "skill",
  "todowrite",
  "todoread",
  "write",
  "edit",
  // UltraPress tools
  "ultrapress_compress",
])

// Tools whose outputs should be preserved in compression summaries
const SUMMARY_PRESERVE_TOOLS = new Set([
  "task",
  "skill",
  "todowrite",
  "todoread",
])

export function isProtectedTool(toolName: string): boolean {
  return PROTECTED_TOOLS.has(toolName)
}

export function shouldPreserveInSummary(toolName: string): boolean {
  return SUMMARY_PRESERVE_TOOLS.has(toolName)
}

/**
 * Given a list of message IDs, return the subset that are
 * "tool result" messages that should be preserved.
 * In OpenCode, tool results have parts with type "tool".
 */
export function findPreservableToolIds(
  messages: Array<{ id: string; parts?: Array<{ type?: string; tool?: string }> }>,
  messageIds: string[],
): string[] {
  const preserved: string[] = []
  for (const msg of messages) {
    if (!messageIds.includes(msg.id)) continue
    const parts = msg.parts || []
    for (const part of parts) {
      if (part.type === "tool" && part.tool && shouldPreserveInSummary(part.tool)) {
        preserved.push(msg.id)
      }
    }
  }
  return preserved
}
