/**
 * Bash/shell output filters.
 * Handles: general shell commands, build output, docker, etc.
 */

import type { FilterResult } from "../config/schema.js"
import { estimateTokens } from "../utils/token-count.js"
import {
  stripAnsi,
  collapseBlankLines,
  deduplicateLines,
  smartTruncate,
} from "./generic.js"

/**
 * Detect command category from bash command string.
 */
export function detectBashCategory(
  command: string
): "build" | "docker" | "grep" | "generic" {
  const cmd = command.trim().toLowerCase()

  // Build commands
  if (
    cmd.includes("npm run build") ||
    cmd.includes("cargo build") ||
    cmd.includes("make ") ||
    cmd.includes("tsc") ||
    cmd.includes("webpack") ||
    cmd.includes("vite build") ||
    cmd.includes("esbuild") ||
    cmd.includes("tsup")
  ) {
    return "build"
  }

  // Docker commands
  if (cmd.startsWith("docker ") || cmd.startsWith("docker-compose ")) {
    return "docker"
  }

  // Grep/search commands
  if (
    cmd.startsWith("grep ") ||
    cmd.startsWith("rg ") ||
    cmd.startsWith("ag ") ||
    cmd.startsWith("ack ")
  ) {
    return "grep"
  }

  return "generic"
}

/**
 * Filter build output → errors/warnings + final status.
 */
function filterBuildOutput(output: string): string {
  const lines = output.split("\n")
  const important: string[] = []
  let finalStatus = ""

  for (const line of lines) {
    const lower = line.toLowerCase()

    // Keep error and warning lines
    if (
      lower.includes("error") ||
      lower.includes("warning") ||
      lower.includes("failed") ||
      lower.includes("fatal")
    ) {
      important.push(line.trim())
      continue
    }

    // Keep summary/status lines
    if (
      lower.includes("compiled") ||
      lower.includes("finished") ||
      lower.includes("success") ||
      lower.includes("built in") ||
      lower.includes("done in") ||
      lower.includes("build completed")
    ) {
      finalStatus = line.trim()
    }
  }

  if (important.length === 0 && finalStatus) {
    return `✓ ${finalStatus}`
  }

  if (important.length === 0) {
    return "✓ build ok"
  }

  const result = important.slice(0, 20).join("\n")
  return finalStatus ? `${result}\n\n${finalStatus}` : result
}

/**
 * Filter docker output → compact format.
 */
function filterDockerOutput(output: string, command: string): string {
  const lines = output.split("\n").filter((l) => l.trim())

  // docker ps → compact
  if (command.includes("docker ps")) {
    if (lines.length <= 1) return "[no containers]"

    // Parse table: keep ID, image, status, names
    const result = lines.slice(1).map((line) => {
      const parts = line.split(/\s{2,}/)
      if (parts.length >= 5) {
        const id = parts[0]?.slice(0, 12) ?? ""
        const image = parts[1] ?? ""
        const status = parts[4] ?? ""
        const name = parts[parts.length - 1] ?? ""
        return `${id} ${image} [${status}] ${name}`
      }
      return line.trim()
    })
    return result.join("\n")
  }

  // Generic docker: dedup + truncate
  return deduplicateLines(lines).join("\n")
}

/**
 * Filter grep/rg output → grouped by file, limited matches.
 */
function filterGrepOutput(output: string): string {
  const lines = output.split("\n").filter((l) => l.trim())

  // Group by file
  const byFile = new Map<string, string[]>()
  let matchCount = 0

  for (const line of lines) {
    // Format: file:line:content or file:content
    const colonIdx = line.indexOf(":")
    if (colonIdx > 0) {
      const file = line.slice(0, colonIdx)
      const rest = line.slice(colonIdx + 1)
      if (!byFile.has(file)) {
        byFile.set(file, [])
      }
      byFile.get(file)!.push(rest.trim())
      matchCount++
    }
  }

  if (byFile.size === 0) {
    return lines.slice(0, 30).join("\n") || "[no matches]"
  }

  const result: string[] = [`${matchCount} matches in ${byFile.size} files:`]
  for (const [file, matches] of byFile) {
    result.push(`\n${file}:`)
    // Limit matches per file
    const shown = matches.slice(0, 5)
    result.push(...shown.map((m) => `  ${m}`))
    if (matches.length > 5) {
      result.push(`  ... +${matches.length - 5} more`)
    }
  }

  return result.join("\n")
}

/**
 * Main bash filter dispatcher.
 */
export function filterBash(
  command: string,
  output: string,
  maxChars: number
): FilterResult {
  const originalTokens = estimateTokens(output)
  const category = detectBashCategory(command)
  const clean = stripAnsi(output)
  let filtered: string

  switch (category) {
    case "build":
      filtered = filterBuildOutput(clean)
      break
    case "docker":
      filtered = filterDockerOutput(clean, command)
      break
    case "grep":
      filtered = filterGrepOutput(clean)
      break
    default:
      // Generic: dedup + collapse + truncate
      filtered = collapseBlankLines(
        deduplicateLines(clean.split("\n")).join("\n")
      ).trim()
      break
  }

  const { text, truncated } = smartTruncate(filtered, maxChars)
  const filteredTokens = estimateTokens(text)

  return {
    output: text,
    originalTokens,
    filteredTokens,
    truncated,
  }
}
