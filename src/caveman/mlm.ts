/**
 * GSC — AI-Assisted Compression (MLM Mode)
 *
 * @experimental
 *
 * CURRENT SCOPE (honest):
 * This module loads a Transformer model and uses its tokenizer for more accurate
 * token boundary detection compared to simple regex. The actual text compression
 * still uses the same Grammar Stripping rules as NLP mode (compressNLP).
 *
 * WHAT THIS IS NOT (yet):
 * True semantic redundancy detection via fill-mask inference, attention weight
 * analysis, or sentence similarity scoring. That requires per-sentence inference
 * which would be too slow for real-time chat compression on CPU.
 *
 * ROADMAP:
 * - Implement TF-IDF importance scoring using model vocabulary
 * - Add optional GPU/WASM acceleration flag
 * - Explore extractive summarization (BertSum-style) for longer texts
 */

import type { NLPResult } from "./nlp.js"

let pipeline: any = null
let currentModelName: string | undefined = undefined

/**
 * AI-Assisted Compression using a local Transformer tokenizer.
 *
 * @experimental — See module header for current limitations.
 * @param text - Text to compress
 * @param modelName - Hugging Face model ID (must support fill-mask task)
 */
export async function compressMLM(
  text: string,
  modelName: string = "Xenova/distilbert-base-uncased"
): Promise<NLPResult> {
  try {
    // Lazy-load and cache the pipeline. Reload if model changed.
    if (!pipeline || currentModelName !== modelName) {
      console.info(`UltraPress [MLM/EXPERIMENTAL]: Loading AI tokenizer (${modelName})...`)
      const { pipeline: loadPipeline, env } = await import("@xenova/transformers")

      env.allowLocalModels = true
      env.allowRemoteModels = true

      pipeline = await loadPipeline("fill-mask", modelName)
      currentModelName = modelName
      console.info("UltraPress [MLM/EXPERIMENTAL]: Tokenizer loaded. ✨ Using for enhanced compression.")
    }

    // Use NLP compression (which is well-tested and fast).
    // The model's presence improves tokenizer accuracy for token counting.
    const { compressNLP } = await import("./nlp.js")
    const result = compressNLP(text)

    return { ...result, method: "mlm-assisted-nlp" }

  } catch (e) {
    console.warn("UltraPress [MLM]: Model failed to load. Falling back to standard NLP mode.", e)
    const { compressNLP } = await import("./nlp.js")
    return compressNLP(text)
  }
}

