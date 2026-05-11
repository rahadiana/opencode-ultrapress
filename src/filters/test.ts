/**
 * Test runner output filters.
 * Handles: jest, vitest, pytest, cargo test, bun test, mocha
 */

import type { FilterResult } from "../config/schema.js"
import { estimateTokens } from "../utils/token-count.js"
import { stripAnsi, smartTruncate } from "./generic.js"

export function detectTestFramework(
  command: string
): "jest" | "vitest" | "pytest" | "cargo" | "bun" | "mocha" | "generic" {
  const cmd = command.toLowerCase()

  if (cmd.includes("jest")) return "jest"
  if (cmd.includes("vitest")) return "vitest"
  if (cmd.includes("pytest") || cmd.includes("python -m pytest")) return "pytest"
  if (cmd.includes("cargo test")) return "cargo"
  if (cmd.includes("bun test")) return "bun"
  if (cmd.includes("mocha")) return "mocha"
  if (cmd.includes("npm test") || cmd.includes("npm run test")) return "jest"

  return "generic"
}

function filterJSTest(output: string): string {
  const lines = output.split("\n")
  const failures: string[] = []
  const summary: string[] = []
  let inFailure = false
  let failureBuffer: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    const lower = trimmed.toLowerCase()

    if (
      lower.includes("tests:") ||
      lower.includes("test suites:") ||
      lower.includes("time:") ||
      lower.includes("snapshots:") ||
      lower.includes("test files") ||
      (lower.includes("passed") && lower.includes("total"))
    ) {
      summary.push(trimmed)
      continue
    }

    if (
      trimmed.startsWith("✕") ||
      trimmed.startsWith("×") ||
      trimmed.startsWith("✖") ||
      trimmed.startsWith("FAIL") ||
      lower.startsWith("● ") ||
      lower.includes("failedtest") ||
      (lower.includes("error") && !lower.includes("0 error"))
    ) {
      inFailure = true
      failureBuffer.push(trimmed)
      continue
    }

    if (inFailure) {
      if (trimmed === "" || trimmed.startsWith("✓") || trimmed.startsWith("√") || trimmed.startsWith("PASS")) {
        if (failureBuffer.length > 0) {
          failures.push(failureBuffer.slice(0, 10).join("\n"))
          failureBuffer = []
        }
        inFailure = false
      } else {
        failureBuffer.push(trimmed)
      }
    }
  }

  if (failureBuffer.length > 0) {
    failures.push(failureBuffer.slice(0, 10).join("\n"))
  }

  const parts: string[] = []
  if (failures.length > 0) parts.push(`FAILURES (${failures.length}):\n${failures.join("\n\n")}`)
  if (summary.length > 0) parts.push(summary.join("\n"))

  if (parts.length === 0) return "✓ all tests passed"
  return parts.join("\n\n")
}

function filterPytest(output: string): string {
  const lines = output.split("\n")
  const failures: string[] = []
  const summary: string[] = []
  let inFailure = false
  let failureBuffer: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith("=") && (trimmed.includes("passed") || trimmed.includes("failed") || trimmed.includes("error"))) {
      summary.push(trimmed.replace(/=+/g, "").trim())
      continue
    }

    if (trimmed.startsWith("FAILED") || trimmed.startsWith("ERROR")) {
      failures.push(trimmed)
      continue
    }

    if (trimmed.startsWith("_") && trimmed.endsWith("_")) {
      if (failureBuffer.length > 0) failures.push(failureBuffer.slice(0, 10).join("\n"))
      inFailure = true
      failureBuffer = [trimmed.replace(/_+/g, "").trim()]
      continue
    }

    if (inFailure && failureBuffer.length < 10) failureBuffer.push(trimmed)
  }

  if (failureBuffer.length > 0) failures.push(failureBuffer.slice(0, 10).join("\n"))

  const parts: string[] = []
  if (failures.length > 0) parts.push(`FAILURES:\n${failures.join("\n\n")}`)
  if (summary.length > 0) parts.push(summary.join("\n"))

  return parts.length > 0 ? parts.join("\n\n") : "✓ all tests passed"
}

function filterCargoTest(output: string): string {
  const lines = output.split("\n")
  const failures: string[] = []
  const summary: string[] = []
  let inFailure = false
  let failureBuffer: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith("test result:")) {
      summary.push(trimmed)
      continue
    }

    if (trimmed.startsWith("---- ") && trimmed.endsWith(" ----")) {
      if (failureBuffer.length > 0) failures.push(failureBuffer.slice(0, 15).join("\n"))
      inFailure = true
      failureBuffer = [trimmed.replace(/----/g, "").trim()]
      continue
    }

    if (trimmed.startsWith("test ") && trimmed.includes("FAILED")) {
      failures.push(trimmed)
      continue
    }

    if (inFailure && failureBuffer.length < 15) failureBuffer.push(trimmed)
  }

  if (failureBuffer.length > 0) failures.push(failureBuffer.slice(0, 15).join("\n"))

  const parts: string[] = []
  if (failures.length > 0) parts.push(`FAILURES:\n${failures.join("\n\n")}`)
  if (summary.length > 0) parts.push(summary.join("\n"))

  return parts.length > 0 ? parts.join("\n\n") : "✓ all tests passed"
}

export function filterTest(
  command: string,
  output: string,
  maxChars: number
): FilterResult {
  const originalTokens = estimateTokens(output)
  const framework = detectTestFramework(command)
  const clean = stripAnsi(output)
  let filtered: string

  switch (framework) {
    case "jest":
    case "vitest":
    case "bun":
    case "mocha":
      filtered = filterJSTest(clean)
      break
    case "pytest":
      filtered = filterPytest(clean)
      break
    case "cargo":
      filtered = filterCargoTest(clean)
      break
    default:
      filtered = filterJSTest(clean)
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
