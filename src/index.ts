/**
 * OpenCode UltraPress — Entry Point
 * Wires the 4 layers into OpenCode Plugin API Hooks.
 */

import { mergeConfig, createSessionStats } from "./config/defaults.js"
import type { UltraPressConfig, SessionStats } from "./config/schema.js"
import { processToolOutput } from "./layers/layer1-output-filter.js"
import { processMessageContext } from "./layers/layer2-caveman.js"
import { processTurnForDCP, processCompactingHook } from "./layers/layer3-dcp.js"
import { compressToolDefinition } from "./dcp/compress-tool.js"
import { applyCleanup, handleTurnTick } from "./layers/layer4-cleanup.js"
import { handleSlashCommand } from "./commands/slash.js"
import { estimateTokens } from "./utils/token-count.js"
import * as logger from "./utils/logger.js"

let config: UltraPressConfig
let stats: SessionStats

import type { Hooks } from "@opencode-ai/plugin"

/**
 * OpenCode Plugin Initialization
 */
export async function server(_ctx: any): Promise<Hooks> {
  // Load config (mocking for MVP, would normally read from ~/.config/opencode/ultrapress.jsonc)
  config = mergeConfig({})
  stats = createSessionStats()
  logger.setLogLevel(config.notification)

  logger.info("UltraPress activated! Compressing tokens in the background.")

  return {
    // ─── CUSTOM TOOLS ───────────────────────────────────
    tool: {
       "ultrapress_compress": compressToolDefinition
    },

    /**
     * Native Slash Command Interceptor
     * OpenCode uses this hook to evaluate /up (derived from opencode-up package name)
     */
    "command.execute.before": async (input: any, output: any) => {
       if (input.command === "up") {
          const response = handleSlashCommand(`/up ${input.arguments || ""}`, stats, config)
          output.parts = output.parts || []
          output.parts.push({ type: "text", text: response })
       }
    },

    // ─── HOOKS ──────────────────────────────────────────

    /**
     * tool.execute.after
     * Called after a tool returns its raw output, before adding to context.
     * Perfect place for L1 Filter and L4 Dedup.
     */
    "tool.execute.after": async (input: any, output: any) => {
      // Don't intercept our own tool
      if (input.tool === "ultrapress_compress") return;

      const toolName = input.tool
      const args = input.args
      const isError = output.isError || false
      const rawText = typeof output.output === "string" ? output.output : JSON.stringify(output.output)
      
      // We use a mock ID for MVP if not provided by OpenCode
      const msgId = input.messageId || `msg_${Date.now()}`

      // 1. Layer 1: Output Filter (RTK-style)
      let filteredText = processToolOutput(toolName, args, rawText, { config: config.outputFilter, stats })

      // 2. Layer 4: Auto Cleanup (Dedup & Register for Purge)
      filteredText = applyCleanup(toolName, args, filteredText, isError, msgId, { config: config.cleanup, stats })

      // Update output
      output.output = filteredText
    },

    /**
     * chat.message
     * Called before a user message is sent to LLM, or when LLM responds.
     * Good for tracking turns and Layer 2 Semantic compression (future).
     */
    "chat.message": async (input: any, output: any) => {
       const sessionID = input.sessionID

       // SYNC HISTORY: If this is the first turn in this session for the plugin,
       // we need to know the total token count of the entire history.
       if (stats.totalTokensRaw === 0 && sessionID) {
          try {
             const session = await _ctx.client.session.get({ id: sessionID })
             if (session && session.messages) {
                let historyTokens = 0
                for (const msg of session.messages) {
                   if (typeof msg.content === "string") {
                      historyTokens += estimateTokens(msg.content)
                   }
                }
                stats.totalTokensRaw = historyTokens
                logger.info(`[Sync] Synchronized history tokens: ${historyTokens}`)
             }
          } catch (e) {
             logger.debug("[Sync] Failed to sync history tokens, will continue with turn-based count.")
          }
       }

       // Tick Layer 4 error purging
       const idsToPurge = handleTurnTick({ config: config.cleanup, stats })
       if (idsToPurge.length > 0) {
          // Instruct OpenCode to purge these message IDs
          output.purgeMessages = idsToPurge
       }

       // Layer 2: Semantic Compression
       if (output.message && typeof output.message.content === "string") {
          // Layer 3: Track context and nudge if necessary
          const { nudgePrompt } = processTurnForDCP(output.message.content, { config: config.summarization, stats })
          
          // Apply Layer 2 compression
          let content = processMessageContext(
             output.message.content, 
             output.message.role, 
             { config: config.semantic, stats }
          )

          // Inject nudge if required
          if (nudgePrompt && output.message.role === "user") {
             content = `${content}\n\n${nudgePrompt}`
             logger.debug("[L3] Injected compression nudge into user prompt.")
          }

          output.message.content = content
       }
    },

    /**
     * experimental.session.compacting
     * Called when OpenCode is preparing the prompt for the LLM.
     * We can inject critical protected context here.
     */
    "experimental.session.compacting": async (input: any, output: any) => {
       const protectedContext = processCompactingHook(input.sessionID, { config: config.summarization, stats })
       if (protectedContext) {
          output.context = output.context || []
          output.context.push(protectedContext)
       }
    },
    /**
     * Configuration Hook
     * This is where we register our slash command so it appears in the UI
     */
    config: async (opencodeConfig: any) => {
       opencodeConfig.command = opencodeConfig.command || {}
       opencodeConfig.command["up"] = {
          template: "",
          description: "UltraPress: Token compression and system status"
       }
       logger.debug("Registered /up command via config hook.")
    }
  }
}

export default {
  id: "@ultrapress/opencode-up",
  server
}
