// ─── UltraPress Config Types ───────────────────────────────

export interface OutputFilterConfig {
  /** Enable Layer 1 output filtering */
  enabled: boolean
  /** Max characters per tool output before truncation */
  maxCharsPerOutput: number
  /** Save full output to temp file when truncated */
  teeSaveOnTruncate: boolean
  /** User-defined custom filters */
  customFilters: CustomFilter[]
  /** Tool names to skip filtering (e.g., ["task"] for sub-agent output) */
  skipTools: string[]
}

export interface CustomFilter {
  /** Regex pattern to match command */
  commandPattern: string
  /** Lines matching these patterns are removed */
  stripPatterns: string[]
  /** Lines matching these patterns are always kept */
  keepPatterns: string[]
  /** Max lines in output */
  maxLines?: number
}

export interface SemanticConfig {
  /** Enable Layer 2 semantic compression */
  enabled: boolean
  /** Compression mode */
  mode: "nlp" | "mlm" | "llm"
  /** MLM Model name (Transformers.js) */
  model?: string
  /** Compress user messages */
  compressUserMessages: boolean
  /** Compress assistant messages */
  compressAssistantMessages: boolean
  /** Compress tool outputs */
  compressToolOutputs: boolean
  /** Protect code blocks from compression */
  protectCodeBlocks: boolean
  /** Protect error messages from compression */
  protectErrors: boolean
  /** Minimum text length to compress (chars) */
  minLengthChars: number
  /** Tool names to skip compression (e.g., ["task"] for sub-agent output) */
  skipTools: string[]
}

export interface SummarizationConfig {
  /** Enable Layer 3 smart summarization */
  enabled: boolean
  /** Summarization mode */
  mode: "range" | "message"
  /** Token limit to trigger compression nudge */
  maxContextLimit: number
  /** Target token count after compression */
  minContextLimit: number
  /** How often to check context size (every N turns) */
  nudgeFrequency: number
  /** Nudge when context reaches this fraction of maxContextLimit (0-1, default: 0.70 = 70%) */
  nudgeThreshold: number
  /** Buffer summaries for batch processing */
  summaryBuffer: boolean
  /** Show compression info in output */
  showCompression: boolean
  /** Preserve last N messages from pruning to keep recent context intact (0 = disable) */
  preserveLastN: number
  /** Multi-signal importance scoring threshold (0-1). 0 = disabled, 0.45 = recommended. */
  scoreThreshold: number
}

export interface CleanupConfig {
  /** Tool call deduplication */
  deduplication: { enabled: boolean }
  /** Error input purging */
  purgeErrors: { enabled: boolean; turns: number }
}

export interface CommandsConfig {
  /** Enable slash commands */
  enabled: boolean
}

export type NotificationLevel = "off" | "minimal" | "detailed"

export interface UltraPressConfig {
  /** Master switch */
  enabled: boolean
  /** Layer 1 */
  outputFilter: OutputFilterConfig
  /** Layer 2 */
  semantic: SemanticConfig
  /** Layer 3 */
  summarization: SummarizationConfig
  /** Layer 4 */
  cleanup: CleanupConfig
  /** Slash commands */
  commands: CommandsConfig
  /** Notification verbosity */
  notification: NotificationLevel
}

// ─── Session Stats ─────────────────────────────────────────

export interface SessionStats {
  /** Total tokens in raw input */
  totalTokensRaw: number
  /** Total tokens after compression */
  totalTokensCompressed: number
  /** Tokens saved per layer */
  savedByLayer: {
    outputFilter: number
    semantic: number
    summarization: number
    cleanup: number
  }
  /** Number of compressions performed */
  compressionCount: number
  /** Number of deduplications */
  deduplicationCount: number
  /** Number of error purges */
  errorPurgeCount: number
  /** Session start time */
  startTime: number
  /** Real LLM input tokens (from AssistantMessage.tokens.input, aggregated) */
  actualTokensInput: number
  /** Real LLM output tokens (from AssistantMessage.tokens.output, aggregated) */
  actualTokensOutput: number
  /** Real LLM reasoning tokens (from AssistantMessage.tokens.reasoning, aggregated) */
  actualTokensReasoning: number
}

// ─── Filter Result ─────────────────────────────────────────

export interface FilterResult {
  /** Filtered output text */
  output: string
  /** Original token count (approximate) */
  originalTokens: number
  /** Filtered token count (approximate) */
  filteredTokens: number
  /** Whether output was truncated */
  truncated: boolean
  /** Path to full output file if truncated */
  fullOutputPath?: string
}
