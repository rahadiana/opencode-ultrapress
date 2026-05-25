import type {
  CleanupConfig,
  CustomFilter,
  NotificationLevel,
  OutputFilterConfig,
  SemanticConfig,
  SummarizationConfig,
  UltraPressConfig,
} from "./schema.js"
import { DEFAULT_CONFIG } from "./defaults.js"

const REQUIRED_SKIP_TOOLS = ["task"] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function asNumber(value: unknown, fallback: number, options: { min?: number; max?: number } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  if (options.min !== undefined && value < options.min) return options.min
  if (options.max !== undefined && value > options.max) return options.max
  return value
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const strings = value.filter((item): item is string => typeof item === "string")
  return strings.length === value.length ? strings : fallback
}

function ensureRequiredSkipTools(tools: string[]): string[] {
  const merged = new Set(tools)
  for (const required of REQUIRED_SKIP_TOOLS) {
    merged.add(required)
  }
  return Array.from(merged)
}

function asNotificationLevel(value: unknown, fallback: NotificationLevel): NotificationLevel {
  return value === "off" || value === "minimal" || value === "detailed" ? value : fallback
}

function sanitizeCustomFilters(value: unknown, fallback: CustomFilter[]): CustomFilter[] {
  if (!Array.isArray(value)) return fallback

  const filters: CustomFilter[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.commandPattern !== "string") continue
    filters.push({
      commandPattern: item.commandPattern,
      stripPatterns: asStringArray(item.stripPatterns, []),
      keepPatterns: asStringArray(item.keepPatterns, []),
      maxLines: typeof item.maxLines === "number" && Number.isFinite(item.maxLines) && item.maxLines > 0
        ? Math.floor(item.maxLines)
        : undefined,
    })
  }
  return filters
}

function sanitizeOutputFilter(value: unknown, fallback: OutputFilterConfig): OutputFilterConfig {
  const input = isRecord(value) ? value : {}
  const skipTools = ensureRequiredSkipTools(asStringArray(input.skipTools, fallback.skipTools))
  return {
    enabled: asBoolean(input.enabled, fallback.enabled),
    maxCharsPerOutput: asNumber(input.maxCharsPerOutput, fallback.maxCharsPerOutput, { min: 100 }),
    teeSaveOnTruncate: asBoolean(input.teeSaveOnTruncate, fallback.teeSaveOnTruncate),
    customFilters: sanitizeCustomFilters(input.customFilters, fallback.customFilters),
    skipTools,
  }
}

function sanitizeSemantic(value: unknown, fallback: SemanticConfig): SemanticConfig {
  const input = isRecord(value) ? value : {}
  const mode = input.mode === "nlp" || input.mode === "mlm" || input.mode === "llm" ? input.mode : fallback.mode
  const skipTools = ensureRequiredSkipTools(asStringArray(input.skipTools, fallback.skipTools))
  return {
    enabled: asBoolean(input.enabled, fallback.enabled),
    mode,
    model: typeof input.model === "string" && input.model.trim() ? input.model : fallback.model,
    compressUserMessages: asBoolean(input.compressUserMessages, fallback.compressUserMessages),
    compressAssistantMessages: asBoolean(input.compressAssistantMessages, fallback.compressAssistantMessages),
    compressToolOutputs: asBoolean(input.compressToolOutputs, fallback.compressToolOutputs),
    protectCodeBlocks: asBoolean(input.protectCodeBlocks, fallback.protectCodeBlocks),
    protectErrors: asBoolean(input.protectErrors, fallback.protectErrors),
    minLengthChars: asNumber(input.minLengthChars, fallback.minLengthChars, { min: 0 }),
    skipTools,
  }
}

function sanitizeSummarization(value: unknown, fallback: SummarizationConfig): SummarizationConfig {
  const input = isRecord(value) ? value : {}
  const mode = input.mode === "range" || input.mode === "message" ? input.mode : fallback.mode
  return {
    enabled: asBoolean(input.enabled, fallback.enabled),
    mode,
    maxContextLimit: asNumber(input.maxContextLimit, fallback.maxContextLimit, { min: 1 }),
    minContextLimit: asNumber(input.minContextLimit, fallback.minContextLimit, { min: 0 }),
    nudgeFrequency: Math.floor(asNumber(input.nudgeFrequency, fallback.nudgeFrequency, { min: 1 })),
    nudgeThreshold: asNumber(input.nudgeThreshold, fallback.nudgeThreshold, { min: 0, max: 1 }),
    summaryBuffer: asBoolean(input.summaryBuffer, fallback.summaryBuffer),
    showCompression: asBoolean(input.showCompression, fallback.showCompression),
    preserveLastN: Math.floor(asNumber(input.preserveLastN, fallback.preserveLastN, { min: 0 })),
    scoreThreshold: asNumber(input.scoreThreshold, fallback.scoreThreshold, { min: 0, max: 1 }),
  }
}

function sanitizeCleanup(value: unknown, fallback: CleanupConfig): CleanupConfig {
  const input = isRecord(value) ? value : {}
  const deduplication = isRecord(input.deduplication) ? input.deduplication : {}
  const purgeErrors = isRecord(input.purgeErrors) ? input.purgeErrors : {}
  return {
    deduplication: {
      enabled: asBoolean(deduplication.enabled, fallback.deduplication.enabled),
    },
    purgeErrors: {
      enabled: asBoolean(purgeErrors.enabled, fallback.purgeErrors.enabled),
      turns: Math.floor(asNumber(purgeErrors.turns, fallback.purgeErrors.turns, { min: 1 })),
    },
  }
}

export function sanitizeConfig(userConfig: unknown): UltraPressConfig {
  const input = isRecord(userConfig) ? userConfig : {}
  const commands = isRecord(input.commands) ? input.commands : {}

  return {
    enabled: asBoolean(input.enabled, DEFAULT_CONFIG.enabled),
    outputFilter: sanitizeOutputFilter(input.outputFilter, DEFAULT_CONFIG.outputFilter),
    semantic: sanitizeSemantic(input.semantic, DEFAULT_CONFIG.semantic),
    summarization: sanitizeSummarization(input.summarization, DEFAULT_CONFIG.summarization),
    cleanup: sanitizeCleanup(input.cleanup, DEFAULT_CONFIG.cleanup),
    commands: {
      enabled: asBoolean(commands.enabled, DEFAULT_CONFIG.commands.enabled),
    },
    notification: asNotificationLevel(input.notification, DEFAULT_CONFIG.notification),
  }
}
