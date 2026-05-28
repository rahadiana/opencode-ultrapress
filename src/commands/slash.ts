/**
 * Slash commands for UltraPress.
 * Handles: /up, /up stats, /up context, /up mode, /up filter, /up manual
 */

import type { SessionStats, UltraPressConfig } from "../config/schema.js"
import { formatTokens } from "../utils/token-count.js"
import { getAllBlocks } from "../dcp/compress-state.js"

export interface SlashResult {
  response: string
  configMutated: boolean
}

export function handleSlashCommand(
  command: string,
  stats: SessionStats,
  config: UltraPressConfig
): SlashResult {
  const parts = command.trim().split(/\s+/)
  const subcmd = parts[1]?.toLowerCase()
  const arg = parts[2]?.toLowerCase()

  switch (subcmd) {
    case "stats":
      return { response: buildStatsResponse(stats, config), configMutated: false }
    case "context":
    case "ctx":
    case "c":
      return { response: buildContextResponse(stats, config), configMutated: false }
    case "compress":
    case "prune": {
      const wasEnabled = config.summarization.enabled
      return { response: buildCompressResponse(stats, config), configMutated: !wasEnabled }
    }
    case "mode":
      if (arg === "nlp" || arg === "mlm" || arg === "llm") {
         config.semantic.mode = arg
         return { response: `UltraPress: Semantic mode set to ${arg.toUpperCase()}`, configMutated: true }
      }
      return { response: `UltraPress: Valid modes are nlp, mlm, llm.`, configMutated: false }
    case "filter":
      if (arg === "on" || arg === "off") {
         config.outputFilter.enabled = (arg === "on")
         return { response: `UltraPress: L1 Output Filter is now ${arg.toUpperCase()}`, configMutated: true }
      }
      return { response: `UltraPress: Use '/up filter on|off'`, configMutated: false }
    case "manual":
      if (arg === "on" || arg === "off") {
         config.summarization.enabled = (arg === "off") // If manual is ON, auto-summary is OFF
         return { response: `UltraPress: Auto-summarization is now ${arg === "on" ? "DISABLED (Manual Mode)" : "ENABLED"}`, configMutated: true }
      }
      return { response: `UltraPress: Use '/up manual on|off'`, configMutated: false }
    default:
      return { response: buildHelpResponse(), configMutated: false }
  }
}

function buildStatsResponse(stats: SessionStats, config: UltraPressConfig): string {
  const { totalTokensRaw, totalTokensCompressed, savedByLayer } = stats
  
  const totalSaved = totalTokensRaw - totalTokensCompressed
  const anySaved = savedByLayer.outputFilter + savedByLayer.semantic + savedByLayer.summarization + savedByLayer.cleanup

  if (totalTokensRaw === 0 && anySaved === 0) {
     return `📊 UltraPress Stats
───────────────────────────────────
No messages compressed yet this session.
UltraPress is active and will compress on the next message.

L1 Filter  : ${config.outputFilter.enabled ? "✅ ON" : "❌ OFF"}
L2 Semantic: ${config.semantic.enabled ? "✅ ON" : "❌ OFF"}
L3 DCP     : ${config.summarization.enabled ? "✅ ON" : "❌ OFF"}
L4 Cleanup : ✅ ON`
  }

  const overallPct = totalTokensRaw > 0 ? Math.round((totalSaved / totalTokensRaw) * 100) : 0

  const realTokensLine = stats.actualTokensInput > 0
     ? `\nReal LLM Tokens (from API):
  Input     : ${formatTokens(stats.actualTokensInput)}
  Output    : ${formatTokens(stats.actualTokensOutput)}
  Reasoning : ${formatTokens(stats.actualTokensReasoning)}
  Total Cost: ${formatTokens(stats.actualTokensInput + stats.actualTokensOutput + stats.actualTokensReasoning)}
`
     : `\nReal LLM Tokens: Waiting for first LLM response...`

  return `🔥 UltraPress Session Stats
───────────────────────────────────
Total Original   : ${formatTokens(totalTokensRaw)}
Total Compressed : ${formatTokens(totalTokensCompressed)}
Overall Savings  : ${formatTokens(totalSaved)} (${overallPct > 0 ? '−' : overallPct < 0 ? '+' : ''}${overallPct}%)${realTokensLine}

Breakdown by layer:
  L1 Filter  : saved ${formatTokens(savedByLayer.outputFilter)}
  L2 Semantic: saved ${formatTokens(savedByLayer.semantic)}
  L3 Summary : saved ${formatTokens(savedByLayer.summarization)}
  L4 Cleanup : saved ${formatTokens(savedByLayer.cleanup)}

Deduplications : ${stats.deduplicationCount}
Error Purges   : ${stats.errorPurgeCount}
Compressions   : ${stats.compressionCount}
L3 Blocks      : ${getAllBlocks().length}
`
}

function buildContextResponse(stats: SessionStats, config: UltraPressConfig): string {
   const uptime = Math.round((Date.now() - stats.startTime) / 1000)
   const minutes = Math.floor(uptime / 60)
   const seconds = uptime % 60
   const realLine = stats.actualTokensInput > 0
      ? `\nReal Context  : ${stats.actualTokensInput.toLocaleString()} input + ${stats.actualTokensOutput.toLocaleString()} output tokens`
      : ""
   return `📐 UltraPress Context Info
───────────────────────────────────
Preserve Last N : ${config.summarization.preserveLastN} messages
Session Uptime : ${minutes}m ${seconds}s${realLine}`
}

function buildCompressResponse(stats: SessionStats, config: UltraPressConfig): string {
   const anySaved = stats.savedByLayer.outputFilter + stats.savedByLayer.semantic + stats.savedByLayer.summarization + stats.savedByLayer.cleanup

   // Enable summarization if it was off
   const wasSummarizationEnabled = config.summarization.enabled
   config.summarization.enabled = true

   const statusLines = [
      `✅ L1 Output Filter : ${config.outputFilter.enabled ? "active" : "disabled"}`,
      `✅ L2 Semantic (${config.semantic.mode.toUpperCase()}) : ${config.semantic.enabled ? "active" : "disabled"}`,
       `✅ L3 Placeholder Compression : active (preserveLastN=${config.summarization.preserveLastN})`,
      `✅ L4 Auto Cleanup : active`,
   ].join("\n")

   const savingsLine = anySaved > 0
       ? `\nSaved so far this session: ${formatTokens(anySaved)} tokens.`
       : `\nNo tokens compressed yet — plugin just started or no heavy tools have run.\nHint: use '/up stats' after a tool run to see compression activity.`

   const noteLines = !wasSummarizationEnabled
      ? `\n⚠️  L3 was disabled. It has been re-enabled for this session.`
      : ""

   return `🗜️  UltraPress: Compression Status
───────────────────────────────────
All compression layers are active:\n${statusLines}${savingsLine}${noteLines}

ℹ️  Note: '/up compress' enables/validates summarization mode and shows status.
    Actual pruning runs on the next chat turn when eligible compression blocks exist.

[Info: '/up stats' shows real-time token savings.]`
}

function buildHelpResponse(): string {
  return `📦 UltraPress — Token Compression Plugin
───────────────────────────────────
Available commands: stats, context, compress, mode, filter, manual

Use /up <command> to interact. All output is handled by UltraPress.`
}
