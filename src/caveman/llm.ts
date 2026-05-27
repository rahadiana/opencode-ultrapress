/**
 * GSC — AI-Assisted Compression (LLM Mode)
 *
 * Uses @huggingface/transformers summarization pipeline for local,
 * API-free semantic compression. No external LLM required.
 *
 * HOW IT WORKS:
 * 1. Splits text into manageable chunks (max ~2000 chars to avoid OOM)
 * 2. Loads a summarization model (T5-small, q8-quantized)
 * 3. Summarizes each chunk, preserving technical facts
 * 4. Reassembles compressed text
 *
 * Falls back to NLP (grammar stripping) on error or for very short texts.
 */

import type { NLPResult } from "./nlp.js"
import { estimateTokens } from "../utils/token-count.js"
import { extractCodeBlocks, restoreCodeBlocks, verifyPlaceholders } from "./facts.js"
import * as logger from "../utils/logger.js"

// ─── Configuration ──────────────────────────────────────────────────────

let pipelineInstance: any = null
let currentModelName: string | undefined = undefined
let idleTimeout: NodeJS.Timeout | null = null

const IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

const DEFAULT_LLM_MODEL = "Xenova/t5-small"
const MAX_CHUNK_CHARS = 2000     // Split long text into chunks for the model
const MIN_CHUNK_CHARS = 300      // Below this, NLP is cheaper/faster
const SUMMARY_MAX_LENGTH = 256   // Max output tokens per chunk
const SUMMARY_MIN_LENGTH = 32    // Min output tokens per chunk

export interface LLMCompressOptions {
  protectCodeBlocks?: boolean
}

// ─── Model Loading ──────────────────────────────────────────────────────

async function loadModel(modelName: string): Promise<any> {
  if (!pipelineInstance || currentModelName !== modelName) {
    // Dispose previous pipeline to prevent worker/orphan process leaks on Windows
    if (pipelineInstance) {
      await disposePipeline(pipelineInstance)
      pipelineInstance = null
    }

    logger.info(`[LLM] Loading summarization model (${modelName})...`)

    // Limit ONNX Runtime threads to prevent excessive Bun worker processes
    process.env.ORT_NUM_THREADS = process.env.ORT_NUM_THREADS || "1"

    let loadPipeline: any, env: any
    try {
      const mod = await import("@huggingface/transformers")
      loadPipeline = mod.pipeline
      env = mod.env
    } catch {
      throw new Error(
        "@huggingface/transformers not installed. Run: npm install @huggingface/transformers, or switch semantic.mode to 'nlp'."
      )
    }
    Object.assign(env, { allowLocalModels: true, allowRemoteModels: true })

    // Limit WASM backend threads
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1
    }

    pipelineInstance = await loadPipeline("summarization", modelName, { dtype: "q8" })
    currentModelName = modelName
    logger.info("[LLM] Summarization model loaded.")
  }

  // Clear any existing idle timeout when model is actively used
  if (idleTimeout) {
    clearTimeout(idleTimeout)
    idleTimeout = null
  }

  return pipelineInstance
}

/**
 * Safely dispose a pipeline instance, releasing ONNX Runtime workers.
 */
async function disposePipeline(pipe: any): Promise<void> {
  try {
    if (typeof pipe?.dispose === "function") {
      await pipe.dispose()
    }
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Reset idle timeout — called after any model usage.
 * If no usage for IDLE_TIMEOUT_MS, pipeline will be disposed automatically.
 */
function resetIdleTimeout(): void {
  if (idleTimeout) {
    clearTimeout(idleTimeout)
    idleTimeout = null
  }
  idleTimeout = setTimeout(() => {
    if (pipelineInstance) {
      disposePipeline(pipelineInstance)
      pipelineInstance = null
      currentModelName = undefined
    }
    idleTimeout = null
  }, IDLE_TIMEOUT_MS)
}

// ─── Chunking ───────────────────────────────────────────────────────────

function splitIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]

  const chunks: string[] = []
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/g)

  let current = ""
  for (const sent of sentences) {
    if (current.length + sent.length > maxChars && current.length > 0) {
      chunks.push(current.trim())
      current = sent
    } else {
      current += (current ? " " : "") + sent
    }
  }
  if (current.trim()) chunks.push(current.trim())

  return chunks
}

// ─── Main LLM Compression ───────────────────────────────────────────────

export async function compressLLM(
  text: string,
  modelName: string = DEFAULT_LLM_MODEL,
  options: LLMCompressOptions = {}
): Promise<NLPResult> {
  const originalTokens = estimateTokens(text)
  const protectCodeBlocks = options.protectCodeBlocks ?? true

  try {
    // Skip very short text — NLP is cheaper
    if (text.length < MIN_CHUNK_CHARS) {
      const { compressNLP } = await import("./nlp.js")
      return {
        ...compressNLP(text, { protectCodeBlocks }),
        method: "llm-too-short",
      }
    }

    // ── 1. Protect code blocks ──────────────────────────────────────────
    const { compressedText: noCodeText, blocks } = protectCodeBlocks
      ? extractCodeBlocks(text)
      : { compressedText: text, blocks: [] }

    // ── 2. Split into model-friendly chunks ─────────────────────────────
    const chunks = splitIntoChunks(noCodeText, MAX_CHUNK_CHARS)

    // ── 3. Load model ───────────────────────────────────────────────────
    const pipe = await loadModel(modelName)
    resetIdleTimeout()

    // ── 4. Summarize each chunk ─────────────────────────────────────────
    const compressedChunks: string[] = []
    for (const chunk of chunks) {
      try {
        const result = await pipe(chunk, {
          max_length: SUMMARY_MAX_LENGTH,
          min_length: SUMMARY_MIN_LENGTH,
          do_sample: false, // deterministic
        })
        const summary = Array.isArray(result)
          ? result[0]?.summary_text || chunk
          : result?.summary_text || chunk
        compressedChunks.push(summary)
      } catch {
        // If a chunk fails, keep the original
        compressedChunks.push(chunk)
      }
    }

    // ── 5. Reassemble ───────────────────────────────────────────────────
    let compressedText = compressedChunks.join("\n\n")

    // ── 6. Restore code blocks ──────────────────────────────────────────
    if (protectCodeBlocks) {
      const placeholderCheck = verifyPlaceholders(compressedText, blocks.length)
      if (!placeholderCheck.valid) {
        return {
          compressedText: text,
          originalTokens,
          compressedTokens: originalTokens,
          method: "llm-placeholder-safety",
        }
      }
      compressedText = restoreCodeBlocks(compressedText, blocks)
    }

    // Cleanup
    compressedText = compressedText
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()

    const compressedTokens = estimateTokens(compressedText)

    // Safety: revert if no savings
    if (compressedTokens >= originalTokens) {
      return {
        compressedText: text,
        originalTokens,
        compressedTokens: originalTokens,
        method: "llm-no-savings",
      }
    }

    return {
      compressedText,
      originalTokens,
      compressedTokens,
      method: "llm-local",
    }
  } catch (e) {
    logger.warn("[LLM] Compression failed, falling back to NLP.", e)
    const { compressNLP } = await import("./nlp.js")
    return {
      ...compressNLP(text, { protectCodeBlocks }),
      method: "llm-fallback-error",
    }
  }
}

/**
 * Reset the cached pipeline (useful for testing / config changes).
 * Properly disposes ONNX Runtime workers to prevent process leaks.
 */
export async function resetLLMPipeline(): Promise<void> {
  if (idleTimeout) {
    clearTimeout(idleTimeout)
    idleTimeout = null
  }
  await disposePipeline(pipelineInstance)
  pipelineInstance = null
  currentModelName = undefined
}
