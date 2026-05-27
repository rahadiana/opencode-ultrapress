/**
 * Multi-Signal Importance Scoring for DCP Pruning
 *
 * Replaces the naive preserveLastN binary cutoff with weighted scoring
 * across 5 signals. Higher score = keep, lower score = prune candidate.
 *
 * Signals:
 * 1. Recency      — newer messages score higher (exponential decay)
 * 2. Role         — user/system > assistant > tool
 * 3. Tool type    — protected tools (git commit, write) score high
 * 4. Keywords     — task indicators like "implement" / "fix" / "urgent"
 * 5. Content size — very short messages may be less important
 *
 * Total score range: 0.0 - 1.0
 */

import * as logger from "../utils/logger.js"

// ─── Signal Weights (sum ≈ 1.0) ─────────────────────────────────────────

const WEIGHTS = {
  recency: 0.30,
  role: 0.25,
  toolType: 0.20,
  keywords: 0.15,
  contentSize: 0.10,
}

// ─── Tool Importance ────────────────────────────────────────────────────

/** Tools whose outputs must be preserved */
const HIGH_IMPORTANCE_TOOLS = new Set([
  "write", "edit", "bash", "lsp_prepare_rename", "lsp_rename",
  "ast_grep_replace",
])

/** Tools with moderate importance */
const MEDIUM_IMPORTANCE_TOOLS = new Set([
  "read", "grep", "glob", "lsp_goto_definition", "lsp_find_references",
  "lsp_diagnostics", "task",
])

/** Tools with low importance (routine status/info) */
const LOW_IMPORTANCE_TOOLS = new Set([
  "todowrite", "session_info", "session_list", "question",
  "background_output", "tokenscope",
])

// ─── Keyword Importance ─────────────────────────────────────────────────

const HIGH_KEYWORDS = /\b(urgent|critical|bug|fix|error|crash|broken|must|mandatory|security)\b/i
const MEDIUM_KEYWORDS = /\b(implement|add|create|deploy|test|refactor|change|update|remove|delete|migrate|upgrade)\b/i

// ─── Message Shape ──────────────────────────────────────────────────────

export interface MessageMeta {
  id: string
  role: string                           // "user" | "assistant" | "system" | "tool"
  tool?: string                          // tool name if tool output
  content?: string                       // text content for keyword analysis
  index: number                          // position in message list (0 = oldest)
  totalMessages: number                  // total message count for recency calc
}

// ─── Scoring Functions ──────────────────────────────────────────────────

/** Recency: exponential decay — newest = 1.0, oldest = ~0 */
function scoreRecency(index: number, total: number): number {
  if (total <= 1) return 1.0
  // Position 0 = oldest, total-1 = newest
  const normalizedPos = index / (total - 1)
  // Exponential curve: steep drop for very old, gentle for recent
  return Math.pow(normalizedPos, 0.5)
}

/** Role: user/system preserve most, tool output compress aggressively */
function scoreRole(role: string): number {
  switch (role) {
    case "user": return 1.0
    case "system": return 0.9
    case "assistant": return 0.7
    case "tool": return 0.4
    default: return 0.5
  }
}

/** Tool type: protected tools score higher */
function scoreToolType(tool?: string): number {
  if (!tool) return 0.5 // default when role is not "tool"
  if (HIGH_IMPORTANCE_TOOLS.has(tool)) return 1.0
  if (MEDIUM_IMPORTANCE_TOOLS.has(tool)) return 0.7
  if (LOW_IMPORTANCE_TOOLS.has(tool)) return 0.3
  return 0.5 // unknown tool
}

/** Keywords: task-oriented content scores higher */
function scoreKeywords(content?: string): number {
  if (!content) return 0.3
  if (HIGH_KEYWORDS.test(content)) return 1.0
  if (MEDIUM_KEYWORDS.test(content)) return 0.7
  return 0.3
}

/** Content size: very short or extremely long messages may need different treatment */
function scoreContentSize(content?: string): number {
  if (!content) return 0.3
  const len = content.length
  if (len < 50) return 0.2       // very short — likely trivial
  if (len < 500) return 0.8      // ideal message size
  if (len < 2000) return 0.6     // medium-long — some fluff
  return 0.4                      // very long — likely verbose tool output
}

// ─── Main Scoring Entry ─────────────────────────────────────────────────

/**
 * Calculate weighted importance score for a single message.
 * Returns 0.0 - 1.0 where higher = more important = keep.
 *
 * Uses recency as a multiplicative staleness factor:
 *   finalScore = baseScore * recencyMultiplier
 *
 * This ensures OLD messages get aggressively low scores regardless of role,
 * while recent messages keep their full base score.
 */
export function scoreMessage(meta: MessageMeta): number {
  const scores = {
    recency: scoreRecency(meta.index, meta.totalMessages),
    role: scoreRole(meta.role),
    toolType: scoreToolType(meta.tool),
    keywords: scoreKeywords(meta.content),
    contentSize: scoreContentSize(meta.content),
  }

  const baseScore =
    scores.role * WEIGHTS.role +
    scores.toolType * WEIGHTS.toolType +
    scores.keywords * WEIGHTS.keywords +
    scores.contentSize * WEIGHTS.contentSize

  // Recency as multiplicative staleness factor:
  // - Newest message: multiplier = 1.0 (full base score)
  // - Oldest message: multiplier = 0.0 (always prunable)
  // This is more aggressive than weighted-sum for old/low-value messages
  // while preserving recent/high-value content.
  const staleness = Math.pow(scores.recency, 1.5) // Extra steepness beyond sqrt

  const weighted = baseScore * staleness

  return Math.min(1.0, Math.max(0.0, weighted))
}

/**
 * Score all messages in a list. Returns parallel array of scores.
 */
export function scoreMessages(messages: MessageMeta[]): number[] {
  return messages.map(m => scoreMessage(m))
}

/**
 * Determine which messages to prune based on score threshold.
 * preserveLastN is still respected: the last N messages are always kept.
 * Messages with scores below threshold are candidates for pruning.
 */
export function selectPrunableMessages(
  messages: MessageMeta[],
  preserveLastN: number,
  threshold: number = 0.45,
): Set<number> {
  const scores = scoreMessages(messages)
  const cutoff = Math.max(0, messages.length - preserveLastN)
  const prunable = new Set<number>()

  for (let i = 0; i < cutoff; i++) {
    if (scores[i] < threshold) {
      prunable.add(i)
    }
  }

  if (prunable.size > 0) {
    logger.debug(`[Scorer] ${prunable.size}/${messages.length} messages below threshold ${threshold}`)
  }

  return prunable
}
