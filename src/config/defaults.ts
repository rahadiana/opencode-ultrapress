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
