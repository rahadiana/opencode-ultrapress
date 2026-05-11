/**
 * Git command output filters.
 * Handles: git status, git diff, git log, git add/commit/push
 */

import type { FilterResult } from "../config/schema.js"
import { estimateTokens } from "../utils/token-count.js"
import { stripAnsi, smartTruncate } from "./generic.js"

/**
 * Detect git subcommand from the command string.
 */
export function detectGitCommand(
  command: string
): "status" | "diff" | "log" | "add" | "commit" | "push" | "pull" | "other" {
  const parts = command.trim().split(/\s+/)
  const gitIdx = parts.findIndex((p) => p === "git")
  if (gitIdx === -1) return "other"

  const subCmd = parts[gitIdx + 1]
  switch (subCmd) {
    case "status":
      return "status"
    case "diff":
      return "diff"
    case "log":
      return "log"
    case "add":
      return "add"
    case "commit":
      return "commit"
    case "push":
      return "push"
    case "pull":
      return "pull"
    default:
      return "other"
  }
}

/**
 * Filter `git status` output → compact changed files list.
 */
function filterGitStatus(output: string): string {
  const lines = output.split("\n")
  const changes: string[] = []
  let branch = ""

  for (const line of lines) {
    const trimmed = line.trim()

    // Branch info
    if (trimmed.startsWith("On branch ")) {
      branch = trimmed.replace("On branch ", "").trim()
      continue
    }

    // Modified/added/deleted files
    const fileMatch = trimmed.match(
      /^(modified|new file|deleted|renamed|both modified|untracked):\s+(.+)/
    )
    if (fileMatch) {
      const [, status, file] = fileMatch
      const shortStatus =
        status === "modified"
          ? "M"
          : status === "new file"
            ? "A"
            : status === "deleted"
              ? "D"
              : status === "renamed"
                ? "R"
                : status === "both modified"
                  ? "U"
                  : "?"
      changes.push(`  ${shortStatus} ${file}`)
      continue
    }

    // Short format (M, A, D, ??, etc.)
    const shortMatch = trimmed.match(/^([MADRCU?!]{1,2})\s+(.+)/)
    if (shortMatch) {
      changes.push(`  ${shortMatch[1]} ${shortMatch[2]}`)
    }
  }

  if (changes.length === 0) {
    return branch ? `[${branch}] clean` : "clean"
  }

  const header = branch ? `[${branch}] ${changes.length} files changed:` : `${changes.length} files changed:`
  return `${header}\n${changes.join("\n")}`
}

/**
 * Filter `git diff` output → headers + changed lines only.
 */
function filterGitDiff(output: string): string {
  const lines = output.split("\n")
  const result: string[] = []
  let currentFile = ""

  for (const line of lines) {
    // File header
    if (line.startsWith("diff --git")) {
      const match = line.match(/b\/(.+)$/)
      currentFile = match ? match[1] : ""
      result.push(`\n--- ${currentFile} ---`)
      continue
    }

    // Hunk header (line numbers)
    if (line.startsWith("@@")) {
      const hunkMatch = line.match(/@@ .+ @@(.*)/)
      const context = hunkMatch?.[1]?.trim() || ""
      result.push(context ? `@@ ${context}` : "@@")
      continue
    }

    // Changed lines only (skip context lines)
    if (line.startsWith("+") && !line.startsWith("+++")) {
      result.push(line)
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      result.push(line)
    }
    // Skip context lines (no prefix) to save tokens
  }

  return result.join("\n").trim() || "[no diff]"
}

/**
 * Filter `git log` output → one-liner per commit.
 */
function filterGitLog(output: string): string {
  const lines = output.split("\n")
  const commits: string[] = []
  let currentHash = ""
  let currentMsg = ""

  for (const line of lines) {
    const commitMatch = line.match(/^commit\s+([a-f0-9]+)/)
    if (commitMatch) {
      if (currentHash) {
        commits.push(`${currentHash.slice(0, 7)} ${currentMsg}`)
      }
      currentHash = commitMatch[1]
      currentMsg = ""
      continue
    }

    // Message line (after empty line in standard git log)
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith("Author:") && !trimmed.startsWith("Date:") && !trimmed.startsWith("Merge:")) {
      if (!currentMsg) currentMsg = trimmed
    }
  }

  // Don't forget last commit
  if (currentHash) {
    commits.push(`${currentHash.slice(0, 7)} ${currentMsg}`)
  }

  // If it's already oneline format, just pass through with trimming
  if (commits.length === 0) {
    return lines
      .filter((l) => l.trim())
      .slice(0, 30)
      .join("\n")
  }

  return commits.slice(0, 30).join("\n") || "[no commits]"
}

/**
 * Filter git add/commit/push → collapse to minimal confirmation.
 */
function filterGitAction(output: string, command: string): string {
  const clean = stripAnsi(output).trim()

  // git commit → extract SHA and message
  const commitMatch = clean.match(/\[[\w/.-]+\s+([a-f0-9]+)\]\s+(.+)/)
  if (commitMatch) {
    return `ok ${commitMatch[1].slice(0, 7)}: ${commitMatch[2]}`
  }

  // git push → extract branch info
  const pushMatch = clean.match(/(\S+)\s+->\s+(\S+)/)
  if (pushMatch) {
    return `ok pushed ${pushMatch[1]} → ${pushMatch[2]}`
  }

  // Fallback: first meaningful line
  const firstLine = clean.split("\n").find((l) => l.trim())
  return firstLine ? `ok: ${firstLine.slice(0, 100)}` : `ok: ${command}`
}

/**
 * Main git filter dispatcher.
 */
export function filterGit(
  command: string,
  output: string,
  maxChars: number
): FilterResult {
  const originalTokens = estimateTokens(output)
  const subCmd = detectGitCommand(command)
  let filtered: string

  const clean = stripAnsi(output)

  switch (subCmd) {
    case "status":
      filtered = filterGitStatus(clean)
      break
    case "diff":
      filtered = filterGitDiff(clean)
      break
    case "log":
      filtered = filterGitLog(clean)
      break
    case "add":
    case "commit":
    case "push":
    case "pull":
      filtered = filterGitAction(clean, command)
      break
    default:
      filtered = clean
  }

  // Final truncation safety net
  const { text, truncated } = smartTruncate(filtered, maxChars)
  const filteredTokens = estimateTokens(text)

  return {
    output: text,
    originalTokens,
    filteredTokens,
    truncated,
  }
}
