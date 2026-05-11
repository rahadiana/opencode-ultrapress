import { expect, test, describe } from "bun:test"
import { compressNLP } from "../src/caveman/nlp"

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
})
