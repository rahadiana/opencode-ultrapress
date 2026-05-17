import { expect, test, describe } from "bun:test"
import { filterGit, detectGitCommand } from "../src/filters/git"
import { filterTest, detectTestFramework } from "../src/filters/test"
import { filterFs, detectFsCommand } from "../src/filters/fs"
import { filterBash, detectBashCategory } from "../src/filters/bash"

// ═══════════════════════════════════════════════════════════════════════════
// Git Filter
// ═══════════════════════════════════════════════════════════════════════════

describe("L1 — Git Filter", () => {
  test("detectGitCommand: status", () => {
    expect(detectGitCommand("git status")).toBe("status")
  })
  test("detectGitCommand: diff", () => {
    expect(detectGitCommand("git diff")).toBe("diff")
  })
  test("detectGitCommand: log", () => {
    expect(detectGitCommand("git log --oneline -5")).toBe("log")
  })
  test("detectGitCommand: commit", () => {
    expect(detectGitCommand("git commit -m 'fix'")).toBe("commit")
  })
  test("detectGitCommand: push", () => {
    expect(detectGitCommand("git push origin main")).toBe("push")
  })
  test("detectGitCommand: other for random command", () => {
    expect(detectGitCommand("echo hello")).toBe("other")
  })

  test("filterGitStatus: single modified file", () => {
    const output = "On branch main\nChanges not staged for commit:\n  modified:   src/index.ts"
    const res = filterGit("git status", output, 8000)
    expect(res.output).toContain("[main]")
    expect(res.output).toContain("M src/index.ts")
  })

  test("filterGitStatus: multiple file types", () => {
    const output = [
      "On branch feat/auth",
      "Changes to be committed:",
      '  modified:   src/auth.ts',
      '  new file:   src/middleware.ts',
      '  deleted:    src/old.ts',
    ].join("\n")
    const res = filterGit("git status", output, 8000)
    expect(res.output).toContain("[feat/auth]")
    expect(res.output).toContain("M src/auth.ts")
    expect(res.output).toContain("A src/middleware.ts")
    expect(res.output).toContain("D src/old.ts")
  })

  test("filterGitStatus: clean repo", () => {
    const output = "On branch main\nnothing to commit, working tree clean"
    const res = filterGit("git status", output, 8000)
    expect(res.output).toBe("[main] clean")
  })

  test("filterGitDiff: only keeps changed lines with @@ headers", () => {
    const output = [
      "diff --git a/src/index.ts b/src/index.ts",
      "index abc..def 100644",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -10,6 +10,8 @@ import { foo } from './bar'",
      " const x = 1",
      "+const y = 2",
      "+const z = 3",
      " const a = 4",
      "",
      "@@ -20,1 +22,2 @@ export function hello()",
      "-const old = 'deleted'",
      "+const updated = 'added'",
    ].join("\n")
    const res = filterGit("git diff", output, 8000)
    expect(res.output).toContain("--- src/index.ts ---")
    expect(res.output).not.toContain("const x = 1") // context line removed
    expect(res.output).not.toContain("const a = 4") // context line removed
    expect(res.output).toContain("+const y = 2") // added line kept
    expect(res.output).toContain("-const old = 'deleted'") // deleted line kept
    expect(res.output).toContain("@@ import { foo } from './bar'") // hunk context retained
  })

  test("filterGitDiff: empty diff", () => {
    const res = filterGit("git diff", "", 8000)
    expect(res.output).toBe("[no diff]")
  })

  test("filterGitLog: parses commit messages", () => {
    const output = [
      "commit abc123def456",
      "Author: user",
      "Date:   Mon Jan 1",
      "",
      "    Add new feature",
      "",
      "commit 789012abcdef",
      "Author: user",
      "Date:   Mon Jan 2",
      "    Fix bug in auth",
    ].join("\n")
    const res = filterGit("git log", output, 8000)
    expect(res.output).toContain("abc123d")
    expect(res.output).toContain("Add new feature")
    expect(res.output).toContain("789012a")
    expect(res.output).toContain("Fix bug in auth")
  })

  test("filterGitAction: extracts commit SHA", () => {
    const output = "[main abc123d] Add amazing feature\n 3 files changed, 45 insertions(+)"
    const res = filterGit("git commit -m 'Add amazing feature'", output, 8000)
    expect(res.output).toBe("ok abc123d: Add amazing feature")
  })

  test("filterGitAction: extracts push info", () => {
    const output = "To github.com:user/repo.git\n   abc123d..def456d  main -> main"
    const res = filterGit("git push origin main", output, 8000)
    expect(res.output).toContain("ok pushed")
    expect(res.output).toContain("main → main")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Test Runner Filter (jest, vitest, pytest, cargo)
// ═══════════════════════════════════════════════════════════════════════════

describe("L1 — Test Filter", () => {
  test("detectTestFramework: jest", () => {
    expect(detectTestFramework("jest")).toBe("jest")
  })
  test("detectTestFramework: vitest", () => {
    expect(detectTestFramework("vitest run")).toBe("vitest")
  })
  test("detectTestFramework: pytest", () => {
    expect(detectTestFramework("pytest tests/")).toBe("pytest")
  })
  test("detectTestFramework: cargo", () => {
    expect(detectTestFramework("cargo test")).toBe("cargo")
  })
  test("detectTestFramework: bun", () => {
    expect(detectTestFramework("bun test")).toBe("bun")
  })

  test("filterJSTest: all passed shows summary", () => {
    const output = "✓ should work (2ms)\n✓ should also work (1ms)\n\nTest Suites: 2 passed, 2 total\nTests:       5 passed, 5 total\nTime:        0.5s"
    const res = filterTest("npm test", output, 8000)
    expect(res.output).toContain("Test Suites: 2 passed")
    expect(res.output).toContain("5 passed")
    expect(res.output).not.toContain("FAILURES")
  })

  test("filterJSTest: shows failures and summary", () => {
    const output = [
      "✕ should return 200 (50ms)",
      "  expect(200).toBe(404)",
      "  - Expected: 404",
      "  + Received: 200",
      "",
      "✓ should handle errors (2ms)",
      "",
      "Test Suites: 1 failed, 1 passed, 2 total",
      "Tests:       1 failed, 4 passed, 5 total",
    ].join("\n")
    const res = filterTest("jest", output, 8000)
    expect(res.output).toContain("FAILURES")
    expect(res.output).toContain("should return 200")
    expect(res.output).toContain("Test Suites")
    expect(res.output).toContain("1 failed")
  })

  test("filterPytest: all passed shows summary", () => {
    const output = "collected 5 items\n\ntests/test_api.py ......\n\n====================== 5 passed in 0.32s ======================"
    const res = filterTest("pytest", output, 8000)
    expect(res.output).toContain("5 passed")
  })

  test("filterPytest: shows FAILED lines", () => {
    const output = [
      "_____________________________ test_login _____________________________",
      "    def test_login():",
      ">       assert authenticate('admin', 'wrong')",
      "E       AssertionError: Expected True, got False",
      "",
      "test_auth.py:23: AssertionError",
      "====================== short test summary info ======================",
      "FAILED test_auth.py::test_login - AssertionError",
      "================= 1 failed, 4 passed in 1.5s =================",
    ].join("\n")
    const res = filterTest("pytest", output, 8000)
    expect(res.output).toContain("FAILURES")
    expect(res.output).toContain("test_login")
    expect(res.output).toContain("1 failed")
  })

  test("filterCargoTest: shows failures and summary", () => {
    // Use a raw string to avoid quote escaping issues
    const output = [
      "running 3 tests",
      "test test_parse ... FAILED",
      "test test_format ... ok",
      "",
      "---- test_parse stdout ----",
      `thread 'test_parse' panicked at src/parser.rs:42:`,
      `assertion 'left == right' failed:`,
      '  left: "GET"',
      ' right: "POST"',
      "",
      "test result: FAILED. 1 passed; 1 failed; 0 ignored",
    ].join("\n")
    const res = filterTest("cargo test", output, 8000)
    expect(res.output).toContain("FAILURES")
    expect(res.output).toContain("test_parse")
    expect(res.output).toContain("test result: FAILED")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Filesystem Filter
// ═══════════════════════════════════════════════════════════════════════════

describe("L1 — FS Filter", () => {
  test("detectFsCommand: ls", () => {
    expect(detectFsCommand("ls -la src/")).toBe("ls")
  })
  test("detectFsCommand: find", () => {
    expect(detectFsCommand("find src -name '*.ts'")).toBe("find")
  })
  test("detectFsCommand: cat", () => {
    expect(detectFsCommand("cat README.md")).toBe("cat")
  })
  test("detectFsCommand: tree", () => {
    expect(detectFsCommand("tree")).toBe("tree")
  })
  test("detectFsCommand: generic", () => {
    expect(detectFsCommand("which node")).toBe("generic")
  })

  test("filterFs: ls output is collapsed", () => {
    const output = "src/\n  index.ts\n  utils/\ntests/"
    const res = filterFs("ls -R", output, 8000)
    expect(res.output).toBeDefined()
  })

  test("filterFs: find groups by directory", () => {
    const output = "src/index.ts\nsrc/utils/helper.ts\ntests/api.test.ts"
    const res = filterFs("find src -name '*.ts'", output, 8000)
    expect(res.output).toContain("3 files found")
    expect(res.output).toContain("src/")
    expect(res.output).toContain("tests/")
  })

  test("filterFs: find returns [no files found] for empty", () => {
    const res = filterFs("find . -name '*.xyz'", "", 8000)
    expect(res.output).toContain("[no files found]")
  })

  test("filterFs: cat output is truncated if too long", () => {
    const longContent = "line1\n".repeat(2000)
    const res = filterFs("cat bigfile.txt", longContent, 500)
    expect(res.output.length).toBeLessThan(longContent.length)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Bash Filter (building on existing tests)
// ═══════════════════════════════════════════════════════════════════════════

describe("L1 — Bash Filter", () => {
  test("detectBashCategory: build", () => {
    expect(detectBashCategory("npm run build")).toBe("build")
    expect(detectBashCategory("cargo build --release")).toBe("build")
    expect(detectBashCategory("tsc --noEmit")).toBe("build")
  })
  test("detectBashCategory: docker", () => {
    expect(detectBashCategory("docker ps")).toBe("docker")
    expect(detectBashCategory("docker-compose up")).toBe("docker")
  })
  test("detectBashCategory: grep", () => {
    expect(detectBashCategory("grep -r 'foo' src/")).toBe("grep")
    expect(detectBashCategory("rg 'pattern'")).toBe("grep")
  })
  test("detectBashCategory: generic for random command", () => {
    expect(detectBashCategory("echo hello")).toBe("generic")
  })

  test("filterBash build: only errors and status", () => {
    const output = "compiling src/a.ts\nerror TS2322: Type 'number'\ncompiling src/b.ts\nbuild completed"
    const res = filterBash("npm run build", output, 8000)
    expect(res.output).toContain("error TS2322")
    expect(res.output).toContain("build completed")
    expect(res.output).not.toContain("compiling src/a.ts")
  })

  test("filterBash build: ok build with no errors", () => {
    const output = "compiling...\nbuild completed successfully"
    const res = filterBash("npm run build", output, 8000)
    expect(res.output).toBe("✓ build completed successfully")
  })

  test("filterBash grep: grouped by file with match count", () => {
    const output = "src/index.ts:10:  const x = 1\nsrc/index.ts:20:  const x = 2\nsrc/utils.ts:5:const x = 3"
    const res = filterBash("grep -r 'const x' src/", output, 8000)
    expect(res.output).toContain("3 matches in 2 files")
    expect(res.output).toContain("src/index.ts:")
    expect(res.output).toContain("src/utils.ts:")
  })

  test("filterBash docker ps: compact format", () => {
    const output = "CONTAINER ID   IMAGE     STATUS          NAMES\nabc123def456   nginx     Up 2 hours      web\n789012abc345   redis     Up 3 hours      cache"
    const res = filterBash("docker ps", output, 8000)
    expect(res.output).toContain("abc123def456")
    expect(res.output).toContain("nginx")
    expect(res.output).toContain("Up 2 hours")
  })

  test("filterBash generic: deduplicates repetitive lines", () => {
    const raw = "hello\nworld\nworld\nworld\ntest"
    const res = filterBash("echo test", raw, 1000)
    expect(res.output).toContain("hello")
    expect(res.output).toContain("world [×3]")
    expect(res.output).toContain("test")
  })

  test("filterBash respects maxChars truncation", () => {
    const longOutput = "line\n".repeat(2000)
    const res = filterBash("echo long", longOutput, 200)
    expect(res.output.length).toBeLessThanOrEqual(longOutput.length)
  })
})
