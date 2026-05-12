/**
 * Custom LLM Tool for Dynamic Context Pruning (DCP)
 * Stores summaries AND marks message ranges for pruning.
 */

import { tool } from "@opencode-ai/plugin"
import type { ToolDefinition } from "@opencode-ai/plugin"
import { storeSummary } from "./summary-store.js"
import { createBlock } from "./compress-state.js"
import { estimateTokens, formatTokens } from "../utils/token-count.js"

const z = tool.schema

const MAX_SUMMARY_LENGTH = 5000

export const compressToolDefinition: ToolDefinition = tool({
  description: "Compress stale conversation spans or specific messages into high-fidelity summaries. Call this when the system alerts you about large context size. After calling, the compressed messages will be pruned from context on the next LLM request.",
  args: {
    mode: z.enum(["range", "message"]).describe("Use 'range' to compress a block between from_id and to_id. Use 'message' for surgical specific IDs."),
    from_id: z.string().optional().describe("Start message ID (required if mode=range)"),
    to_id: z.string().optional().describe("End message ID (required if mode=range)"),
    message_ids: z.array(z.string()).optional().describe("List of specific IDs to compress (required if mode=message)"),
    topic: z.string().optional().describe("Short topic describing what was compressed."),
    summary: z.string().describe("The high-fidelity summary YOU generate to replace these messages. Keep technical facts intact.")
  },
  execute: async (args, _ctx) => {
    const { mode, from_id, to_id, message_ids, topic, summary } = args

    if (!summary || summary.trim().length === 0) {
      return "Error: summary cannot be empty."
    }

    const summaryTokens = estimateTokens(summary)
    const summaryChars = summary.length

    if (summaryChars > MAX_SUMMARY_LENGTH) {
      return `Error: Summary too long (${formatTokens(summaryTokens)} tokens). Max ${MAX_SUMMARY_LENGTH} chars.`
    }

    // Also store in summary-store for backward compat
    if (mode === "range") {
      if (!from_id || !to_id) {
        return "Error: from_id and to_id required for range mode."
      }
      storeSummary(from_id, to_id, summary, topic)
      
      // Create compression block for actual pruning
      createBlock(
        topic || "conversation",
        from_id,
        to_id,
        summary,
        summaryTokens,
        [], // messageIds resolved at transform time
        [], // consumedBlockIds — future: check overlap with existing blocks
        [], // preservedToolIds — future: resolve from messages
      )

      return [
        `Compression stored for range ${from_id} → ${to_id}.`,
        `Summary: ${formatTokens(summaryTokens)} tokens (${summaryChars} chars)`,
        `Topic: ${topic || "general"}`,
        "Messages in this range will be pruned from context on the next request.",
      ].join("\n")
    } 
    
    if (mode === "message") {
      if (!message_ids || message_ids.length === 0) {
        return "Error: message_ids required for message mode."
      }
      
      const spanIds: string[] = []
      for (const msgId of message_ids) {
        const span = storeSummary(msgId, msgId, summary, topic)
        spanIds.push(span.id)
      }

      // Create compression block
      const firstId = message_ids[0]
      const lastId = message_ids[message_ids.length - 1]
      createBlock(
        topic || "messages",
        firstId,
        lastId,
        summary,
        summaryTokens,
        message_ids,
        [],
        [],
      )

      return [
        `Compression stored. ${message_ids.length} message(s): ${message_ids.join(", ")}`,
        `Summary: ${formatTokens(summaryTokens)} tokens (${summaryChars} chars)`,
        topic ? `Topic: ${topic}` : null,
        "These messages will be pruned from context on the next request.",
      ].filter(Boolean).join("\n")
    }

    return "Error: Invalid mode. Use 'range' or 'message'."
  }
})
