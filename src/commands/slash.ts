/**
 * Slash commands for UltraPress.
 * Handles: /up, /up stats, /up context, /up mode, /up filter, /up manual
 */

import type { SessionStats, UltraPressConfig } from "../config/schema.js"
import { formatTokens } from "../utils/token-count.js"

export function handleSlashCommand(
  command: string,
  stats: SessionStats,
  config: UltraPressConfig
): string {
  const parts = command.trim().split(/\s+/)
  const subcmd = parts[1]?.toLowerCase()
  const arg = parts[2]?.toLowerCase()

  switch (subcmd) {
    case "stats":
      return buildStatsResponse(stats, config)
    case "context":
      return buildContextResponse(stats, config)
    case "compress":
      return buildCompressResponse(stats, config)
    case "mode":
      if (arg === "nlp" || arg === "mlm" || arg === "llm") {
         config.semantic.mode = arg
         return `UltraPress: Semantic mode set to ${arg.toUpperCase()}`
      }
      return `UltraPress: Valid modes are nlp, mlm, llm.`
    case "filter":
      if (arg === "on" || arg === "off") {
         config.outputFilter.enabled = (arg === "on")
         return `UltraPress: L1 Output Filter is now ${arg.toUpperCase()}`
      }
      return `UltraPress: Use '/up filter on|off'`
    case "manual":
      if (arg === "on" || arg === "off") {
         config.summarization.enabled = (arg === "off") // If manual is ON, auto-summary is OFF
         return `UltraPress: Auto-summarization is now ${arg === "on" ? "DISABLED (Manual Mode)" : "ENABLED"}`
      }
      return `UltraPress: Use '/up manual on|off'`
    default:
      return buildHelpResponse()
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

  return `🔥 UltraPress Session Stats
───────────────────────────────────
Total Original   : ${formatTokens(totalTokensRaw)}
Total Compressed : ${formatTokens(totalTokensCompressed)}
Overall Savings  : ${formatTokens(totalSaved)} (−${overallPct}%)

Breakdown by layer:
  L1 Filter  : saved ${formatTokens(savedByLayer.outputFilter)}
  L2 Semantic: saved ${formatTokens(savedByLayer.semantic)}
  L3 Summary : saved ${formatTokens(savedByLayer.summarization)}
  L4 Cleanup : saved ${formatTokens(savedByLayer.cleanup)}

Deduplications : ${stats.deduplicationCount}
Error Purges   : ${stats.errorPurgeCount}
Compressions   : ${stats.compressionCount}
`
}

function buildContextResponse(stats: SessionStats, config: UltraPressConfig): string {
   const uptime = Math.round((Date.now() - stats.startTime) / 1000)
   const minutes = Math.floor(uptime / 60)
   const seconds = uptime % 60
   return `📐 UltraPress Context Info
───────────────────────────────────
Context Limit  : ${config.summarization.maxContextLimit.toLocaleString()} tokens
Target After   : ${config.summarization.minContextLimit.toLocaleString()} tokens
Nudge Every    : ${config.summarization.nudgeFrequency} turns
Session Uptime : ${minutes}m ${seconds}s

Type '/up compress' to force summarization now.
Type '/up stats' to see savings breakdown.`
}

function buildCompressResponse(stats: SessionStats, config: UltraPressConfig): string {
   const anySaved = stats.savedByLayer.outputFilter + stats.savedByLayer.semantic + stats.savedByLayer.summarization + stats.savedByLayer.cleanup

   // Enable summarization if it was off
   const wasSummarizationEnabled = config.summarization.enabled
   config.summarization.enabled = true

   const statusLines = [
      `✅ L1 Output Filter : ${config.outputFilter.enabled ? "active" : "disabled"}`,
      `✅ L2 Semantic (${config.semantic.mode.toUpperCase()}) : ${config.semantic.enabled ? "active" : "disabled"}`,
      `✅ L3 DCP Summarization : active (nudge injected into next prompt)`,
      `✅ L4 Auto Cleanup : active`,
   ].join("\n")

   const savingsLine = anySaved > 0
      ? `\nSaved so far this session: ${formatTokens(anySaved)} tokens.`
      : `\nNo tokens compressed yet — plugin just started or no tools have run.`

   const noteLines = !wasSummarizationEnabled
      ? `\n⚠️  L3 was disabled. It has been re-enabled for this session.`
      : ""

   return `🗜️  UltraPress: Force Compress
───────────────────────────────────
All compression layers are active:\n${statusLines}${savingsLine}${noteLines}

A summarization nudge will be injected into your next message.
To see the savings report, type: /up stats`
}

function buildHelpResponse(): string {
  return `📦 UltraPress — Token Compression Plugin
───────────────────────────────────
/up stats              - Show token savings breakdown
/up context            - Show context window status
/up compress           - Force summarization + show layer status
/up mode <nlp|mlm|llm> - Change L2 semantic mode
/up filter <on|off>    - Toggle L1 output filter
/up manual <on|off>    - Toggle auto-summarization
`
}
