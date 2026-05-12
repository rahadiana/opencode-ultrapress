#!/usr/bin/env tsx
/**
 * UltraPress Reproducible Benchmark Script
 *
 * Measures actual compression performance across all layers on real fixture data.
 * Run with: npm run benchmark
 *
 * Conditions:
 *   - Token estimation: character-based heuristic (~85-90% accurate vs tiktoken)
 *   - Layers tested: Layer 1 (Output Filter) and Layer 2 (NLP Semantic)
 *   - Each fixture is tested independently — no pipeline chaining to avoid double-compression
 */

import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { compressNLP } from "../src/caveman/nlp.js"
import { filterGit } from "../src/filters/git.js"
import { filterGeneric } from "../src/filters/generic.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, "fixtures")

// ─── Token Estimation (same as production) ───────────────────────────────────
const CHARS_PER_TOKEN = 3.7
const CHARS_PER_TOKEN_CODE = 3.2

function estimateTokens(text: string): number {
  if (!text) return 0
  const codeIndicators = text.match(/[{}();=<>[\]|&!+\-*/]/g)?.length ?? 0
  const codeRatio = codeIndicators / text.length
  const charsPerToken = codeRatio > 0.05 ? CHARS_PER_TOKEN_CODE : CHARS_PER_TOKEN
  return Math.ceil(text.length / charsPerToken)
}

function pct(original: number, compressed: number): string {
  if (original === 0) return "0%"
  return `${Math.round(((original - compressed) / original) * 100)}%`
}

// ─── Benchmark Helpers ────────────────────────────────────────────────────────
interface BenchmarkResult {
  fixture: string
  layer: string
  original: number
  compressed: number
  savings: string
}

const results: BenchmarkResult[] = []

function run(fixture: string, layer: string, original: string, compressed: string) {
  const origTokens = estimateTokens(original)
  const compTokens = estimateTokens(compressed)
  results.push({
    fixture,
    layer,
    original: origTokens,
    compressed: compTokens,
    savings: pct(origTokens, compTokens),
  })
}

// ─── Run Benchmarks ───────────────────────────────────────────────────────────
console.log("\n🔬 UltraPress — Reproducible Benchmark\n")
console.log("Conditions:")
console.log("  Token method : Character-based heuristic (3.7 chars/token for prose, 3.2 for code)")
console.log("  Timestamp    :", new Date().toISOString())
console.log("  Node.js      :", process.version)
console.log("")

// --- Fixture 1: git diff (Layer 1 - Git Filter) ---
const gitDiff = readFileSync(join(FIXTURES_DIR, "git-diff-large.txt"), "utf-8")
const gitFiltered = filterGit("git diff", gitDiff, 8000)
run("git-diff-large.txt", "Layer 1 (Git Filter)", gitDiff, gitFiltered.output)

// --- Fixture 2: npm install log (Layer 1 - Generic Filter) ---
const npmLog = readFileSync(join(FIXTURES_DIR, "npm-install-log.txt"), "utf-8")
const npmFiltered = filterGeneric(npmLog, 8000)
run("npm-install-log.txt", "Layer 1 (Generic Filter)", npmLog, npmFiltered.output)

// --- Fixture 3: pytest log (Layer 1 - Generic Filter) ---
const pytestLog = readFileSync(join(FIXTURES_DIR, "pytest-log.txt"), "utf-8")
const pytestFiltered = filterGeneric(pytestLog, 8000)
run("pytest-log.txt", "Layer 1 (Generic Filter)", pytestLog, pytestFiltered.output)

// --- Fixture 4: chat history (Layer 2 - NLP Semantic Compression) ---
const chatHistory = JSON.parse(readFileSync(join(FIXTURES_DIR, "chat-history.json"), "utf-8"))
let chatOriginalTokens = 0
let chatCompressedTokens = 0
for (const msg of chatHistory) {
  const origTokens = estimateTokens(msg.content)
  const result = compressNLP(msg.content)
  chatOriginalTokens += origTokens
  chatCompressedTokens += result.compressedTokens
}
results.push({
  fixture: "chat-history.json",
  layer: "Layer 2 (NLP Semantic)",
  original: chatOriginalTokens,
  compressed: chatCompressedTokens,
  savings: pct(chatOriginalTokens, chatCompressedTokens),
})

// ─── Print Table ──────────────────────────────────────────────────────────────
const colWidths = [26, 28, 10, 12, 10]
const headers = ["Fixture", "Layer", "Original", "Compressed", "Savings"]

function padR(s: string, n: number) { return s.padEnd(n) }
function padL(s: string, n: number) { return s.padStart(n) }

const divider = colWidths.map(w => "─".repeat(w)).join("┼")
const header  = headers.map((h, i) => padR(h, colWidths[i])).join("│")

console.log("┌" + colWidths.map(w => "─".repeat(w)).join("┬") + "┐")
console.log("│" + header + "│")
console.log("├" + divider + "┤")

for (const r of results) {
  const row = [
    padR(r.fixture, colWidths[0]),
    padR(r.layer, colWidths[1]),
    padL(r.original.toLocaleString(), colWidths[2]),
    padL(r.compressed.toLocaleString(), colWidths[3]),
    padL(r.savings, colWidths[4]),
  ].join("│")
  console.log("│" + row + "│")
}
console.log("└" + colWidths.map(w => "─".repeat(w)).join("┴") + "┘")

const totalOrig = results.reduce((a, r) => a + r.original, 0)
const totalComp = results.reduce((a, r) => a + r.compressed, 0)
console.log(`\n✅ Total: ${totalOrig.toLocaleString()} → ${totalComp.toLocaleString()} tokens saved (${pct(totalOrig, totalComp)} overall savings)\n`)
console.log("ℹ️  Note: Savings vary significantly by content type. Tool logs compress more than natural language.\n")
