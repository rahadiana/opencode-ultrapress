import { expect, test, describe } from "bun:test"
import { processTurnForDCP, processCompactingHook } from "../src/layers/layer3-dcp"
import { checkNudgeRequired, buildNudgePrompt, updateContextTokens, resetContextTokens } from "../src/dcp/context-monitor"
import { storeSummary, addProtectedContext, getProtectedContextString, clearSummaryStore } from "../src/dcp/summary-store"
import type { SummarizationConfig, SessionStats } from "../src/config/schema"

function makeConfig(overrides: Partial<SummarizationConfig> = {}): SummarizationConfig {
  return {
    enabled: true,
    mode: "range",
    maxContextLimit: 5000,
    minContextLimit: 1000,
    nudgeFrequency: 2,
    summaryBuffer: true,
    showCompression: true,
    ...overrides,
  }
}

function makeStats(): SessionStats {
  return {
    totalTokensRaw: 0,
    totalTokensCompressed: 0,
    savedByLayer: { outputFilter: 0, semantic: 0, summarization: 0, cleanup: 0 },
    compressionCount: 0,
    deduplicationCount: 0,
    errorPurgeCount: 0,
    startTime: Date.now(),
  }
}

describe("Layer 3 - DCP Summarization", () => {
  test("context-monitor: check returns false when context below limit", () => {
    resetContextTokens(0)
    const config = makeConfig({ maxContextLimit: 5000, nudgeFrequency: 1 })
    resetContextTokens(1000)
    expect(checkNudgeRequired(config)).toBe(false)
  })

  test("context-monitor: check returns true when context exceeds limit", () => {
    resetContextTokens(0)
    const config = makeConfig({ maxContextLimit: 5000, nudgeFrequency: 1 })
    resetContextTokens(6000)
    expect(checkNudgeRequired(config)).toBe(true)
  })

  test("context-monitor: respects nudgeFrequency", () => {
    resetContextTokens(0)
    const config = makeConfig({ maxContextLimit: 1000, nudgeFrequency: 3 })
    resetContextTokens(5000)
    
    expect(checkNudgeRequired(config)).toBe(false)
    expect(checkNudgeRequired(config)).toBe(false)
    expect(checkNudgeRequired(config)).toBe(true)
  })

  test("buildNudgePrompt includes config values and tool name", () => {
    const config = makeConfig({ maxContextLimit: 5000 })
    const prompt = buildNudgePrompt(config)
    expect(prompt).toContain("5000")
    expect(prompt).toContain("ultrapress_compress")
  })

  test("updateContextTokens accumulates correctly", () => {
    resetContextTokens(0)
    const config = makeConfig({ maxContextLimit: 3000, nudgeFrequency: 1 })
    resetContextTokens(3500)
    expect(checkNudgeRequired(config)).toBe(true)
  })

  test("processTurnForDCP returns nudgePrompt when conditions met", () => {
    resetContextTokens(0)
    const stats = makeStats()
    const config = makeConfig({ maxContextLimit: 100, nudgeFrequency: 1 })
    resetContextTokens(10000)
    const result = processTurnForDCP("test message", { config, stats })
    expect(result.nudgePrompt).not.toBeNull()
    expect(result.nudgePrompt).toContain("ultrapress_compress")
  })

  test("processTurnForDCP returns null nudge when disabled", () => {
    resetContextTokens(0)
    const stats = makeStats()
    const config = makeConfig({ enabled: false, maxContextLimit: 100, nudgeFrequency: 1 })
    resetContextTokens(10000)
    const result = processTurnForDCP("test message", { config, stats })
    expect(result.nudgePrompt).toBeNull()
  })

  test("summary-store: store and retrieve by addProtectedContext", () => {
    clearSummaryStore()
    addProtectedContext("session-1", "decision", "use JWT auth")
    const ctx = getProtectedContextString("session-1")
    expect(ctx).toContain("use JWT auth")
  })

  test("processCompactingHook returns formatted block when context exists", () => {
    clearSummaryStore()
    addProtectedContext("session-2", "file", "src/index.ts")
    const stats = makeStats()
    const config = makeConfig({ enabled: true })
    const result = processCompactingHook("session-2", { config, stats })
    expect(result).toContain("UltraPress DCP Protected Context")
    expect(result).toContain("src/index.ts")
  })

  test("processCompactingHook returns empty when disabled", () => {
    clearSummaryStore()
    addProtectedContext("session-3", "key", "value")
    const stats = makeStats()
    const config = makeConfig({ enabled: false })
    const result = processCompactingHook("session-3", { config, stats })
    expect(result).toBe("")
  })
})
