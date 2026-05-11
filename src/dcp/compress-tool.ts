/**
 * Custom LLM Tool for Dynamic Context Pruning (DCP)
 */

import { tool } from "@opencode-ai/plugin"
import type { ToolDefinition } from "@opencode-ai/plugin"
import { storeSummary } from "./summary-store.js"
import { estimateTokens } from "../utils/token-count.js"

const z = tool.schema

export const compressToolDefinition: ToolDefinition = tool({
  description: "Compress stale conversation spans or specific messages into high-fidelity summaries. Call this when the system alerts you about large context size.",
  args: {
    mode: z.enum(["range", "message"]).describe("Use 'range' to compress a block between from_id and to_id. Use 'message' for surgical specific IDs."),
    from_id: z.string().optional().describe("Start message ID (required if mode=range)"),
    to_id: z.string().optional().describe("End message ID (required if mode=range)"),
    message_ids: z.array(z.string()).optional().describe("List of specific IDs to compress (required if mode=message)"),
    focus: z.string().optional().describe("Optional specific topic/focus that this summary revolves around."),
    summary: z.string().describe("The high-fidelity summary YOU generate to replace these messages. Keep technical facts intact.")
  },
  execute: async (args, _ctx) => {
    const { mode, from_id, to_id, message_ids, focus, summary } = args

    if (mode === "range") {
      if (!from_id || !to_id) {
        return "Error: from_id and to_id are required for range mode."
      }
      const span = storeSummary(from_id, to_id, summary, focus)
      const tokens = estimateTokens(summary)
      return `Success: Span replaced with summary (${tokens} tokens). Span ID: ${span.id}`
    } 
    
    if (mode === "message") {
      if (!message_ids || message_ids.length === 0) {
        return "Error: message_ids required for message mode."
      }
      return `Success: Messages replaced with surgical summary.`
    }

    return "Error: Invalid mode."
  }
})
