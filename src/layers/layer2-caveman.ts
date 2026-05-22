/**
 * Layer 2 — Semantic Compression (GSC: Grammar Stripping Compression)
 * Applies rule-based or AI-assisted grammar stripping to natural language.
 */

import type { SemanticConfig, SessionStats } from "../config/schema.js"
import { compressNLP } from "../caveman/nlp.js"
import { compressMLM } from "../caveman/mlm.js"
import { compressLLM } from "../caveman/llm.js"
import * as logger from "../utils/logger.js"
import { formatSavings } from "../utils/token-count.js"

const ERROR_CONTENT_PATTERNS = [
  /\berror\b/i,
  /\bexception\b/i,
  /\btraceback\b/i,
  /\bpanic\b/i,
  /\bfailed\b/i,
  /\bstack trace\b/i,
  /^\s*at\s+.+/m,
]

function looksLikeErrorContent(content: string): boolean {
  return ERROR_CONTENT_PATTERNS.some((pattern) => pattern.test(content))
}

export interface Layer2Deps {
  config: SemanticConfig
  stats: SessionStats
}

export async function processMessageContext(
  content: string,
  role: "user" | "assistant" | "system" | "tool",
  deps: Layer2Deps,
  tool?: string,
): Promise<string> {
  if (!deps.config.enabled) return content

  // Skip protected tools (e.g., sub-agent task output)
  if (tool && deps.config.skipTools?.includes(tool)) {
    logger.debug(`[L2] Skipping semantic compression: tool "${tool}" is in skipTools list.`)
    return content
  }

  // Check role configuration
  if (role === "user" && !deps.config.compressUserMessages) return content
  if (role === "assistant" && !deps.config.compressAssistantMessages) return content
  if (role === "tool" && !deps.config.compressToolOutputs) return content
  if (role === "system") return content // We usually don't compress system prompts

  // Protect error and stack-trace text when configured
  if (deps.config.protectErrors && looksLikeErrorContent(content)) {
    logger.debug("[L2] Skipping semantic compression: error-like content detected and protectErrors is enabled.")
    return content
  }

  // Check minimum length
  if (content.length < deps.config.minLengthChars) {
    logger.debug(`[L2] Skipping semantic compression: content length (${content.length}) is below threshold (${deps.config.minLengthChars}).`)
    return content
  }

  try {
    let result: { compressedText: string; originalTokens: number; compressedTokens: number }

    if (deps.config.mode === "mlm") {
      result = await compressMLM(content, deps.config.model, {
        protectCodeBlocks: deps.config.protectCodeBlocks,
      })
    } else if (deps.config.mode === "llm") {
      result = await compressLLM(content, undefined, {
        protectCodeBlocks: deps.config.protectCodeBlocks,
      })
    } else {
      result = compressNLP(content, {
        protectCodeBlocks: deps.config.protectCodeBlocks,
      })
    }

    const saved = result.originalTokens - result.compressedTokens
    if (saved > 0) {
      deps.stats.savedByLayer.semantic += saved
      logger.debug(`[L2] ${role} message compressed: ${formatSavings(result.originalTokens, result.compressedTokens)}`)
      return result.compressedText
    }

    return content
  } catch (err) {
    logger.error(`Layer 2 semantic compression failed: ${err}`)
    return content
  }
}
