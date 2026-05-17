/**
 * Layer 1 — Output Filter
 * Applies RTK-style smart filtering to raw tool outputs before they hit the LLM context.
 */

import type { OutputFilterConfig, FilterResult, SessionStats } from "../config/schema.js"
import { filterBash, detectBashCategory } from "../filters/bash.js"
import { filterGit } from "../filters/git.js"
import { filterTest, detectTestFramework } from "../filters/test.js"
import { filterFs, detectFsCommand } from "../filters/fs.js"
import { filterGeneric } from "../filters/generic.js"
import * as logger from "../utils/logger.js"
import * as tokenCount from "../utils/token-count.js"

export interface Layer1Deps {
  config: OutputFilterConfig
  stats: SessionStats
}

export function processToolOutput(
  toolName: string,
  args: Record<string, any>,
  rawOutput: string,
  deps: Layer1Deps
): string {
  if (!deps.config.enabled || !rawOutput) {
    return rawOutput
  }

  // Skip protected tools (e.g., sub-agent task output)
  if (deps.config.skipTools?.includes(toolName)) {
    return rawOutput
  }

  const { maxCharsPerOutput } = deps.config
  let result: FilterResult
  let command = ""

  try {
    // 1. Detect command if it's a bash/shell tool
    if (toolName === "bash" || toolName === "shell" || toolName === "run_command") {
      command = args.command || args.cmd || ""
      
      // Route to specific filter based on command signature
      if (command.includes("git ")) {
        result = filterGit(command, rawOutput, maxCharsPerOutput)
      } else if (detectTestFramework(command) !== "generic") {
        result = filterTest(command, rawOutput, maxCharsPerOutput)
      } else if (detectFsCommand(command) !== "generic") {
        result = filterFs(command, rawOutput, maxCharsPerOutput)
      } else if (detectBashCategory(command) !== "generic") {
        result = filterBash(command, rawOutput, maxCharsPerOutput)
      } else {
        result = filterGeneric(rawOutput, maxCharsPerOutput)
      }
    } 
    // 2. Custom tools (e.g. read_file, list_dir, grep_search)
    else if (toolName === "list_dir" || toolName === "read_file" || toolName === "grep_search") {
       // Just use generic compression for generic tools
       result = filterGeneric(rawOutput, maxCharsPerOutput)
    }
    else {
       // Non-CLI tools pass through generic smart truncation
       result = filterGeneric(rawOutput, maxCharsPerOutput)
    }

    // Custom Regex Filters (if configured)
    if (deps.config.customFilters && deps.config.customFilters.length > 0) {
       result.output = applyCustomFilters(command, result.output, deps.config.customFilters)
       result.filteredTokens = tokenCount.estimateTokens(result.output)
    }

    // Update Stats
    const saved = result.originalTokens - result.filteredTokens
    if (saved > 0) {
      deps.stats.savedByLayer.outputFilter += saved
      deps.stats.compressionCount++
      logger.debug(`[L1] ${toolName} output compressed: ${tokenCount.formatSavings(result.originalTokens, result.filteredTokens)}`)
    }

    // Tee save on truncate
    if (result.truncated && deps.config.teeSaveOnTruncate) {
       // In a real plugin, we would write rawOutput to a temp file and append the path to result.output
       // result.output += `\n\n[Full output saved to: /tmp/ultrapress-...]`
    }

    return result.output

  } catch (err) {
    logger.error(`Layer 1 filter failed for ${toolName}: ${err}`)
    return rawOutput // Fallback to raw on error
  }
}

function applyCustomFilters(command: string, output: string, filters: any[]): string {
  let text = output
  for (const filter of filters) {
    try {
      const regex = new RegExp(filter.commandPattern)
      if (regex.test(command)) {
        let lines = text.split("\n")
        
        if (filter.stripPatterns) {
           for (const pattern of filter.stripPatterns) {
              const stripRegex = new RegExp(pattern)
              lines = lines.filter(l => !stripRegex.test(l))
           }
        }
        
        text = lines.join("\n")
      }
    } catch (e) {
      // ignore bad regex
    }
  }
  return text
}
