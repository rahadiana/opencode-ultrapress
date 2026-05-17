/**
 * Expand Tool — reverses compression by retrieving original message content
 * from plugin memory. No tokens are consumed in the LLM context until the
 * LLM explicitly requests expansion.
 *
 * Usage:
 *   ultrapress_expand block_id=0           → returns all original messages in block 0
 *   ultrapress_expand topic="git diff"     → finds block by topic, returns contents
 */

import { tool } from "@opencode-ai/plugin"
import type { ToolDefinition } from "@opencode-ai/plugin"
import { expandBlock, findBlock, getAllBlocks } from "./compress-state.js"
import { formatTokens, estimateTokens } from "../utils/token-count.js"

const z = tool.schema

export const expandToolDefinition: ToolDefinition = tool({
  description: "Expand a previously compressed block to see its original content. Use this when you need more detail from a compressed section of the conversation. The original content is stored in plugin memory (no token cost until expanded).",
  args: {
    block_id: z.number().optional().describe("The block ID to expand (from previous ultrapress_compress output)."),
    topic: z.string().optional().describe("Topic name to search for the block (e.g., 'git diff', 'error analysis')."),
    max_output_tokens: z.number().optional().describe("Max tokens to return (default: 2000). Content beyond this is truncated."),
  },
  execute: async (args, _ctx) => {
    const { block_id, topic, max_output_tokens = 2000 } = args

    if (block_id === undefined && !topic) {
      // List all available expandable blocks
      const blocks = getAllBlocks().filter(b => b.originalEntries)
      if (blocks.length === 0) {
        return "No compressed blocks with expandable content found. Use ultrapress_compress with store_original=true to create expandable blocks."
      }
      const lines = blocks.map(b =>
        `  #${b.blockId} "${b.topic}" — ${b.originalEntries!.length} msg, ${formatTokens(b.summaryTokens)} summary`
      )
      return `Available expandable blocks:\n${lines.join("\n")}\n\nUse ultrapress_expand block_id=<id> to retrieve original content.`
    }

    // Find the block
    const block = block_id !== undefined
      ? findBlock(String(block_id))
      : (topic ? findBlock(topic) : undefined)

    const entries = block ? expandBlock(block.blockId) : null
    if (!entries || entries.length === 0) {
      return `Block not found or has no stored original content. Use ultrapress_expand without arguments to see available blocks.`
    }

    // Build expanded content
    let output = `## Expanded Block: ${block!.topic} (ID #${block!.blockId})\n`
    output += `Stored ${entries.length} messages | Summary was ${formatTokens(block!.summaryTokens)} tokens\n`
    output += `─`.repeat(60) + "\n\n"

    let totalTokens = estimateTokens(output)

    for (const entry of entries) {
      const entryText = `**${entry.role}** (${entry.id}):\n${entry.content}\n\n`
      const entryTokens = estimateTokens(entryText)

      if (totalTokens + entryTokens > max_output_tokens) {
        output += `\n... (truncated — remaining ${entries.length - entries.indexOf(entry) - 1} messages exceed ${formatTokens(max_output_tokens)} token limit)`
        break
      }

      output += entryText
      totalTokens += entryTokens
    }

    return output
  }
})
