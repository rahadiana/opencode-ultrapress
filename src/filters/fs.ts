/**
 * Filesystem command filters.
 * Handles: ls, find, cat, read, tree
 */

import type { FilterResult } from "../config/schema.js"
import { estimateTokens } from "../utils/token-count.js"
import { stripAnsi, smartTruncate } from "./generic.js"

export function detectFsCommand(
  command: string
): "ls" | "find" | "tree" | "cat" | "generic" {
  const cmd = command.trim().toLowerCase()
  if (cmd.startsWith("ls ")) return "ls"
  if (cmd.startsWith("find ")) return "find"
  if (cmd.startsWith("tree") || cmd.startsWith("exa -T") || cmd.startsWith("eza -T") || cmd.startsWith("ls -R")) return "tree"
  if (cmd.startsWith("cat ") || cmd.startsWith("head ") || cmd.startsWith("tail ")) return "cat"
  return "generic"
}

function filterLsOutput(output: string): string {
  const lines = output.split("\n").filter((l) => l.trim())
  if (lines.length === 0) return "[empty]"
  
  // Just collapse multiple spaces if it's columnar output
  return lines.map(l => l.replace(/\s{2,}/g, "  ")).join("\n")
}

function filterFindOutput(output: string): string {
  const lines = output.split("\n").filter((l) => l.trim())
  if (lines.length === 0) return "[no files found]"
  
  const dirs = new Map<string, string[]>()
  for (const line of lines) {
    const lastSlash = line.lastIndexOf("/")
    if (lastSlash === -1) {
      if (!dirs.has(".")) dirs.set(".", [])
      dirs.get(".")!.push(line)
    } else {
      const dir = line.substring(0, lastSlash)
      const file = line.substring(lastSlash + 1)
      if (!dirs.has(dir)) dirs.set(dir, [])
      dirs.get(dir)!.push(file)
    }
  }

  const result: string[] = []
  let count = 0
  for (const [dir, files] of dirs) {
    result.push(`${dir}/`)
    const shownFiles = files.slice(0, 10)
    result.push(...shownFiles.map(f => `  ${f}`))
    if (files.length > 10) {
      result.push(`  ... +${files.length - 10} more`)
    }
    count += files.length
  }

  return `[${count} files found]\n` + result.join("\n")
}

function filterCatOutput(output: string, maxChars: number): string {
  // Cat outputs should just use the smart truncate
  // But we can also collapse multiple blank lines
  const text = output.replace(/\n{3,}/g, "\n\n")
  return smartTruncate(text, maxChars).text
}

function filterTreeOutput(output: string): string {
  const lines = output.split("\n")
  const result: string[] = []
  
  for (const line of lines) {
    // Keep directories and a few files per dir, roughly. 
    // Tree output is tricky to parse perfectly without a full parser,
    // so we just limit the depth/lines if it gets too long, 
    // relying on the final truncate.
    result.push(line)
  }
  
  return result.join("\n")
}

export function filterFs(
  command: string,
  output: string,
  maxChars: number
): FilterResult {
  const originalTokens = estimateTokens(output)
  const category = detectFsCommand(command)
  const clean = stripAnsi(output)
  let filtered: string

  switch (category) {
    case "ls":
      filtered = filterLsOutput(clean)
      break
    case "find":
      filtered = filterFindOutput(clean)
      break
    case "tree":
      filtered = filterTreeOutput(clean)
      break
    case "cat":
      filtered = filterCatOutput(clean, maxChars)
      break
    default:
      filtered = clean
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
