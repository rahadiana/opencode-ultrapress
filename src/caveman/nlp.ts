/**
 * Caveman NLP Engine
 * Zero-dependency, rule-based semantic compression.
 */

import { isStrippable } from "./rules.js"
import { isPreservedFact, extractCodeBlocks, restoreCodeBlocks } from "./facts.js"
import { estimateTokens } from "../utils/token-count.js"

export interface NLPResult {
  compressedText: string
  originalTokens: number
  compressedTokens: number
  method?: string
}

function compressSentence(sentence: string): string {
  const words = sentence.split(/\s+/)
  const keptWords: string[] = []

  for (const word of words) {
    if (!word) continue

    // If it's a code block placeholder, keep it
    if (word.startsWith("__CODE_BLOCK_")) {
      keptWords.push(word)
      continue
    }

    // Always keep facts (numbers, identifiers, paths)
    if (isPreservedFact(word)) {
      keptWords.push(word)
      continue
    }

    // Strip grammar/fillers
    if (isStrippable(word)) {
      // Sometimes we might want to keep the punctuation attached to stripped words
      const punctuation = word.match(/[.,:;!?'"()\[\]{}]+$/)
      if (punctuation && keptWords.length > 0 && !keptWords[keptWords.length - 1].startsWith("__CODE_BLOCK_")) {
          // Append punctuation to the previous word if safe
          // (Simple heuristic, not perfect but keeps sentences readable)
      }
      continue
    }

    // Default: keep the word
    keptWords.push(word)
  }

  return keptWords.join(" ")
}

export function compressNLP(text: string): NLPResult {
  const originalTokens = estimateTokens(text)

  // 1. Protect code blocks
  const { compressedText: noCodeText, blocks } = extractCodeBlocks(text)

  // 2. Split into lines and process (preserves paragraph structure roughly)
  const lines = noCodeText.split("\n")
  const compressedLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      compressedLines.push("")
      continue
    }

    // Don't compress markdown headers or lists too aggressively
    if (trimmed.startsWith("#") || trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      // Just do light compression on the content
      const prefixMatch = trimmed.match(/^([#\-*]+\s)(.*)/)
      if (prefixMatch) {
         compressedLines.push(prefixMatch[1] + compressSentence(prefixMatch[2]))
      } else {
         compressedLines.push(trimmed)
      }
      continue
    }

    // Compress normal sentences
    compressedLines.push(compressSentence(trimmed))
  }

  // 3. Restore code blocks
  let finalText = restoreCodeBlocks(compressedLines.join("\n"), blocks)

  // 4. Cleanup excessive spaces
  finalText = finalText.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim()

  const compressedTokens = estimateTokens(finalText)

  // Safety check: if compression actually made it larger (rare but possible with placeholders), revert
  if (compressedTokens >= originalTokens) {
    return {
      compressedText: text,
      originalTokens,
      compressedTokens: originalTokens
    }
  }

  return {
    compressedText: finalText,
    originalTokens,
    compressedTokens
  }
}
