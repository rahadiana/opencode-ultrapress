/**
 * OpenCode UltraPress — Entry Point
 * Wires the 4 layers into OpenCode Plugin API Hooks.
 */

import { mergeConfig, createSessionStats } from "./config/defaults.js"
import type { UltraPressConfig, SessionStats } from "./config/schema.js"
import { processToolOutput } from "./layers/layer1-output-filter.js"
import { processMessageContext } from "./layers/layer2-caveman.js"
import { processCompactingHook } from "./layers/layer3-dcp.js"
import { compressToolDefinition } from "./dcp/compress-tool.js"
import { expandToolDefinition } from "./dcp/expand-tool.js"
import { applyPruning } from "./dcp/prune.js"
import { storeOriginalContent } from "./dcp/compress-state.js"
import { resetContextTokens, setRealContextTokens } from "./dcp/context-monitor.js"
import { applyCleanup, handleTurnTick } from "./layers/layer4-cleanup.js"
import { handleSlashCommand } from "./commands/slash.js"
import { estimateTokens } from "./utils/token-count.js"
import * as logger from "./utils/logger.js"

let config: UltraPressConfig
let stats: SessionStats

import { Hooks } from "@opencode-ai/plugin"
import { join } from "path"
import { readFile, writeFile, mkdir } from "fs/promises"
import { homedir } from "os"

/**
 * OpenCode Plugin Initialization
 */
export async function server(ctx: any): Promise<Hooks> {
  // 1. Start with hardcoded defaults
  let baseConfig = mergeConfig({})
  
  // 2. Try to load from ~/.config/opencode/ultrapress.json
  const configDir = join(homedir(), ".config", "opencode")
  const configPath = join(configDir, "ultrapress.json")
  
  try {
    const fileContent = await readFile(configPath, "utf-8")
    const externalConfig = JSON.parse(fileContent)
    baseConfig = mergeConfig(externalConfig)
    logger.info(`[Config] Loaded dedicated config from ${configPath}`)
  } catch (e: any) {
    if (e.code === "ENOENT") {
       // Best Practice: Auto-create the config file if it doesn't exist
       try {
          await mkdir(configDir, { recursive: true })
          await writeFile(configPath, JSON.stringify(baseConfig, null, 2), "utf-8")
          logger.info(`[Config] Created best-practice configuration at ${configPath}`)
       } catch (writeErr) {
          logger.debug("[Config] Failed to auto-create config file, using in-memory defaults.")
       }
    } else {
       logger.debug(`[Config] Error reading ultrapress.json, using defaults.`)
    }
  }

  config = baseConfig
  stats = createSessionStats()
  logger.setLogLevel(config.notification)

  logger.info("UltraPress activated! Compressing tokens in the background.")
  
  // Pre-load MLM model if enabled to avoid lag on first message
  if (config.semantic.enabled && config.semantic.mode === "mlm") {
     import("./caveman/mlm.js").then(m => m.compressMLM("initialization", config.semantic.model)).catch(err => {
        logger.debug(`[MLM] Pre-load failed: ${err}`)
     })
  }

  return {
    // ─── CUSTOM TOOLS ───────────────────────────────────
    tool: {
       "ultrapress_compress": compressToolDefinition,
       "ultrapress_expand": expandToolDefinition,
    },

    /**
     * Native Slash Command Interceptor
     * OpenCode uses this hook to evaluate /up (derived from opencode-ultrapress package name)
     */
    "command.execute.before": async (input: any, output: any) => {
       try {
          if (input.command === "up") {
             const response = handleSlashCommand(`/up ${input.arguments || ""}`, stats, config)
             output.parts = output.parts || []
             output.parts.push({
                type: "text",
                text: `${response}`
             })
          }
       } catch (err) {
          logger.error(`[Command] /up failed: ${err}`)
          output.parts = output.parts || []
          output.parts.push({ type: "text", text: "UltraPress: Command failed. Check logs for details." })
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

      try {
        const toolName = input.tool
        const args = input.args
        const isError = output.isError || false
        const rawText = typeof output.output === "string" ? output.output : JSON.stringify(output.output)
        
        // We use a mock ID for MVP if not provided by OpenCode
        const msgId = input.messageId || `msg_${Date.now()}`

        // Track raw tokens BEFORE any filtering
        const rawTokens = estimateTokens(rawText)
        stats.totalTokensRaw += rawTokens

        // 1. Layer 1: Output Filter (RTK-style)
        let filteredText = processToolOutput(toolName, args, rawText, { config: config.outputFilter, stats })

        // 2. Layer 4: Auto Cleanup (Dedup & Register for Purge)
        filteredText = applyCleanup(toolName, args, filteredText, isError, msgId, { config: config.cleanup, stats })

        // Track compressed tokens AFTER all filtering
        const compressedTokens = estimateTokens(filteredText)
        stats.totalTokensCompressed += compressedTokens

        // Update output
        output.output = filteredText
      } catch (err) {
        logger.error(`[L1] tool.execute.after failed: ${err}`)
        // Output left unchanged — best-effort filtering
      }
    },

    /**
     * chat.message
     * Called before a user message is sent to LLM, or when LLM responds.
     * Good for tracking turns and Layer 2 Semantic compression (future).
     */
    "chat.message": async (input: any, output: any) => {
       try {
         const sessionID = input.sessionID

          // SYNC HISTORY + REAL TOKENS: First call fetches real token counts
          // from OpenCode API (AssistantMessage.tokens) and estimates for fallback.
          if (stats.totalTokensRaw === 0 && sessionID) {
             try {
                const msgs: Array<{ info: any; parts: Array<any> }> = await ctx.client.session.messages({ id: sessionID })
                if (msgs && msgs.length > 0) {
                   let estimatedTotal = 0
                   let actualInput = 0
                   let actualOutput = 0
                   let actualReasoning = 0
                   for (const { info } of msgs) {
                      if (info) {
                         // Estimate from message content for backward-compat stats
                         if (typeof info.content === "string") {
                            estimatedTotal += estimateTokens(info.content)
                         }
                         // Real token data from AssistantMessage
                         if (info.tokens) {
                            actualInput += info.tokens.input || 0
                            actualOutput += info.tokens.output || 0
                            actualReasoning += info.tokens.reasoning || 0
                         }
                      }
                   }
                   stats.totalTokensRaw = estimatedTotal
                   stats.actualTokensInput = actualInput
                   stats.actualTokensOutput = actualOutput
                   stats.actualTokensReasoning = actualReasoning
                   setRealContextTokens(actualInput, actualOutput)
                   logger.info(`[Sync] History synced: ~${estimatedTotal} estimated, ${actualInput} real input, ${actualOutput} real output tokens.`)
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

           // ─── L3: Apply pending pruning on context messages ───
           // Convert output.message (each msg has { info, parts }) to MessageLike[] for pruning
           if (output.message && Array.isArray(output.message) && config.summarization.enabled) {
              const prunableMessages: Array<{ id: string; role: string; parts?: any[] }> =
                 output.message.map((m: any) => ({
                    id: m.info?.id || m.id,
                    role: m.info?.role || m.role || "user",
                    parts: m.parts || [],
                 }))

              const { prunedCount } = applyPruning(prunableMessages, config.summarization.preserveLastN, config.summarization.scoreThreshold,
                (blockId, removedMessages) => {
                  storeOriginalContent(blockId, removedMessages)
                }
              )

              if (prunedCount > 0) {
                  // Rebuild output.message from pruned array
                  // Map back: preserve original { info, parts } for kept messages,
                  // create synthetic entries for summary messages (which have .content)
                  const newMessages: any[] = []
                 for (const m of prunableMessages) {
                    if ((m as any).content) {
                       // Summary message injected by applyPruning
                       newMessages.push({
                          info: { id: m.id, role: m.role },
                          parts: [{ type: "text", text: (m as any).content }],
                       })
                    } else {
                       // Find original entry to preserve reference
                       const orig = output.message.find((o: any) => (o.info?.id || o.id) === m.id)
                       newMessages.push(orig || { info: { id: m.id, role: m.role }, parts: m.parts || [] })
                    }
                 }
                 output.message.length = 0
                 output.message.push(...newMessages)
                 stats.savedByLayer.summarization += prunedCount
                 resetContextTokens(0) // Reset context estimate after pruning
                 logger.info(`[L3] Pruned ${prunedCount} messages from context.`)
              }
           }

           // Layer 2 + 3: Semantic Compression & DCP Nudge
           // Content lives in output.parts (TextPart.text) not output.message.content
           const textPartIndex = (output.parts || []).findIndex((p: any) => p.type === "text")
           const msgContent: string | null = textPartIndex >= 0 ? output.parts[textPartIndex].text : null

            // Only process if there's text content from the current turn
            if (msgContent && config.semantic.enabled) {
                const role = input.role || "assistant"
                // Extract tool name from output parts (for skipTools check)
                const toolName = (output.parts || []).find((p: any) => p.type === "tool")?.tool
                const content = await processMessageContext(msgContent, role, {
                   stats,
                  config: config.semantic,
                }, toolName)
              stats.savedByLayer.semantic += estimateTokens(msgContent) - estimateTokens(content)

              // ─── L3: DCP Nudge ──────────────────────────────────
              if (config.summarization.enabled && stats.compressionCount > 0) {
                 // Inject nudge instruction into the user prompt
                 // This tells the LLM to summarize older context since it's being pruned
                 output.parts[textPartIndex].text = content + `\n\n[Context note: Older messages have been compressed. Focus on recent ${config.summarization.preserveLastN} messages.]`
                 logger.info("[L3] Injected compressed nudge into user prompt.")
              }

              // Track compressed tokens
              stats.totalTokensCompressed += estimateTokens(content)

              // Write compressed content back to the text part
              if (content !== msgContent) {
                 output.parts[textPartIndex].text = content
              }
           }
        } catch (err) {
           logger.error(`[Hook] chat.message failed: ${err}`)
           // Output left unchanged — best-effort processing
        }
    },

    /**
     * experimental.session.compacting
     * Called when OpenCode is preparing the prompt for the LLM.
     * We can inject critical protected context here.
     */
    "experimental.session.compacting": async (input: any, output: any) => {
       try {
          const protectedContext = processCompactingHook(input.sessionID, { config: config.summarization, stats })
          if (protectedContext) {
             output.context = output.context || []
             output.context.push(protectedContext)
          }
       } catch (err) {
          logger.error(`[Hook] session.compacting failed: ${err}`)
          // Protected context omitted — best-effort
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

export default server
