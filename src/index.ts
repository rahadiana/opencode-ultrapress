/**
 * OpenCode UltraPress — Entry Point
 * Wires the 4 layers into OpenCode Plugin API Hooks.
 */

import { mergeConfig, createSessionStats } from "./config/defaults.js"
import { sanitizeConfig } from "./config/validate.js"
import type { UltraPressConfig, SessionStats } from "./config/schema.js"
import { processToolOutput } from "./layers/layer1-output-filter.js"
import { processMessageContext } from "./layers/layer2-caveman.js"
import { autoCompressMessages } from "./layers/layer3-dcp.js"
import { applyPruning } from "./dcp/prune.js"
import { compressToolDefinition } from "./dcp/compress-tool.js"
import { expandToolDefinition } from "./dcp/expand-tool.js"
import { resetCompressionState, getAllBlocks, getProtectedContextString } from "./dcp/compress-state.js"
import { setRealContextTokens, updateContextTokens, checkNudgeRequired, buildNudgePrompt } from "./dcp/context-monitor.js"
import { applyCleanup, handleTurnTick } from "./layers/layer4-cleanup.js"
import { handleSlashCommand } from "./commands/slash.js"
import { estimateTokens } from "./utils/token-count.js"
import * as logger from "./utils/logger.js"
import { resetMLMPipeline } from "./caveman/mlm.js"
import { resetLLMPipeline } from "./caveman/llm.js"

let config: UltraPressConfig
let stats: SessionStats
declare const __ULTRAPRESS_VERSION__: string
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
import { join, dirname } from "path"
import { readFile, writeFile, mkdir, copyFile } from "fs/promises"
import { homedir } from "os"
import { exec } from "child_process"
import { fileURLToPath } from "url"

/**
 * OpenCode Plugin Initialization
 */
export async function server(ctx: any): Promise<Hooks> {
  // 1. Start with hardcoded defaults
  let baseConfig = mergeConfig({})
  
  // 2. Try to load from ~/.config/opencode/ultrapress.plugin.json
  const configDir = join(homedir(), ".config", "opencode")
  const configPath = join(configDir, "ultrapress.plugin.json")
  const oldConfigPath = join(configDir, "ultrapress.json")

  // Migrate old config to new filename if exists
  try {
    await readFile(oldConfigPath, "utf-8")
    // Old file exists → check if new file exists
    try {
      await readFile(configPath, "utf-8")
    } catch {
      // New file doesn't exist → migrate
      await mkdir(configDir, { recursive: true })
      await copyFile(oldConfigPath, configPath)
      logger.info(`[Config] Migrated config from ultrapress.json to ultrapress.plugin.json`)
    }
  } catch { /* no old config, proceed normally */ }
  
  try {
    const fileContent = await readFile(configPath, "utf-8")
    // Strip JSONC comments before parsing
    const strippedContent = fileContent.replace(/^\s*\/\/.*$/gm, "")
    const externalConfig = JSON.parse(strippedContent)
    baseConfig = sanitizeConfig(externalConfig)
    // Write back sanitized config to migrate any new default fields not present in old file
    try {
      const writeConfig = { ...baseConfig, enableDebug: baseConfig.enableDebug ?? false }
      await writeFile(configPath, JSON.stringify(writeConfig, null, 2), "utf-8")
    } catch { /* best-effort; in-memory config is already valid */ }
    logger.setLogLevel(baseConfig.enableDebug ? baseConfig.notification : "off")
    logger.info(`[Config] Loaded dedicated config from ${configPath}`)
  } catch (e: any) {
    if (e.code === "ENOENT") {
       // Best Practice: Auto-create the config file if it doesn't exist
        try {
           await mkdir(configDir, { recursive: true })
           const writeConfig = { ...baseConfig, enableDebug: baseConfig.enableDebug ?? false }
           await writeFile(configPath, JSON.stringify(writeConfig, null, 2), "utf-8")
          logger.setLogLevel(baseConfig.enableDebug ? baseConfig.notification : "off")
          logger.info(`[Config] Created best-practice configuration at ${configPath}`)
       } catch (writeErr) {
          logger.setLogLevel(baseConfig.enableDebug ? baseConfig.notification : "off")
          logger.debug("[Config] Failed to auto-create config file, using in-memory defaults.")
       }
    } else {
       logger.setLogLevel(baseConfig.enableDebug ? baseConfig.notification : "off")
       logger.debug(`[Config] Error reading ultrapress.plugin.json, using defaults.`)
    }
  }

  config = baseConfig
  stats = createSessionStats()

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
     import("./caveman/mlm.js").then(m => m.loadModel(config.semantic.model!)).catch(async () => {
        logger.warn(`[MLM] Model load failed (@huggingface/transformers missing?), falling back to NLP for this session. Auto-install in background...`)
        // In-memory fallback only — config file stays "mlm" for next restart
        config.semantic.mode = "nlp"
        const pluginDir = dirname(fileURLToPath(import.meta.url))
        exec("npm install @huggingface/transformers --no-save", { cwd: pluginDir }, (error, _stdout) => {
           if (error) {
              logger.warn(`[MLM] Auto-install failed: ${error.message}. Install manually: cd "${pluginDir}" && npm install @huggingface/transformers`)
           } else {
              logger.info("[MLM] @huggingface/transformers installed — restart to use MLM mode.")
           }
        })
     })
  }

  // Fire-and-forget version check (OpenCode caches @latest, so users won't auto-update)
  if (typeof __ULTRAPRESS_VERSION__ !== "undefined") {
    fetch("https://registry.npmjs.org/@rahadiana/opencode-ultrapress/latest", { signal: AbortSignal.timeout(5000) })
      .then(async r => r.ok ? (await r.json() as { version: string }).version : null)
      .then(latest => {
        if (latest && latest !== __ULTRAPRESS_VERSION__) {
          const cacheDir = join(homedir(), ".cache", "opencode", "packages", "@rahadiana", "opencode-ultrapress@latest")
          logger.warn(
            `[Update] v${latest} available (running v${__ULTRAPRESS_VERSION__}). ` +
            `Clear cache: rm -rf "${cacheDir}" && restart OpenCode`
          )
        }
      })
      .catch(() => {})
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

           // Suppress one immediate follow-up after /up command handling.
           // This prevents the model from appending leaked orchestration text.
           // chat.message fires for BOTH user and (sometimes) assistant output;
           // OpenCode may tag the model response as role="user" in command flows,
           // so we match on content hash rather than role.
            if (sessionID && sessionsSuppressCommandFollowup.has(sessionID) && Array.isArray(output?.parts)) {
               const textPartIdx = output.parts.findIndex((p: any) => p?.type === "text" && typeof p.text === "string")
               const text = textPartIdx >= 0 ? (output.parts[textPartIdx].text as string) : ""
               const isUltraPressCommandPayload = text.startsWith("[STM: UltraPress handled /up")

               // If this is NOT the /up payload itself, strip leaked patterns from it.
               if (!isUltraPressCommandPayload && text) {
                  const stripped = text
                     .replace(/Example:\s*delegate_task\([\s\S]*?load_skills=\[\]\)\s*[-\n]*/gi, "")
                     .replace(/MANDATORY delegate_task params[\s\S]*?run_in_background when calling delegate_task\.\s*[-]*/gi, "")
                     .trim()

                  if (stripped.length === 0 || stripped.startsWith("[STM:")) {
                     // Nothing left after stripping → suppress entirely
                     output.parts.length = 0
                     output.parts.push({ type: "text", text: "\u200b" })
                     logger.info("[Command] Suppressed emptied follow-up after /up.")
                  } else if (stripped !== text) {
                     // Stripped leaked text but kept real content
                     output.parts[textPartIdx].text = stripped
                     logger.info("[Command] Stripped leaked text from /up follow-up.")
                  }

                  sessionsSuppressCommandFollowup.delete(sessionID)
                  return
               }

               // If this IS the /up payload, keep it visible and drop the flag.
               if (isUltraPressCommandPayload) {
                  sessionsSuppressCommandFollowup.delete(sessionID)
               }
            }

           // SYNC HISTORY + REAL TOKENS: First call fetches real token counts
           // from OpenCode API (AssistantMessage.tokens) and estimates for fallback.
           // Also used for eager auto-compress on every user message.
          if (sessionID) {
             try {
                const msgs: Array<{ info: any; parts: Array<any> }> = await ctx.client.session.messages({ id: sessionID })
                if (msgs && msgs.length > 0) {
                   // ─── Token sync (first call only) ──────────────────────
                   if (stats.totalTokensRaw === 0) {
                      let estimatedTotal = 0
                      let actualInput = 0
                      let actualOutput = 0
                      let actualReasoning = 0
                      for (const { info } of msgs) {
                         if (info) {
                            if (typeof info.content === "string") {
                               estimatedTotal += estimateTokens(info.content)
                            }
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

                   // ─── Eager auto-compress (every user message) ──────────
                   // Create compression blocks early so pruning in
                   // messages.transform can act immediately.
                   if (config.summarization.enabled) {
                      autoCompressMessages(msgs, config.summarization)
                   }
                }
             } catch (e) {
                logger.debug("[Sync] Failed to sync history tokens / eager compress, will continue with turn-based count.")
             }
          }

          // Tick Layer 4 error purging
          const idsToPurge = handleTurnTick({ config: config.cleanup, stats })
          if (idsToPurge.length > 0) {
             // Instruct OpenCode to purge these message IDs
             output.purgeMessages = idsToPurge
          }

            // Layer 2 + 3: Semantic Compression & DCP Nudge
            // Content lives in output.parts (TextPart.text) not output.message.content
            const textPartIndex = (output.parts || []).findIndex((p: any) => p.type === "text")
            const msgContent: string | null = textPartIndex >= 0 ? output.parts[textPartIndex].text : null

            // Track raw tokens for all chat messages
            if (msgContent) {
               stats.totalTokensRaw += estimateTokens(msgContent)
            }

            // ─── Layer 2: Semantic Compression ──────────────────────
            // Process text content through semantic compression if enabled
            let displayText: string = msgContent ?? ""
            if (msgContent && config.semantic.enabled) {
                const role = input.role || "assistant"
                const toolName = (output.parts || []).find((p: any) => p.type === "tool")?.tool
                const content = await processMessageContext(msgContent, role, {
                   stats,
                  config: config.semantic,
                }, toolName)
                displayText = content
            }

             // ─── L3: DCP Nudge (auto-compress runs in messages.transform) ──
             if (msgContent && config.summarization.enabled) {
                updateContextTokens(estimateTokens(msgContent))
                if (checkNudgeRequired(config.summarization)) {
                   const nudgePrompt = buildNudgePrompt(config.summarization)
                   displayText += "\n\n" + nudgePrompt
                   logger.info("[L3] Injected DCP compression nudge into prompt.")
                }

                // ─── L3: Context Note (post-compression reminder) ───
                 if (sessionID && sessionsPendingContextNote.has(sessionID)) {
                    displayText += `\n\n[Context note: Older messages have been compressed. Focus on recent ${config.summarization.preserveLastN} messages.]`
                    sessionsPendingContextNote.delete(sessionID)
                    logger.info("[L3] Injected compressed context note into user prompt.")
                 }
             }

            // Track compressed tokens (raw vs final display text)
            if (msgContent) {
               stats.totalTokensCompressed += estimateTokens(displayText)
            }

            // Write final text back to output if changed
            if (displayText !== msgContent) {
               output.parts[textPartIndex].text = displayText
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
           const blocks = getAllBlocks()
           const rawProtected = getProtectedContextString(input.sessionID)

           if (blocks.length > 0) {
              // ─── Use output.prompt (replaces default compaction prompt) ───
              // When set, output.context is ignored by OpenCode.
              const blockList = blocks.map(b =>
                 `- Block #${b.blockId} ("${b.topic}"): ${b.summary}`
              ).join("\n")
              
              const preserveN = config.summarization.preserveLastN
              const protectedText = rawProtected || "(none)"
              
              output.prompt = `You are compacting an OpenCode conversation session.

IMPORTANT — These messages have ALREADY been compressed into blocks.
DO NOT re-compress them. They are tracked by UltraPress:

${blockList}

Compaction instructions:
1. The last ${preserveN} messages are the most recent — keep them intact.
2. Focus on compacting messages NOT in any UltraPress block above.
3. Preserve these protected context items:
${protectedText}
4. Keep all user instructions, task context, and decision records.
5. For verbose tool outputs, summarize concisely.
6. Maintain code change history and file edit records.
7. Never lose agent instructions, goals, or constraints.

Compress older messages into a concise but complete summary.`
           } else if (rawProtected) {
              // ─── Fall back to output.context (augments default prompt) ───
              output.context = output.context || []
              output.context.push(rawProtected)
           }
        } catch (err) {
           logger.error(`[Hook] session.compacting failed: ${err}`)
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

          // ─── Step 1: Strip [analyze-mode] / [search-mode] injections ──
          for (const msg of output.messages) {
             if (!Array.isArray(msg?.parts)) continue

             for (let i = 0; i < msg.parts.length; i++) {
                const part = msg.parts[i]
                if (part?.type !== "text" || typeof part.text !== "string") continue

                part.text = part.text.replace(
                   /\[(?:analyze|search)-mode\][\s\S]*?[\r\n]+---[\s]*/gi,
                   ""
                ).trim()

                part.text = part.text.replace(
                   /(?:MANDATORY delegate_task params[\s\S]*?run_in_background when calling delegate_task\.|Example:\s*delegate_task\([\s\S]*?load_skills=\[\]\))[\s]*---?[\s]*/gi,
                   ""
                ).trim()

                part.text = part.text.replace(
                   /(?:ANALYSIS\s+MODE|SEARCH\s+MODE)[\s\S]*?(?:proceed|synthesize findings)/gi,
                   ""
                ).trim()
             }
          }

           // ─── Step 2: L3 Auto-Compress ──
            // Creates compression blocks for old messages. Does NOT modify
            // output.messages array (idempotent).
            try {
               if (config.summarization.enabled && output.messages.length > 0) {
                  autoCompressMessages(output.messages, config.summarization)
               }
            } catch (e) {
               logger.error(`[messages.transform] L3 auto-compress failed: ${e}`)
            }

            // ─── Step 3: L3 Pruning ──
            // Replaces compressed old messages with synthetic summary messages
            // via in-place array mutation (messages.length = 0; messages.push(...)).
            // This preserves the array reference OpenCode's pipeline holds,
            // unlike reassigning output.messages which breaks the pipeline.
            //
            // Proven working by opencode-dynamic-context-pruning plugin:
            // https://github.com/Opencode-DCP/opencode-dynamic-context-pruning
            try {
               if (config.summarization.enabled && output.messages.length > 0) {
                  const result = applyPruning(
                     output.messages,
                     config.summarization.preserveLastN || 0,
                     config.summarization.scoreThreshold || 0,
                  )
                  if (result.prunedCount > 0) {
                     logger.info(`[L3] Pruned ${result.prunedCount} messages, injected ${result.injectedCount} summaries, saved ~${result.estimatedTokensSaved} tokens`)
                  }
               }
            } catch (e) {
               logger.error(`[messages.transform] L3 pruning failed: ${e}`)
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
