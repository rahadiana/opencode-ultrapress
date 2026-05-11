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
      return buildStatsResponse(stats)
    case "context":
      return buildContextResponse(stats, config)
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

function buildStatsResponse(stats: SessionStats): string {
  const { totalTokensRaw, totalTokensCompressed, savedByLayer } = stats
  
  if (totalTokensRaw === 0) {
     return `UltraPress Stats:\nNo tool outputs processed yet in this session.`
  }

  const totalSaved = totalTokensRaw - totalTokensCompressed
  const overallPct = Math.round((totalSaved / totalTokensRaw) * 100)

  return `🔥 UltraPress Session Stats
───────────────────────────────────
Total Original : ${formatTokens(totalTokensRaw)}
Total Compressed : ${formatTokens(totalTokensCompressed)}
Overall Savings : ${formatTokens(totalSaved)} (−${overallPct}%)

Breakdown:
- L1 Filter : saved ${formatTokens(savedByLayer.outputFilter)}
- L2 Semantic : saved ${formatTokens(savedByLayer.semantic)}
- L3 Summary : saved ${formatTokens(savedByLayer.summarization)}

Deduplications : ${stats.deduplicationCount}
Error Purges : ${stats.errorPurgeCount}
`
}

function buildContextResponse(_stats: SessionStats, config: UltraPressConfig): string {
   return `UltraPress Context Info:
Limit: ${config.summarization.maxContextLimit} tokens
Target: ${config.summarization.minContextLimit} tokens
(To force compression, type: /up compress)`
}

function buildHelpResponse(): string {
  return `UltraPress Commands:
/up stats            - Show token savings this session
/up context          - Show context window info
/up compress [focus] - Force L3 summarization now
/up mode <nlp|mlm|llm> - Change L2 semantic compression mode
/up filter <on|off>  - Toggle L1 output filter
/up manual <on|off>  - Toggle auto-summarization
`
}
