/**
 * Fact preservation logic.
 * Ensures we don't accidentally compress away numbers, identifiers, or code.
 */

// Regex for numbers, dimensions, paths, and technical identifiers
const PRESERVE_PATTERNS = [
  /^[0-9]+(\.[0-9]+)?(ms|s|m|h|kb|mb|gb|px|rem|em|%)?$/i, // Numbers and units (42, 500ms, 99.9%)
  /^[A-Z][a-zA-Z0-9]+$/, // PascalCase (ClassName)
  /^[a-z]+[A-Z][a-zA-Z0-9]+$/, // camelCase (functionName)
  /^[A-Z0-9_]+$/, // UPPER_SNAKE (CONSTANTS)
  /^[\w.-]+\/[\w.-]+$/, // Paths (src/index.js)
  /^@[\w.-]+\/[\w.-]+$/, // Scoped packages (@types/node)
  /^O\([^)]+\)$/, // Big O notation (O(log n))
  /^v[0-9]+\.[0-9]+\.[0-9]+$/, // Semver (v1.0.0)
  /^[a-f0-9]{7,40}$/i, // Hex hashes (Git SHAs)
]

export function isPreservedFact(word: string): boolean {
  // Strip trailing punctuation for the check, but keep internal punctuation
  const cleanWord = word.replace(/^[.,:;!?'"()\[\]{}]+|[.,:;!?'"()\[\]{}]+$/g, "")
  if (!cleanWord) return false

  for (const pattern of PRESERVE_PATTERNS) {
    if (pattern.test(cleanWord)) {
      return true
    }
  }

  // Also preserve if it contains technical symbols
  if (cleanWord.includes("::") || cleanWord.includes("->") || cleanWord.includes("=>")) {
    return true
  }

  return false
}

// Extract code blocks to protect them entirely
export function extractCodeBlocks(text: string): { compressedText: string, blocks: string[] } {
  const blocks: string[] = []
  
  // Regex to match ```language ... ``` and `inline code`
  // Replaces them with a placeholder like __CODE_BLOCK_0__
  
  let counter = 0
  
  // Multi-line code blocks
  let processed = text.replace(/```[\s\S]*?```/g, (match) => {
    blocks.push(match)
    return `__CODE_BLOCK_${counter++}__`
  })

  // Inline code
  processed = processed.replace(/`[^`]+`/g, (match) => {
    blocks.push(match)
    return `__CODE_BLOCK_${counter++}__`
  })

  return { compressedText: processed, blocks }
}

export function restoreCodeBlocks(text: string, blocks: string[]): string {
  let result = text
  for (let i = 0; i < blocks.length; i++) {
    // Use replaceAll to handle all occurrences of each placeholder
    const placeholder = `__CODE_BLOCK_${i}__`
    result = result.split(placeholder).join(blocks[i])
  }
  return result
}

/**
 * Verify that all code block placeholders are still present after compression.
 * Returns true if all placeholders are found, false if any are missing.
 * Used as a safety check for LLM/MLM modes to detect when models corrupt placeholders.
 */
export function verifyPlaceholders(text: string, expectedCount: number): { valid: boolean; missing: number[] } {
  const missing: number[] = []
  for (let i = 0; i < expectedCount; i++) {
    if (!text.includes(`__CODE_BLOCK_${i}__`)) {
      missing.push(i)
    }
  }
  return { valid: missing.length === 0, missing }
}
