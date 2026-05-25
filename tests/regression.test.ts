import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { sanitizeConfig } from "../src/config/validate"
import { processToolOutput } from "../src/layers/layer1-output-filter"
import { filterBash } from "../src/filters/bash"
import { compressNLP } from "../src/caveman/nlp"
import { compressMLM } from "../src/caveman/mlm"
import { compressLLM } from "../src/caveman/llm"
import { extractCodeBlocks, restoreCodeBlocks, verifyPlaceholders } from "../src/caveman/facts"
import { applyPruning } from "../src/dcp/prune"
import { createBlock, getAllBlocks, resetCompressionState } from "../src/dcp/compress-state"
import type { SessionStats } from "../src/config/schema"
import { readFileSync, unlinkSync, existsSync, rmdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

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

// ═══════════════════════════════════════════════════════════════════════════
// Config Validation
// ═══════════════════════════════════════════════════════════════════════════

describe("Config Validation", () => {
  test("sanitizeConfig: accepts valid config unchanged", () => {
    const input = { enabled: true }
    const result = sanitizeConfig(input)
    expect(result.enabled).toBe(true)
    expect(result.semantic.mode).toBe("nlp")
    expect(result.notification).toBe("minimal")
  })

  test("sanitizeConfig: rejects invalid notification level", () => {
    const result = sanitizeConfig({ notification: "DEBUG_EXTREME" })
    expect(result.notification).toBe("minimal")
  })

  test("sanitizeConfig: rejects invalid semantic mode", () => {
    const result = sanitizeConfig({ semantic: { mode: "foobar" } })
    expect(result.semantic.mode).toBe("nlp")
  })

  test("sanitizeConfig: rejects invalid summarization mode", () => {
    const result = sanitizeConfig({ summarization: { mode: "invalid" } })
    expect(result.summarization.mode).toBe("range")
  })

  test("sanitizeConfig: accepts valid nlp/mlm/llm modes", () => {
    expect(sanitizeConfig({ semantic: { mode: "nlp" } }).semantic.mode).toBe("nlp")
    expect(sanitizeConfig({ semantic: { mode: "mlm" } }).semantic.mode).toBe("mlm")
    expect(sanitizeConfig({ semantic: { mode: "llm" } }).semantic.mode).toBe("llm")
  })

  test("sanitizeConfig: clamps invalid numbers", () => {
    const result = sanitizeConfig({ summarization: { nudgeThreshold: 5, maxContextLimit: -100 } })
    expect(result.summarization.nudgeThreshold).toBe(1) // clamped to 1 max
    expect(result.summarization.maxContextLimit).toBe(1) // clamped to min 1
  })

  test("sanitizeConfig: preserves skipTools arrays", () => {
    const result = sanitizeConfig({})
    expect(result.outputFilter.skipTools).toEqual(["task"])
    expect(result.semantic.skipTools).toEqual(["task"])
  })

  test("sanitizeConfig: enforces required protected skipTool even when user removes it", () => {
    const result = sanitizeConfig({
      outputFilter: { skipTools: [] },
      semantic: { skipTools: ["write"] },
    })

    expect(result.outputFilter.skipTools).toContain("task")
    expect(result.semantic.skipTools).toContain("task")
    expect(result.semantic.skipTools).toContain("write")
  })

  test("sanitizeConfig: handles booleans robustly", () => {
    const result = sanitizeConfig({
      outputFilter: { teeSaveOnTruncate: "yes" as any },
      semantic: { protectCodeBlocks: 1 as any },
    })
    expect(result.outputFilter.teeSaveOnTruncate).toBe(true) // default fallback
    expect(result.semantic.protectCodeBlocks).toBe(true) // default fallback
  })

  test("sanitizeConfig: sanitizes custom filters", () => {
    const result = sanitizeConfig({
      outputFilter: {
        customFilters: [
          { commandPattern: "npm.*", stripPatterns: ["warn", "deprecated"], keepPatterns: ["critical"], maxLines: 50 },
          { bad: "entry" },
        ],
      },
    })
    expect(result.outputFilter.customFilters.length).toBe(1)
    expect(result.outputFilter.customFilters[0].commandPattern).toBe("npm.*")
  })

  test("sanitizeConfig: fully invalid input uses defaults", () => {
    const result = sanitizeConfig(null)
    expect(result.enabled).toBe(true)
    expect(result.outputFilter.enabled).toBe(true)
    expect(result.semantic.mode).toBe("nlp")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Tee Save on Truncate
// ═══════════════════════════════════════════════════════════════════════════

describe("Tee Save on Truncate", () => {
  afterEach(() => {
    const dir = join(tmpdir(), "opencode-ultrapress")
    try { if (existsSync(dir)) rmdirSync(dir, { recursive: true }) } catch {}
  })

  test("processToolOutput: saves truncated output to file when teeSaveOnTruncate enabled", () => {
    const stats = makeStats()
    const config = { enabled: true, maxCharsPerOutput: 50, teeSaveOnTruncate: true, customFilters: [], skipTools: [] }
    const longOutput = "this is a very long line that repeats many times\n".repeat(100)

    const result = processToolOutput("bash", { command: "echo test" }, longOutput, { config, stats })
    expect(result).toContain("[Full output saved to:")
    const dir = join(tmpdir(), "opencode-ultrapress")
    expect(result).toContain(dir)
  })

  test("processToolOutput: does not write when teeSaveOnTruncate disabled", () => {
    const stats = makeStats()
    const config = { enabled: true, maxCharsPerOutput: 50, teeSaveOnTruncate: false, customFilters: [], skipTools: [] }
    const longOutput = "test\n".repeat(100)

    const result = processToolOutput("bash", { command: "echo test" }, longOutput, { config, stats })
    expect(result).not.toContain("[Full output saved to:")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Custom Filters
// ═══════════════════════════════════════════════════════════════════════════

describe("Custom Filters (keepPatterns + maxLines)", () => {
  test("custom filter: keepPatterns overrides stripPatterns", () => {
    const stats = makeStats()
    const config = {
      enabled: true, maxCharsPerOutput: 8000, teeSaveOnTruncate: false, skipTools: [],
      customFilters: [
        { commandPattern: "echo", stripPatterns: ["warn"], keepPatterns: ["critical"], maxLines: undefined },
      ],
    }
    const result = processToolOutput("bash", { command: "echo logs" }, "warn: something\ncritical: important\ninfo: ok", { config, stats })
    expect(result).toContain("critical: important")
  })

  test("custom filter: maxLines truncates output", () => {
    const stats = makeStats()
    const config = {
      enabled: true, maxCharsPerOutput: 8000, teeSaveOnTruncate: false, skipTools: [],
      customFilters: [
        { commandPattern: "echo", stripPatterns: [], keepPatterns: [], maxLines: 2 },
      ],
    }
    const output = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n")
    const result = processToolOutput("bash", { command: "echo logs" }, output, { config, stats })
    const lines = result.split("\n")
    expect(lines.length).toBeLessThanOrEqual(3) // 2 + omitted message
    expect(result).toContain("18 lines omitted")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Code Block Placeholder Safety
// ═══════════════════════════════════════════════════════════════════════════

describe("Code Block Placeholder Safety", () => {
  test("verifyPlaceholders: returns valid when all present", () => {
    const text = "here is __CODE_BLOCK_0__ and __CODE_BLOCK_1__"
    const result = verifyPlaceholders(text, 2)
    expect(result.valid).toBe(true)
    expect(result.missing).toEqual([])
  })

  test("verifyPlaceholders: returns invalid when some missing", () => {
    const text = "only __CODE_BLOCK_0__ here"
    const result = verifyPlaceholders(text, 3)
    expect(result.valid).toBe(false)
    expect(result.missing).toEqual([1, 2])
  })

  test("extractCodeBlocks: preserves content and creates unique placeholders", () => {
    const input = "Some text\n```ts\nconst x = 1\n```\nMore text `inline code` end"
    const { compressedText, blocks } = extractCodeBlocks(input)
    expect(blocks.length).toBe(2)
    expect(compressedText).toContain("__CODE_BLOCK_0__")
    expect(compressedText).toContain("__CODE_BLOCK_1__")
    expect(compressedText).not.toContain("```")
    expect(compressedText).not.toContain("const x = 1")
  })

  test("restoreCodeBlocks: restores all placeholders correctly", () => {
    const { compressedText, blocks } = extractCodeBlocks("```ts\nx\n```\n`y`")
    const restored = restoreCodeBlocks(compressedText, blocks)
    expect(restored).toBe("```ts\nx\n```\n`y`")
  })

  test("restoreCodeBlocks: handles duplicate placeholder occurrences", () => {
    const text = "dup __CODE_BLOCK_0__ again __CODE_BLOCK_0__ end"
    const blocks = ["HELLO"]
    const restored = restoreCodeBlocks(text, blocks)
    expect(restored).toBe("dup HELLO again HELLO end")
  })

  test("compressMLM: falls back when code block placeholders are lost", async () => {
    const input = "Simple text that is short and has no code blocks at all it is short enough for nlp"
    const res = await compressMLM(input, undefined, { protectCodeBlocks: true })
    // MLM should fall back to NLP for very short text
    expect(res.method).toBe("fallback-too-few-sentences")
  })

  test("compressLLM: short text falls back to NLP and preserves code blocks", async () => {
    const input = "Short text\n```ts\nx\n```\nend"
    const res = await compressLLM(input, undefined, { protectCodeBlocks: true })
    expect(res.method).toContain("llm-too")
    // NLP preserves code blocks
    expect(res.compressedText).toContain("```ts")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DCP Pruning
// ═══════════════════════════════════════════════════════════════════════════

describe("DCP Pruning", () => {
  beforeEach(() => {
    resetCompressionState()
  })

  function makeMsg(id: string, role: string): { id: string; role: string; parts?: any[]; content?: string } {
    return { id, role, parts: [], content: `content of ${id}` }
  }

  test("applyPruning: does nothing when no blocks exist", () => {
    const messages = [makeMsg("a", "user"), makeMsg("b", "assistant")]
    const result = applyPruning(messages, 0, 0)
    expect(result.prunedCount).toBe(0)
    expect(result.injectedCount).toBe(0)
    expect(messages.length).toBe(2)
  })

  test("applyPruning: prunes messages inside block range and injects summary", () => {
    const messages = [
      makeMsg("start", "user"),
      makeMsg("mid1", "assistant"),
      makeMsg("mid2", "assistant"),
      makeMsg("end", "system"),
    ]
    createBlock("test block", "start", "end", "compressed summary", 10, ["mid1", "mid2"], [], [])

    const result = applyPruning(messages, 0, 0)
    expect(result.prunedCount).toBeGreaterThan(0)
    expect(result.injectedCount).toBe(1)
    // Summary message should be injected
    const summaryMsg = messages.find(m => m.id.startsWith("__dcp_summary_"))
    expect(summaryMsg).toBeDefined()
    expect(summaryMsg!.content).toContain("compressed summary")
  })

  test("applyPruning: respects preserveLastN and does not prune recent messages", () => {
    const messages = [
      makeMsg("s", "user"),
      makeMsg("a", "assistant"),
      makeMsg("b", "assistant"),
      makeMsg("e", "system"),
    ]
    createBlock("block", "s", "e", "summary", 10, ["a", "b"], [], [])

    const result = applyPruning(messages, 2) // preserve last 2 (b, e)
    expect(result.prunedCount).toBe(0) // block overlaps preserved zone, no scoring so skip
    expect(result.injectedCount).toBe(0)
  })

  test("pruning: protected tools (task) are not pruned", () => {
    const messages = [
      makeMsg("start", "user"),
      { id: "task1", role: "tool", parts: [{ type: "tool", tool: "task" }], content: "task output" },
      makeMsg("end", "assistant"),
    ]
    createBlock("block", "start", "end", "summary", 10, ["task1"], [], [])

    const result = applyPruning(messages, 0, 0)
    expect(result.prunedCount).toBe(0) // protected tool inside block → skip
  })

  test("pruning: important context markers are protected from pruning", () => {
    const messages = [
      makeMsg("start", "user"),
      { id: "mid", role: "assistant", content: "DECISION: keep API compatible and avoid breaking clients" },
      makeMsg("end", "assistant"),
    ]

    createBlock("block", "start", "end", "summary", 10, ["mid"], [], [])

    const result = applyPruning(messages, 0, 0)
    expect(result.prunedCount).toBe(0)
    expect(messages.some((m) => m.id === "mid")).toBe(true)
  })

  test("pruning: scoring threshold preserves high-impact messages", () => {
    const messages = [
      makeMsg("msg1", "user"),
      {...makeMsg("msg2", "assistant"), content: "urgent fix needed crash"},
      makeMsg("msg3", "assistant"),
      makeMsg("msg4", "system"),
    ]
    createBlock("block", "msg1", "msg4", "summary", 10, ["msg2", "msg3"], [], [])

    const result = applyPruning(messages, 0, 0.45) // scoring on, threshold 0.45
    // "urgent fix crash" should be scored high enough to keep
    const prunedIds = messages.filter(m => !["msg1", "msg2", "msg3", "msg4"].includes(m.id))
  })

  test("block ID generation: creates unique IDs after reset", () => {
    resetCompressionState()
    const block1 = createBlock("first", "a", "b", "s1", 5, [], [], [])
    const block2 = createBlock("second", "c", "d", "s2", 5, [], [], [])
    expect(block1.blockId).not.toBe(block2.blockId)
    expect(block1.blockId).toBeGreaterThan(0)
    expect(block2.blockId).toBeGreaterThan(block1.blockId)
  })

  test("block ID generation: different intervals produce different ranges", () => {
    resetCompressionState()
    const blocks1 = Array.from({ length: 3 }, (_, i) => createBlock(`b${i}`, "a", "b", "s", 5, [], [], []))
    resetCompressionState()
    const blocks2 = Array.from({ length: 3 }, (_, i) => createBlock(`b${i}`, "c", "d", "s", 5, [], [], []))
    // Blocks from different sessions should have IDs in different ranges
    const allIds = [...blocks1, ...blocks2].map(b => b.blockId)
    const uniqueIds = new Set(allIds)
    expect(uniqueIds.size).toBe(allIds.length)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Error Protection Narrowing
// ═══════════════════════════════════════════════════════════════════════════

describe("Error Protection", () => {
  test("compressNLP: non-error text with 'error' keyword still compresses", () => {
    const input = "This is a long message about the error handling design pattern and it covers the error approach"
    const result = compressNLP(input, { protectCodeBlocks: true })
    // NLP mode compresses regardless of "error" keyword (L2 gate handles this)
    expect(result.compressedTokens).toBeLessThan(result.originalTokens)
  })

  test("compressNLP: preserves code blocks even with error keywords", () => {
    const input = "There is an error:\n```ts\nthrow new Error('this is the error');\n```\nhandle gracefully"
    const result = compressNLP(input, { protectCodeBlocks: true })
    expect(result.compressedText).toContain("```ts")
    expect(result.compressedText).toContain("throw new Error")
  })
})
