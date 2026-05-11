/**
 * Caveman Compression Rules.
 * Lists of stop words, grammar to strip, and filler words.
 */

// Common English articles and determiners
export const ARTICLES = new Set([
  "a", "an", "the", "this", "that", "these", "those"
])

// Common Copulas and auxiliary verbs
export const COPULAS = new Set([
  "is", "am", "are", "was", "were", "be", "being", "been",
  "has", "have", "had", "do", "does", "did",
  "will", "shall", "would", "should", "can", "could", "may", "might", "must"
])

// Connectives and conjunctions that don't add heavy semantic value
export const CONNECTIVES = new Set([
  "and", "but", "or", "so", "because", "although", "though", "even",
  "if", "unless", "until", "while", "since", "as", "for",
  "therefore", "moreover", "furthermore", "however", "nevertheless",
  "consequently", "meanwhile", "otherwise", "instead", "thus", "hence",
  "in", "on", "at", "to", "from", "with", "by", "about", "into", "through", "over", "under"
])

// Filler words and conversational boilerplate
export const FILLERS = new Set([
  "very", "quite", "really", "just", "actually", "basically", "literally",
  "essentially", "practically", "simply", "totally", "absolutely",
  "please", "kindly", "maybe", "perhaps", "probably", "possibly",
  "anyway", "anyhow", "somehow", "somewhat", "well", "like", "you", "know",
  "i", "me", "my", "mine", "we", "us", "our", "ours", "they", "them", "their", "theirs",
  "he", "him", "his", "she", "her", "hers", "it", "its"
])

// Words to definitely KEEP (negations, critical constraints)
export const PROTECTED_WORDS = new Set([
  "not", "no", "never", "none", "neither", "nor", "cannot", "won't", "don't", "didn't", "isn't", "aren't",
  "only", "always", "every", "all", "none", "some", "few", "many", "most",
  "must", "required", "optional", "mandatory", "forbidden", "allowed",
  "max", "min", "maximum", "minimum"
])

// Check if a word is safe to strip
export function isStrippable(word: string): boolean {
  const lower = word.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (!lower) return false
  if (PROTECTED_WORDS.has(lower)) return false
  
  return ARTICLES.has(lower) || COPULAS.has(lower) || CONNECTIVES.has(lower) || FILLERS.has(lower)
}
