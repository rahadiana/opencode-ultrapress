import { expect, test, describe } from "bun:test"
import { addProtectedContext, getProtectedContextString, resetCompressionState, createBlock, getAllBlocks, getEffectiveSummary } from "../src/dcp/compress-state"

describe("Layer 3 - DCP Summarization", () => {

  // ─── Legacy tests (checkNudgeRequired, buildNudgePrompt, processTurnForDCP, processCompactingHook: removed) ──

  // ─── Protected Context ───────────────────────────────────────────────────

  test("protected-context: store and retrieve by addProtectedContext", () => {
    resetCompressionState()
    addProtectedContext("session-1", "decision", "use JWT auth")
    const ctx = getProtectedContextString("session-1")
    expect(ctx).toContain("use JWT auth")
  })

  // ─── Nesting Tests ─────────────────────────────────────────────────────

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
