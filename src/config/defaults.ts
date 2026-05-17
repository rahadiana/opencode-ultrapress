import type { UltraPressConfig, SessionStats } from "./schema.js"

export const DEFAULT_CONFIG: UltraPressConfig = {
  enabled: true,
  autoUpdate: true,

  // Layer 1 - Output Filter
  outputFilter: {
    enabled: true,
    maxCharsPerOutput: 8000,
    teeSaveOnTruncate: true,
    customFilters: [],
  },

  // Layer 2 - Semantic Compression
  semantic: {
    enabled: true,
    mode: "nlp",
    model: "Xenova/all-MiniLM-L6-v2",
    compressUserMessages: true,
    compressAssistantMessages: false,
    compressToolOutputs: true,
    protectCodeBlocks: true,
    protectErrors: true,
    minLengthChars: 200,
  },

  // Layer 3 - Smart Summarization
  summarization: {
    enabled: true,
    mode: "range",
    maxContextLimit: 70_000,
    minContextLimit: 40_000,
    nudgeFrequency: 5,
    summaryBuffer: true,
    showCompression: true,
    preserveLastN: 3,
    scoreThreshold: 0, // 0 = disabled, use 0.45 to enable multi-signal scoring
  },

  // Layer 4 - Auto Cleanup
  cleanup: {
    deduplication: { enabled: true },
    purgeErrors: { enabled: true, turns: 4 },
  },

  // Slash commands
  commands: { enabled: true },

  // Notifications
  notification: "minimal",
}

export function createSessionStats(): SessionStats {
  return {
    totalTokensRaw: 0,
    totalTokensCompressed: 0,
    savedByLayer: {
      outputFilter: 0,
      semantic: 0,
      summarization: 0,
      cleanup: 0,
    },
    compressionCount: 0,
    deduplicationCount: 0,
    errorPurgeCount: 0,
    startTime: Date.now(),
    actualTokensInput: 0,
    actualTokensOutput: 0,
    actualTokensReasoning: 0,
  }
}

export function mergeConfig(
  userConfig: Partial<UltraPressConfig>
): UltraPressConfig {
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    outputFilter: {
      ...DEFAULT_CONFIG.outputFilter,
      ...userConfig.outputFilter,
    },
    semantic: {
      ...DEFAULT_CONFIG.semantic,
      ...userConfig.semantic,
    },
    summarization: {
      ...DEFAULT_CONFIG.summarization,
      ...userConfig.summarization,
    },
    cleanup: {
      deduplication: {
        ...DEFAULT_CONFIG.cleanup.deduplication,
        ...userConfig.cleanup?.deduplication,
      },
      purgeErrors: {
        ...DEFAULT_CONFIG.cleanup.purgeErrors,
        ...userConfig.cleanup?.purgeErrors,
      },
    },
    commands: {
      ...DEFAULT_CONFIG.commands,
      ...userConfig.commands,
    },
  }
}
