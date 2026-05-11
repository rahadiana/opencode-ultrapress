/**
 * Generic smart filter — fallback for unrecognized commands.
 * Applies universal compression heuristics.
 */

import type { FilterResult } from "../config/schema.js"
import { estimateTokens } from "../utils/token-count.js"

/**
 * Strip ANSI escape codes from text.
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
}

/**
 * Collapse consecutive blank lines to max 1.
 */
export function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n")
}

/**
 * Deduplicate consecutive identical lines, appending [×N].
 */
export function deduplicateLines(lines: string[]): string[] {
  const result: string[] = []
  let lastLine = ""
  let count = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === lastLine && trimmed !== "") {
      count++
    } else {
      if (count > 1) {
        result[result.length - 1] += ` [×${count}]`
      }
      result.push(line)
      lastLine = trimmed
      count = 1
    }
  }

  // Handle trailing dupes
  if (count > 1) {
    result[result.length - 1] += ` [×${count}]`
  }

  return result
}

/**
 * Truncate text to maxChars, keeping head and tail.
 */
export function smartTruncate(
  text: string,
  maxChars: number
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false }
  }

  const headSize = Math.floor(maxChars * 0.7)
  const tailSize = Math.floor(maxChars * 0.25)
  const skippedChars = text.length - headSize - tailSize

  const head = text.slice(0, headSize)
  const tail = text.slice(-tailSize)

  return {
    text: `${head}\n\n... [${skippedChars} chars truncated] ...\n\n${tail}`,
    truncated: true,
  }
}

/**
 * Strip comment-only lines (# // -- ;; rem).
 */
export function stripCommentLines(lines: string[]): string[] {
  return lines.filter((line) => {
    const trimmed = line.trim()
    if (trimmed === "") return true // keep blank lines (collapse later)
    return !(
      trimmed.startsWith("# ") ||
      trimmed.startsWith("// ") ||
      trimmed.startsWith("-- ") ||
      trimmed.startsWith(";; ") ||
      /^rem\s/i.test(trimmed)
    )
  })
}

/**
 * Generic filter: applies all universal heuristics.
 */
export function filterGeneric(
  output: string,
  maxChars: number
): FilterResult {
  const originalTokens = estimateTokens(output)

  // Pipeline
  let text = stripAnsi(output)
  let lines = text.split("\n")

  // Remove comment lines
  lines = stripCommentLines(lines)

  // Deduplicate consecutive lines
  lines = deduplicateLines(lines)

  // Rejoin and collapse blanks
  text = collapseBlankLines(lines.join("\n")).trim()

  // Truncate if still too long
  const { text: finalText, truncated } = smartTruncate(text, maxChars)

  const filteredTokens = estimateTokens(finalText)

  return {
    output: finalText,
    originalTokens,
    filteredTokens,
    truncated,
  }
}
