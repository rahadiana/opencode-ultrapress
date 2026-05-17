import { expect, test, describe } from "bun:test"
import { processTurnForDCP, processCompactingHook } from "../src/layers/layer3-dcp"
import { checkNudgeRequired, buildNudgePrompt, updateContextTokens, resetContextTokens, resetTurnCount } from "../src/dcp/context-monitor"
import { addProtectedContext, getProtectedContextString, resetCompressionState, createBlock, getAllBlocks, getEffectiveSummary } from "../src/dcp/compress-state"
import type { SummarizationConfig, SessionStats } from "../src/config/schema"

function makeConfig(overrides: Partial<SummarizationConfig> = {}): SummarizationConfig {
  return {
    enabled: true,
    mode: "range",
    maxContextLimit: 5000,
    minContextLimit: 1000,
    nudgeFrequency: 2,
    nudgeThreshold: 0.70,
    summaryBuffer: true,
    showCompression: true,
    preserveLastN: 3,
    scoreThreshold: 0,
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
    actualTokensInput: 0,
    actualTokensOutput: 0,
    actualTokensReasoning: 0,
  }
}

describe("Layer 3 - DCP Summarization", () => {
  test("context-monitor: check returns false when context below limit", () => {
    resetTurnCount(0)
    resetContextTokens(0)
    const config = makeConfig({ maxContextLimit: 5000, nudgeFrequency: 1 })
    resetContextTokens(1000)
    expect(checkNudgeRequired(config)).toBe(false)
  })

  test("context-monitor: check returns true when context exceeds limit", () => {
    resetTurnCount(0)
    resetContextTokens(0)
    const config = makeConfig({ maxContextLimit: 5000, nudgeFrequency: 1 })
    resetContextTokens(6000)
    expect(checkNudgeRequired(config)).toBe(true)
  })

  test("context-monitor: respects nudgeFrequency", () => {
    resetTurnCount(0)
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
    resetTurnCount(0)
    resetContextTokens(0)
    const config = makeConfig({ maxContextLimit: 3000, nudgeFrequency: 1 })
    resetContextTokens(3500)
    expect(checkNudgeRequired(config)).toBe(true)
  })

  test("processTurnForDCP returns nudgePrompt when conditions met", () => {
    resetTurnCount(0)
    resetContextTokens(0)
    const stats = makeStats()
    const config = makeConfig({ maxContextLimit: 100, nudgeFrequency: 1 })
    resetContextTokens(10000)
    const result = processTurnForDCP("test message", { config, stats })
    expect(result.nudgePrompt).not.toBeNull()
    expect(result.nudgePrompt).toContain("ultrapress_compress")
  })

  test("processTurnForDCP returns null nudge when disabled", () => {
    resetTurnCount(0)
    resetContextTokens(0)
    const stats = makeStats()
    const config = makeConfig({ enabled: false, maxContextLimit: 100, nudgeFrequency: 1 })
    resetContextTokens(10000)
    const result = processTurnForDCP("test message", { config, stats })
    expect(result.nudgePrompt).toBeNull()
  })

  test("protected-context: store and retrieve by addProtectedContext", () => {
    resetCompressionState()
    addProtectedContext("session-1", "decision", "use JWT auth")
    const ctx = getProtectedContextString("session-1")
    expect(ctx).toContain("use JWT auth")
  })

  test("processCompactingHook returns formatted block when context exists", () => {
    resetCompressionState()
    addProtectedContext("session-2", "file", "src/index.ts")
    const stats = makeStats()
    const config = makeConfig({ enabled: true })
    const result = processCompactingHook("session-2", { config, stats })
    expect(result).toContain("UltraPress DCP Protected Context")
    expect(result).toContain("src/index.ts")
  })

  test("processCompactingHook returns empty when disabled", () => {
    resetCompressionState()
    addProtectedContext("session-3", "key", "value")
    const stats = makeStats()
    const config = makeConfig({ enabled: false })
    const result = processCompactingHook("session-3", { config, stats })
    expect(result).toBe("")
  })

  test("nesting: creating block on top of existing block consumes the old blockId", () => {
    resetCompressionState()
    
    // First compression: range msg_003 → msg_010
    createBlock("implementation discussion", "msg_003", "msg_010", "First summary", 50,
      ["msg_004","msg_005","msg_006","msg_007","msg_008","msg_009"], [], [])
    
    expect(getAllBlocks().length).toBe(1)
    const firstBlock = getAllBlocks()[0]
    expect(firstBlock.consumedBlockIds).toEqual([])
    expect(firstBlock.topic).toBe("implementation discussion")
    
    // Second compression (nested): wider range consumes the first block
    createBlock("wider compression", "msg_001", "msg_015", "Nested summary", 80,
      [], [firstBlock.blockId], [])
    
    expect(getAllBlocks().length).toBe(2)
    const secondBlock = getAllBlocks()[1]
    expect(secondBlock.consumedBlockIds).toContain(firstBlock.blockId)
  })

  test("nesting: getEffectiveSummary merges nested block summaries", () => {
    resetCompressionState()
    
    // Block A
    const blockA = createBlock("auth setup", "msg_001", "msg_005", "Created auth middleware", 20,
      ["msg_002","msg_003","msg_004"], [], [])
    
    // Block B nests Block A
    const blockB = createBlock("full session", "msg_001", "msg_020", "Added routes and controllers", 30,
      [], [blockA.blockId], [])
    
    const effective = getEffectiveSummary(blockB.blockId)
    expect(effective).toContain("Previously compressed summary")
    expect(effective).toContain("Created auth middleware")
    expect(effective).toContain("Added routes and controllers")
  })
})
