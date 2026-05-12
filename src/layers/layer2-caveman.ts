/**
 * Layer 2 — Semantic Compression
 * Applies Caveman-style grammar stripping to natural language.
 */

import type { SemanticConfig, SessionStats } from "../config/schema.js"
import { compressNLP } from "../caveman/nlp.js"
import { compressMLM } from "../caveman/mlm.js"
import * as logger from "../utils/logger.js"
import { formatSavings } from "../utils/token-count.js"

export interface Layer2Deps {
  config: SemanticConfig
  stats: SessionStats
}

export async function processMessageContext(
  content: string,
  role: "user" | "assistant" | "system" | "tool",
  deps: Layer2Deps
): Promise<string> {
  if (!deps.config.enabled) return content

  // Check role configuration
  if (role === "user" && !deps.config.compressUserMessages) return content
  if (role === "assistant" && !deps.config.compressAssistantMessages) return content
  if (role === "tool" && !deps.config.compressToolOutputs) return content
  if (role === "system") return content // We usually don't compress system prompts

  // Check minimum length
  if (content.length < deps.config.minLengthChars) {
    return content
  }

  try {
    let result: { compressedText: string; originalTokens: number; compressedTokens: number }

    if (deps.config.mode === "mlm") {
      result = await compressMLM(content)
    } else {
      result = compressNLP(content)
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
