/**
 * GSC — AI-Assisted Compression (MLM Mode)
 *
 * @experimental
 *
 * HOW IT WORKS:
 * 1. Splits text into sentences
 * 2. Loads a Transformer sentence-embedding model (all-MiniLM-L6-v2)
 * 3. Computes cosine similarity for each pair of consecutive sentences
 * 4. Removes sentences that are near-duplicates (sim >= 0.85)
 *
 * Language-agnostic: works for any language the model understands.
 * Falls back to NLP (grammar stripping) on error or for very short texts.
 */

import type { NLPResult } from "./nlp.js"
import { estimateTokens } from "../utils/token-count.js"
import { extractCodeBlocks, restoreCodeBlocks, verifyPlaceholders } from "./facts.js"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

let pipelineInstance: any = null
let currentModelName: string | undefined = undefined

const SIMILARITY_THRESHOLD = 0.85 // consecutive sentences above this → duplicate
const MAX_SENTENCE_CHARS = 5000

export interface MLMCompressOptions {
  protectCodeBlocks?: boolean
}

// ---------------------------------------------------------------------------
// Cosine Similarity
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

// ---------------------------------------------------------------------------
// Sentence Splitting (multi-language)
// ---------------------------------------------------------------------------

function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace
  const raw = text.split(/(?<=[.!?])\s+(?=[A-Za-z0-9"'(\[])/gm)
  const result: string[] = []

  for (let s of raw) {
    s = s.trim()
    if (!s) continue
    // Split on paragraph breaks
    const parts = s.split(/\n\n+/)
    for (const p of parts) {
      const trimmed = p.trim()
      if (trimmed) result.push(trimmed)
    }
  }

  // Merge very short fragments (< 15 chars) into previous sentence
  const merged: string[] = []
  for (const s of result) {
    if (merged.length > 0 && s.length < 15 && !s.includes("```")) {
      merged[merged.length - 1] += " " + s
    } else {
      merged.push(s)
    }
  }

  return merged
}

// ---------------------------------------------------------------------------
// Model Loading
// ---------------------------------------------------------------------------

export async function loadModel(modelName: string): Promise<any> {
  if (!pipelineInstance || currentModelName !== modelName) {
    console.info(`UltraPress [MLM]: Loading model (${modelName})...`)
    const { pipeline: loadPipeline, env } = await import("@huggingface/transformers")
    Object.assign(env, { allowLocalModels: true, allowRemoteModels: true })
    pipelineInstance = await loadPipeline("feature-extraction", modelName, { dtype: "q8" })
    currentModelName = modelName
    console.info("UltraPress [MLM]: Model loaded.")
  }
  return pipelineInstance
}

// ---------------------------------------------------------------------------
// Embed a single sentence → vector
// ---------------------------------------------------------------------------

async function embed(pipeline: any, sentence: string): Promise<number[] | null> {
  try {
    const truncated = sentence.slice(0, MAX_SENTENCE_CHARS)
    const output = await pipeline(truncated, { pooling: "mean", normalize: true })
    return Array.from(output.data as Float32Array)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Main MLM Compression
// ---------------------------------------------------------------------------

export async function compressMLM(
  text: string,
  modelName?: string,
  options: MLMCompressOptions = {}
): Promise<NLPResult> {
  const originalTokens = estimateTokens(text)
  const protectCodeBlocks = options.protectCodeBlocks ?? true
  const effectiveModelName = modelName ?? "Xenova/all-MiniLM-L6-v2"

  try {
    // ── 1. Protect code blocks ──────────────────────────────────────────
    const { compressedText: noCodeText, blocks } = protectCodeBlocks
      ? extractCodeBlocks(text)
      : { compressedText: text, blocks: [] }

    // ── 2. Split into sentences ─────────────────────────────────────────
    const sentences = splitSentences(noCodeText)

    // Need at least 3 sentences for dedup to be meaningful
    if (sentences.length < 3) {
      const { compressNLP } = await import("./nlp.js")
      return {
        ...compressNLP(text, { protectCodeBlocks }),
        method: "fallback-too-few-sentences",
      }
    }

    // ── 3. Load model ───────────────────────────────────────────────────
    const pipe = await loadModel(effectiveModelName)

    // ── 4. Embed all sentences ──────────────────────────────────────────
    const embeddings: (number[] | null)[] = await Promise.all(
      sentences.map(s => embed(pipe, s))
    )

    // If any embedding failed, fall back
    if (embeddings.some(e => e === null)) {
      const { compressNLP } = await import("./nlp.js")
      return {
        ...compressNLP(text, { protectCodeBlocks }),
        method: "embed-failed",
      }
    }

    // ── 5. Semantic dedup (all-pairs cosine similarity) ─────────────────
    // For each sentence, check against ALL previously-kept sentences.
    // This catches duplicates that aren't adjacent (e.g., repeated phrases,
    // restated conclusions, boilerplate that appears in different sections).
    const keptIndices: number[] = [0] // Always keep first sentence

    for (let i = 1; i < sentences.length; i++) {
      const embI = embeddings[i]!
      let isDupe = false
      // Compare against all already-kept sentences
      for (const j of keptIndices) {
        const sim = cosineSimilarity(embeddings[j]!, embI)
        if (sim >= SIMILARITY_THRESHOLD) {
          isDupe = true
          break
        }
      }
      if (!isDupe) {
        keptIndices.push(i)
      }
    }

    // ── 6. Rebuild text ─────────────────────────────────────────────────
    let compressedText = keptIndices.map(i => sentences[i]).join(" ")

    // ── 7. Restore code blocks ──────────────────────────────────────────
    if (protectCodeBlocks) {
      const placeholderCheck = verifyPlaceholders(compressedText, blocks.length)
      if (!placeholderCheck.valid) {
        return {
          compressedText: text,
          originalTokens,
          compressedTokens: originalTokens,
          method: "mlm-placeholder-safety",
        }
      }
      compressedText = restoreCodeBlocks(compressedText, blocks)
    }

    // Cleanup whitespace
    compressedText = compressedText
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()

    const compressedTokens = estimateTokens(compressedText)

    // Safety: if compression made it larger or no savings, return original
    if (compressedTokens >= originalTokens) {
      return {
        compressedText: text,
        originalTokens,
        compressedTokens: originalTokens,
        method: "mlm-no-savings",
      }
    }

    return {
      compressedText,
      originalTokens,
      compressedTokens,
      method: "mlm-ai",
    }
  } catch (e) {
    console.warn("UltraPress [MLM]: compression failed, falling back to NLP.", e)
    const { compressNLP } = await import("./nlp.js")
    return {
      ...compressNLP(text, { protectCodeBlocks }),
      method: "mlm-fallback-error",
    }
  }
}

/**
 * Reset the cached pipeline (useful for testing / config changes).
 */
export function resetMLMPipeline(): void {
  pipelineInstance = null
  currentModelName = undefined
}
