import { expect, test, describe, beforeEach } from "bun:test"
import type { CleanupConfig, SessionStats } from "../src/config/schema"
import { applyCleanup, handleTurnTick } from "../src/layers/layer4-cleanup"
import { deduplicateToolOutput, clearDedupCache, hashToolCall } from "../src/cleanup/dedup"
import { registerToolResult, incrementTurnAndGetPurgeable } from "../src/cleanup/purge-errors"

function makeConfig(overrides: Partial<CleanupConfig> = {}): CleanupConfig {
  return {
    deduplication: { enabled: true },
    purgeErrors: { enabled: true, turns: 4 },
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

// ═══════════════════════════════════════════════════════════════════════════
// Dedup
// ═══════════════════════════════════════════════════════════════════════════

describe("L4 — Dedup", () => {
  beforeEach(() => {
    clearDedupCache()
  })

  test("hashToolCall: deterministic for same tool+args", () => {
    const h1 = hashToolCall("bash", { command: "npm test" })
    const h2 = hashToolCall("bash", { command: "npm test" })
    expect(h1).toBe(h2)
  })

  test("hashToolCall: different for different args", () => {
    const h1 = hashToolCall("bash", { command: "npm test" })
    const h2 = hashToolCall("bash", { command: "npm run build" })
    expect(h1).not.toBe(h2)
  })

  test("first call is not duplicate", () => {
    const res = deduplicateToolOutput("bash", { command: "npm test" }, "error: failed", "msg_001")
    expect(res.isDuplicate).toBe(false)
    expect(res.output).toBe("error: failed")
  })

  test("second identical call is duplicate", () => {
    deduplicateToolOutput("bash", { command: "npm test" }, "error: failed", "msg_001")
    const res = deduplicateToolOutput("bash", { command: "npm test" }, "error: failed", "msg_002")
    expect(res.isDuplicate).toBe(true)
    expect(res.output).toContain("[Duplicate output")
  })

  test("only dedup safe/read-only tools", () => {
    const res = deduplicateToolOutput("write", { path: "/tmp/test" }, "wrote file", "msg_001")
    expect(res.isDuplicate).toBe(false) // 'write' not in safe list
  })

  test("mutable bash commands (git commit) are NOT deduped", () => {
    const res1 = deduplicateToolOutput("bash", { command: "git commit -m 'fix'" }, "committed", "msg_001")
    expect(res1.isDuplicate).toBe(false)
    const res2 = deduplicateToolOutput("bash", { command: "git commit -m 'fix'" }, "committed", "msg_002")
    expect(res2.isDuplicate).toBe(false) // must not dedup mutable commands
  })

  test("read-only bash commands (npm test) ARE deduped", () => {
    deduplicateToolOutput("bash", { command: "npm test" }, "test output", "msg_001")
    const res = deduplicateToolOutput("bash", { command: "npm test" }, "test output", "msg_002")
    expect(res.isDuplicate).toBe(true)
  })

  test("third call is also deduped (persists beyond first duplicate)", () => {
    deduplicateToolOutput("bash", { command: "npm test" }, "test output", "msg_001")
    deduplicateToolOutput("bash", { command: "npm test" }, "test output", "msg_002")
    const res = deduplicateToolOutput("bash", { command: "npm test" }, "test output", "msg_003")
    expect(res.isDuplicate).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Error Purging
// ═══════════════════════════════════════════════════════════════════════════

describe("L4 — Error Purging", () => {
  test("registerToolResult stores error state", () => {
    const purged = incrementTurnAndGetPurgeable(4)
    expect(purged).toEqual([]) // fresh state
  })

  test("error purged after threshold turns", () => {
    registerToolResult("err_001", true)

    let purged: string[] = []
    for (let i = 0; i < 4; i++) {
      const result = incrementTurnAndGetPurgeable(4)
      if (result.length > 0) purged = result
    }
    expect(purged).toContain("err_001")
    expect(purged.length).toBe(1)
  })

  test("non-error messages are not purged", () => {
    registerToolResult("non_err_001", false)

    for (let i = 0; i < 5; i++) {
      incrementTurnAndGetPurgeable(4)
    }

    // Should NOT purge non-errors
    const results = incrementTurnAndGetPurgeable(4)
    expect(results).not.toContain("non_err_001")
  })

  test("errors with different thresholds purge at different times", () => {
    registerToolResult("err_fast", true) // threshold=2

    // Turns 1-2 with threshold=2
    incrementTurnAndGetPurgeable(2) // turn 1
    let purged = incrementTurnAndGetPurgeable(2) // turn 2 → err_fast purged
    expect(purged).toContain("err_fast")
    expect(purged.length).toBe(1)

    // Register err_slow AFTER err_fast is already purged
    registerToolResult("err_slow", true) // threshold=5

    // Turns 3-7 with threshold=5
    incrementTurnAndGetPurgeable(5)
    incrementTurnAndGetPurgeable(5)
    incrementTurnAndGetPurgeable(5)
    incrementTurnAndGetPurgeable(5)

    purged = incrementTurnAndGetPurgeable(5) // turn 7 → err_slow at turn 5 → purge
    expect(purged).toContain("err_slow")
    expect(purged.length).toBe(1)
  })

  test("multiple errors purge together", () => {
    for (let i = 0; i < 5; i++) {
      registerToolResult(`err_${i}`, true)
    }

    let totalPurged = 0
    for (let i = 0; i < 5; i++) {
      const result = incrementTurnAndGetPurgeable(4)
      totalPurged += result.length
    }

    expect(totalPurged).toBe(5) // all 5 errors purged by turn 4
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Layer 4 Integration
// ═══════════════════════════════════════════════════════════════════════════

describe("L4 — applyCleanup integration", () => {
  beforeEach(() => {
    clearDedupCache()
  })

  test("applyCleanup: passes through non-duplicate output", () => {
    const stats = makeStats()
    const config = makeConfig()
    const output = applyCleanup("bash", { command: "npm test" }, "test output", false, "msg_001", { config, stats })
    expect(output).toBe("test output")
    expect(stats.deduplicationCount).toBe(0)
  })

  test("applyCleanup: dedup increments counter", () => {
    const stats = makeStats()
    const config = makeConfig()
    applyCleanup("bash", { command: "npm test" }, "test output", false, "msg_001", { config, stats })
    applyCleanup("bash", { command: "npm test" }, "test output", false, "msg_002", { config, stats })
    expect(stats.deduplicationCount).toBe(1)
  })

  test("applyCleanup: dedup disabled", () => {
    const stats = makeStats()
    const config = makeConfig({ deduplication: { enabled: false } })
    applyCleanup("bash", { command: "npm test" }, "test output", false, "msg_001", { config, stats })
    const output = applyCleanup("bash", { command: "npm test" }, "test output", false, "msg_002", { config, stats })
    expect(output).toBe("test output") // no dedup replacement
    expect(stats.deduplicationCount).toBe(0)
  })

  test("applyCleanup: error output skips dedup but registers for purge", () => {
    const config = makeConfig()
    const stats = makeStats()
    applyCleanup("bash", { command: "npm test" }, "error output", true, "err_001", { config, stats })

    // First: call with error → no dedup
    const output = applyCleanup("bash", { command: "npm test" }, "error output again", true, "err_002", { config, stats })
    expect(output).toBe("error output again") // no dedup because isError=true
    expect(stats.deduplicationCount).toBe(0)
  })

  test("handleTurnTick: purges and updates stats", () => {
    const stats = makeStats()
    const config = makeConfig({ purgeErrors: { enabled: true, turns: 2 } })

    registerToolResult("err_001", true)
    registerToolResult("err_002", true)

    handleTurnTick({ config, stats }) // turn 1
    handleTurnTick({ config, stats }) // turn 2 → purge

    expect(stats.errorPurgeCount).toBe(2)
  })

  test("handleTurnTick: purge disabled", () => {
    const stats = makeStats()
    const config = makeConfig({ purgeErrors: { enabled: false, turns: 2 } })
    registerToolResult("err_001", true)

    const ids = handleTurnTick({ config, stats })
    expect(ids).toEqual([])
    expect(stats.errorPurgeCount).toBe(0)
  })
})
