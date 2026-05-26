/**
 * OpenCode UltraPress — Entry Point
 * Wires the 4 layers into OpenCode Plugin API Hooks.
 */

import { mergeConfig, createSessionStats } from "./config/defaults.js"
import { sanitizeConfig } from "./config/validate.js"
import type { UltraPressConfig, SessionStats } from "./config/schema.js"
import { processToolOutput } from "./layers/layer1-output-filter.js"
import { processMessageContext } from "./layers/layer2-caveman.js"
import { processTurnForDCP, processCompactingHook } from "./layers/layer3-dcp.js"
import { compressToolDefinition } from "./dcp/compress-tool.js"
import { expandToolDefinition } from "./dcp/expand-tool.js"
import { applyPruning } from "./dcp/prune.js"
import { storeOriginalContent, resetCompressionState } from "./dcp/compress-state.js"
import { resetContextTokens, setRealContextTokens } from "./dcp/context-monitor.js"
import { applyCleanup, handleTurnTick } from "./layers/layer4-cleanup.js"
import { handleSlashCommand } from "./commands/slash.js"
import { estimateTokens } from "./utils/token-count.js"
import * as logger from "./utils/logger.js"
import { resetMLMPipeline } from "./caveman/mlm.js"
import { resetLLMPipeline } from "./caveman/llm.js"

let config: UltraPressConfig
let stats: SessionStats
const sessionsPendingContextNote = new Set<string>()
const sessionsSuppressCommandFollowup = new Set<string>()
const GLOBAL_CLEANUP_REGISTRY_KEY = "__ultrapressCleanupState__" as const
// NOTE: Do NOT throw to "prevent" command fallthrough. Newer OpenCode versions
// show errors thrown from hooks as visible UI errors.
// Instead, clear output.parts to prevent AI from receiving the command.

type CleanupState = {
  registered: boolean
  done: boolean
}

function getCleanupState(): CleanupState {
  const globalState = globalThis as typeof globalThis & {
    [GLOBAL_CLEANUP_REGISTRY_KEY]?: CleanupState
  }

  if (!globalState[GLOBAL_CLEANUP_REGISTRY_KEY]) {
    globalState[GLOBAL_CLEANUP_REGISTRY_KEY] = {
      registered: false,
      done: false,
    }
  }

  return globalState[GLOBAL_CLEANUP_REGISTRY_KEY]
}

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
    // Strip JSONC comments before parsing
    const strippedContent = fileContent.replace(/^\s*\/\/.*$/gm, "")
    const externalConfig = JSON.parse(strippedContent)
    baseConfig = sanitizeConfig(externalConfig)
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

  // Reset compression state for clean session start (prevents ID collisions across sessions)
  resetCompressionState()
  sessionsPendingContextNote.clear()
  
  // Also dispose any cached MLM/LLM pipelines from previous sessions
  await Promise.all([
    resetMLMPipeline(),
    resetLLMPipeline(),
  ])

  logger.info("UltraPress activated! Compressing tokens in the background.")
  
  // Register best-effort cleanup on process exit signals (ONCE across all server() calls)
  // Note: OpenCode may load UltraPress more than once in the same process,
  // so we store guard state on globalThis (process-global), not module-local.
  const cleanupState = getCleanupState()
  if (!cleanupState.registered) {
    cleanupState.registered = true
    logger.info(`[Cleanup] Plugin active — PID ${process.pid}`)
    const cleanupOnExit = async () => {
      if (cleanupState.done) return
      cleanupState.done = true
      logger.info("[Cleanup] Disposing MLM/LLM pipelines before exit...")
      // Force-kill fallback: exit in 5s even if dispose hangs
      const forceTimer = setTimeout(() => process.exit(0), 5000)
      try {
        await Promise.all([
          resetMLMPipeline(),
          resetLLMPipeline(),
        ])
      } finally {
        clearTimeout(forceTimer)
        logger.info("[Cleanup] Done — exiting.")
        process.exit(0)
      }
    }
    // beforeExit can fire multiple times — use module-level guard
    process.on("beforeExit", cleanupOnExit)
    // Signals fire exactly once — use once() to auto-deregister
    process.once("SIGTERM", cleanupOnExit)
    process.once("SIGINT", cleanupOnExit)
  }
  
  // Pre-load MLM model if enabled to avoid lag on first message
  if (config.semantic.enabled && config.semantic.mode === "mlm") {
     import("./caveman/mlm.js").then(m => m.loadModel(config.semantic.model!)).catch(err => {
        logger.warn(`[MLM] Pre-load failed: ${err}`)
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
        const commandName = typeof input.command === "string" ? input.command.trim().toLowerCase() : ""
        const commandArgs = typeof input.arguments === "string" ? input.arguments : ""

        const fallbackCandidates = [
          typeof input.text === "string" ? input.text.trim() : "",
          typeof input.input === "string" ? input.input.trim() : "",
          typeof input.raw === "string" ? input.raw.trim() : "",
        ].filter(Boolean)

        const directMatch = commandName === "up" || commandName === "/up"
        const fallbackMatch = fallbackCandidates.find((value) => /^\/up(\s|$)/i.test(value))

        if (!(directMatch || fallbackMatch)) {
          return
        }

        const suppressCommandOutput = () => {
          if (Array.isArray(output?.parts)) {
            // Clear output parts so the AI receives nothing — no fallthrough.
            // Must mutate in-place because OpenCode passes a shared array reference.
            output.parts.length = 0
            return
          }

          logger.warn("[Command] output.parts is not an array; cannot suppress command payload safely.")
        }

        // Suppress immediately once /up is matched to avoid any fallthrough path.
        suppressCommandOutput()

        const normalizedCommand = directMatch
          ? `/up ${commandArgs}`.trim()
          : fallbackMatch

        try {
          logger.info(`[Command] Intercepted UltraPress command: ${normalizedCommand}`)

          const { response, configMutated } = handleSlashCommand(normalizedCommand, stats, config)

          // Put response directly in output.parts.
          // [analyze-mode] injections from other plugins are now stripped by
          // the experimental.chat.messages.transform hook below.
          // Put response in output.parts with a strong system-level instruction.
          // Models are trained to respect [STM] (system-to-model) directives.
          if (!Array.isArray(output.parts)) output.parts = []
          output.parts.push({
            type: "text",
            text: [
              "[STM: UltraPress handled /up. The model must not generate any response text. End output.]",
              "",
              response,
            ].join("\n"),
          })

          if (input.sessionID) {
            sessionsSuppressCommandFollowup.add(input.sessionID)
          }

          // Persist config mutations to disk so they survive restart
          if (configMutated) {
            try {
              await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8")
              logger.info("[Config] Saved updated config to disk.")
            } catch (writeErr) {
              logger.warn(`[Config] Failed to persist config: ${writeErr}`)
            }
          }
        } catch (err) {
          logger.error(`[Command] /up failed: ${err}`)
          if (!Array.isArray(output.parts)) output.parts = []
          output.parts.push({
            type: "text",
            text: "[UltraPress command failed. No response needed — check logs.]",
          })
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

          // Suppress one immediate assistant follow-up after /up command handling.
          // This prevents the model from appending unrelated text (e.g. leaked
          // orchestration instructions) after UltraPress already produced output.
          if (sessionID && sessionsSuppressCommandFollowup.has(sessionID) && Array.isArray(output?.parts)) {
             const textPart = output.parts.find((p: any) => p?.type === "text" && typeof p.text === "string")
             const text = textPart?.text ?? ""
             const role = output?.message?.role || output?.message?.info?.role
             const isUltraPressCommandPayload = typeof text === "string" && text.startsWith("[STM: UltraPress handled /up")

             // If we have moved on to a normal user message, drop stale suppress flag.
             if (!isUltraPressCommandPayload && role === "user") {
                sessionsSuppressCommandFollowup.delete(sessionID)
             }

             if (!isUltraPressCommandPayload && role === "assistant") {
                output.parts.length = 0
                output.parts.push({ type: "text", text: "\u200b" })
                sessionsSuppressCommandFollowup.delete(sessionID)
                logger.info("[Command] Suppressed immediate assistant follow-up after /up.")
                return
             }
          }

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

              const { prunedCount, estimatedTokensSaved } = applyPruning(prunableMessages, config.summarization.preserveLastN, config.summarization.scoreThreshold,
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
                  if (estimatedTokensSaved > 0) {
                    stats.savedByLayer.summarization += estimatedTokensSaved
                  }
                  resetContextTokens(0) // Reset context estimate after pruning
                  if (sessionID) {
                    sessionsPendingContextNote.add(sessionID)
                  }
                  logger.info(`[L3] Pruned ${prunedCount} messages from context (estimated ${estimatedTokensSaved} tokens saved).`)
                } else {
                   logger.debug("[L3] No messages pruned this turn (no eligible compression blocks or protected content only).")
                }
            } else if (config.summarization.enabled) {
               logger.debug("[L3] Pruning skipped this turn: output.message not available or not an array.")
            }

            // Layer 2 + 3: Semantic Compression & DCP Nudge
            // Content lives in output.parts (TextPart.text) not output.message.content
            const textPartIndex = (output.parts || []).findIndex((p: any) => p.type === "text")
            const msgContent: string | null = textPartIndex >= 0 ? output.parts[textPartIndex].text : null

            // Track raw tokens for all chat messages
            if (msgContent) {
               stats.totalTokensRaw += estimateTokens(msgContent)
            }

            // Only process if there's text content from the current turn
            if (msgContent && config.semantic.enabled) {
                const role = input.role || "assistant"
                // Extract tool name from output parts (for skipTools check)
                const toolName = (output.parts || []).find((p: any) => p.type === "tool")?.tool
                const content = await processMessageContext(msgContent, role, {
                   stats,
                  config: config.semantic,
                }, toolName)

               // ─── L3: DCP Turn-level Nudge ──────────────────────
               // Check if context is approaching limit and inject nudge for LLM to compress
               let displayText = content
               if (config.summarization.enabled) {
                  const { nudgePrompt } = processTurnForDCP(msgContent, {
                     config: config.summarization,
                     stats,
                  })
                  if (nudgePrompt) {
                     displayText += "\n\n" + nudgePrompt
                     logger.info("[L3] Injected DCP compression nudge into prompt.")
                  }
               }

                // ─── L3: Context Note (post-compression reminder) ───
                if (config.summarization.enabled && sessionID && sessionsPendingContextNote.has(sessionID)) {
                   displayText += `\n\n[Context note: Older messages have been compressed. Focus on recent ${config.summarization.preserveLastN} messages.]`
                   sessionsPendingContextNote.delete(sessionID)
                   logger.info("[L3] Injected compressed context note into user prompt.")
                }

               // Track compressed tokens
               stats.totalTokensCompressed += estimateTokens(content)

               // Write final text back to output
               if (displayText !== msgContent) {
                  output.parts[textPartIndex].text = displayText
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
      * experimental.chat.messages.transform
      * Fires just before messages are sent to the LLM.
      * UltraPress loads last in the plugin list, so this runs AFTER
      * oh-my-openagent's transform — allowing us to undo [analyze-mode]
      * injection on /up command messages.
      */
      "experimental.chat.messages.transform": async (_input: {}, output: { messages: any[] }) => {
         if (!Array.isArray(output?.messages)) return

         for (const msg of output.messages) {
            if (!Array.isArray(msg?.parts)) continue

            for (let i = 0; i < msg.parts.length; i++) {
               const part = msg.parts[i]
               if (part?.type !== "text" || typeof part.text !== "string") continue

               // Strip [analyze-mode] / [search-mode] blocks injected by oh-my-openagent.
               part.text = part.text.replace(
                  /\[(?:analyze|search)-mode\][\s\S]*?[\r\n]+---[\s]*/gi,
                  ""
               ).trim()
            }
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
