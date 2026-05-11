import { expect, test, describe } from "bun:test"
import { filterBash } from "../src/filters/bash"

describe("Layer 1 - Bash Filter", () => {
  test("truncates and dedups generic output", () => {
    const raw = "hello\nworld\nworld\nworld\ntest"
    const res = filterBash("echo test", raw, 1000)
    expect(res.output).toContain("hello")
    expect(res.output).toContain("world [×3]")
    expect(res.output).toContain("test")
  })

  test("filters build output to only show errors and status", () => {
    const raw = "compiling src/a.ts\ncompiling src/b.ts\nerror TS2322: Type 'number' is not assignable to type 'string'.\nbuild completed"
    const res = filterBash("npm run build", raw, 1000)
    expect(res.output).not.toContain("compiling src/a.ts")
    expect(res.output).toContain("error TS2322")
    expect(res.output).toContain("build completed")
  })
})
