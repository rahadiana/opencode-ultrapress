/**
 * Layer 1 — Output Filter
 * Applies RTK-style smart filtering to raw tool outputs before they hit the LLM context.
 */

import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { CustomFilter, OutputFilterConfig, FilterResult, SessionStats } from "../config/schema.js"
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
       const customResult = applyCustomFilters(command, result.output, deps.config.customFilters)
       result.output = customResult.output
       result.filteredTokens = tokenCount.estimateTokens(result.output)

       if (customResult.audit.matchedFilters > 0 &&
          (customResult.audit.removedLines > 0 || customResult.audit.trimmedByMaxLines > 0 || customResult.audit.invalidRegexCount > 0)) {
         logger.debug(
           `[L1] Custom filters audit: matched=${customResult.audit.matchedFilters}, removedLines=${customResult.audit.removedLines}, trimmed=${customResult.audit.trimmedByMaxLines}, invalidRegex=${customResult.audit.invalidRegexCount}`
         )
       }
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
       const fullOutputPath = saveTruncatedOutput(toolName, rawOutput)
       result.fullOutputPath = fullOutputPath
       result.output += `\n\n[Full output saved to: ${fullOutputPath}]`
    }

    return result.output

  } catch (err) {
    logger.error(`Layer 1 filter failed for ${toolName}: ${err}`)
    return rawOutput // Fallback to raw on error
  }
}

function saveTruncatedOutput(toolName: string, rawOutput: string): string {
  const dir = join(tmpdir(), "opencode-ultrapress")
  mkdirSync(dir, { recursive: true })
  const safeToolName = toolName.replace(/[^a-z0-9_-]/gi, "_") || "tool"
  const filePath = join(dir, `${Date.now()}-${safeToolName}.log`)
  writeFileSync(filePath, rawOutput, "utf-8")
  return filePath
}

interface CustomFilterAudit {
  matchedFilters: number
  removedLines: number
  trimmedByMaxLines: number
  invalidRegexCount: number
}

function applyCustomFilters(command: string, output: string, filters: CustomFilter[]): { output: string; audit: CustomFilterAudit } {
  let text = output
  const audit: CustomFilterAudit = {
    matchedFilters: 0,
    removedLines: 0,
    trimmedByMaxLines: 0,
    invalidRegexCount: 0,
  }

  for (const filter of filters) {
    try {
      const regex = new RegExp(filter.commandPattern)
      if (!regex.test(command)) continue
      audit.matchedFilters++

      let lines = text.split("\n")
      const beforeLineCount = lines.length
      const keepRegexes = filter.keepPatterns.map(p => new RegExp(p))
      const stripRegexes = filter.stripPatterns.map(p => new RegExp(p))

      if (stripRegexes.length > 0) {
        lines = lines.filter(line => {
          if (keepRegexes.some(keep => keep.test(line))) return true
          return !stripRegexes.some(strip => strip.test(line))
        })

        const removed = Math.max(0, beforeLineCount - lines.length)
        audit.removedLines += removed
      }

      if (filter.maxLines && lines.length > filter.maxLines) {
        const omitted = lines.length - filter.maxLines
        audit.trimmedByMaxLines += omitted
        lines = [...lines.slice(0, filter.maxLines), `... [${omitted} lines omitted by custom filter]`]
      }

      text = lines.join("\n")
    } catch (err) {
      audit.invalidRegexCount++
      logger.debug(`[L1] Ignored invalid custom filter regex for pattern "${filter.commandPattern}": ${err}`)
    }
  }

  return { output: text, audit }
}
