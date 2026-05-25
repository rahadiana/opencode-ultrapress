import { expect, test, describe } from "bun:test"
import { compressNLP } from "../src/caveman/nlp"
import { compressMLM } from "../src/caveman/mlm"
import { compressLLM } from "../src/caveman/llm"
import { processMessageContext } from "../src/layers/layer2-caveman"
import type { SemanticConfig, SessionStats } from "../src/config/schema"

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

function makeSemanticConfig(overrides: Partial<SemanticConfig> = {}): SemanticConfig {
  return {
    enabled: true,
    mode: "nlp",
    model: "Xenova/all-MiniLM-L6-v2",
    compressUserMessages: true,
    compressAssistantMessages: true,
    compressToolOutputs: true,
    protectCodeBlocks: true,
    protectErrors: true,
    minLengthChars: 0,
    skipTools: [],
    ...overrides,
  }
}

describe("Layer 2 - Caveman NLP", () => {
  test("strips grammar but preserves numbers and identifiers", () => {
    const input = "This is a test functionName that takes 500ms to run."
    const res = compressNLP(input)
    
    // "This is a" are strippable.
    // "test", "functionName", "takes", "500ms", "run" should remain.
    expect(res.compressedText).toContain("test")
    expect(res.compressedText).toContain("functionName")
    expect(res.compressedText).toContain("takes")
    expect(res.compressedText).toContain("500ms")
    expect(res.compressedText).toContain("run.")
    
    expect(res.compressedText.toLowerCase()).not.toContain("this is a ")
  })

  test("preserves code blocks entirely", () => {
    const input = "Here is some code:\n```typescript\nconst x = this.is.a.test;\n```"
    const res = compressNLP(input)
    
    expect(res.compressedText).toContain("```typescript\nconst x = this.is.a.test;\n```")
  })

  test("processMessageContext: protects error-like content when protectErrors is enabled", async () => {
    const input = [
      "Error: Failed to compile module auth-service",
      "at build (src/build.ts:42:13)",
      "at async start (src/index.ts:10:1)",
    ].join("\n")

    const res = await processMessageContext(input, "assistant", {
      config: makeSemanticConfig({ protectErrors: true }),
      stats: makeStats(),
    })

    expect(res).toBe(input)
  })

  test("processMessageContext: protects Java/Python style stack traces", async () => {
    const input = [
      "UnhandledPromiseRejectionWarning: TypeError: Cannot read properties of undefined",
      "Caused by: java.lang.IllegalStateException: bad state",
      "File \"app.py\", line 42, in handler",
      "at com.example.Service.run(Service.java:55)",
    ].join("\n")

    const res = await processMessageContext(input, "assistant", {
      config: makeSemanticConfig({ protectErrors: true }),
      stats: makeStats(),
    })

    expect(res).toBe(input)
  })

  test("processMessageContext: allows compression of error-like content when protectErrors is disabled", async () => {
    const input = "This is an error in the build pipeline and it is failing because it is not configured correctly and it is causing repeated failures in production."

    const protectedRes = await processMessageContext(input, "assistant", {
      config: makeSemanticConfig({ protectErrors: true }),
      stats: makeStats(),
    })

    const unprotectedRes = await processMessageContext(input, "assistant", {
      config: makeSemanticConfig({ protectErrors: false }),
      stats: makeStats(),
    })

    expect(protectedRes).toBe(input)
    expect(unprotectedRes).toBe(compressNLP(input, { protectCodeBlocks: true }).compressedText)
    expect(unprotectedRes).not.toBe(protectedRes)
  })

  test("compressMLM fallback respects protectCodeBlocks option", async () => {
    const input = "Verbose intro text that is very repetitive and it is not concise.\n```ts\nthis is a code line and it is very verbose\n```"

    const res = await compressMLM(input, undefined, { protectCodeBlocks: false })
    const expected = compressNLP(input, { protectCodeBlocks: false }).compressedText

    expect(res.compressedText).toBe(expected)
    expect(res.compressedText).not.toContain("this is a code line and it is very verbose")
  })

  test("compressLLM short-text fallback respects protectCodeBlocks option", async () => {
    const input = "Verbose intro text that is very repetitive and it is not concise.\n```ts\nthis is a code line and it is very verbose\n```"

    const res = await compressLLM(input, undefined, { protectCodeBlocks: false })
    const expected = compressNLP(input, { protectCodeBlocks: false }).compressedText

    expect(res.compressedText).toBe(expected)
    expect(res.compressedText).not.toContain("this is a code line and it is very verbose")
  })
})
