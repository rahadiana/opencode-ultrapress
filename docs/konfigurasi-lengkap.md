# ⚙️ UltraPress Configuration — Complete Reference

> File: `~/.config/opencode/ultrapress.plugin.json`

UltraPress works *out-of-the-box* with a **Balanced default profile** (recommended for most users). The configuration file is optional — if not found, the plugin will automatically create it on first run.

---

## 📋 Basic Structure

```jsonc
{
  "enabled": true,           // Master switch
  "enableDebug": false,      // Default: silent console logs
  "notification": "minimal", // Log level when enableDebug=true

  // LAYER 1 — Output Filtering
  "outputFilter": { /* ... */ },

  // LAYER 2 — Semantic Compression
  "semantic": { /* ... */ },

  // LAYER 3 — Dynamic Context Pruning (DCP)
  "summarization": { /* ... */ },

  // LAYER 4 — Auto Cleanup
  "cleanup": { /* ... */ }
}
```

---

## 🔘 Global Settings

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | `true` | Master switch. `false` = disable entire plugin. |
| `enableDebug` | `boolean` | `false` | Enable UltraPress logs in OpenCode console. Default is silent. |
| `notification` | `"off"` / `"minimal"` / `"detailed"` | `"minimal"` | Log verbosity, used only when `enableDebug: true`. |

---

## 🎯 Layer 1 — Output Filter

Intercepts CLI tool output before it enters the context window. Most effective for long & repetitive logs.

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `outputFilter.enabled` | `boolean` | `true` | Enable Layer 1. |
| `outputFilter.maxCharsPerOutput` | `number` | `6000` | Character limit before *middle-out* truncation. Beginning & end of output are preserved. |
| `outputFilter.teeSaveOnTruncate` | `boolean` | `true` | If output is truncated, save the original log to a temporary `.log` file. Useful for debugging. |
| `outputFilter.customFilters` | `CustomFilter[]` | `[]` | Custom filters for specific CLI tools. [See details](#custom-filters). |
| `outputFilter.skipTools` | `string[]` | `["task"]` | Tool names to skip filtering. **Safety guard:** `task` is always enforced internally even if you remove it from config. |

### Example Use Case

```jsonc
{
  "outputFilter": {
    "maxCharsPerOutput": 4000,   // more aggressive — truncate at 4k characters
    "teeSaveOnTruncate": true
  }
}
```

> 💡 For sessions with lots of `git diff` or `npm install`, lower `maxCharsPerOutput` to 2000-4000.

---

## 🧠 Layer 2 — Semantic Compression

Compresses message text semantically without changing meaning. Does not touch code blocks.

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `semantic.enabled` | `boolean` | `true` | Enable Layer 2. |
| `semantic.mode` | `"nlp"` / `"mlm"` / `"llm"` | `"nlp"` | Compression mode. NLP = rule-based (zero latency). MLM = AI-based embedding dedup. LLM = local summarization via `@huggingface/transformers`. |
| `semantic.model` | `string` | `"Xenova/all-MiniLM-L6-v2"` | Model for `mlm` or `llm` mode. MLM default: `all-MiniLM-L6-v2`. LLM default: `t5-small`. |
| `semantic.compressUserMessages` | `boolean` | `true` | Compress messages from the user. |
| `semantic.compressAssistantMessages` | `boolean` | `false` | Compress messages from the assistant. Not recommended as it may remove nuance. |
| `semantic.compressToolOutputs` | `boolean` | `true` | Compress tool output after L1 filtering. |
| `semantic.protectCodeBlocks` | `boolean` | `true` | **NEVER** touch content inside triple backticks (` ``` `). |
| `semantic.protectErrors` | `boolean` | `true` | Protect error messages and stack traces to keep them accurate. |
| `semantic.minLengthChars` | `number` | `250` | Skip compression if text is shorter than this. Saves CPU for short messages. |
| `semantic.skipTools` | `string[]` | `["task"]` | Tool names to skip semantic compression. **Safety guard:** `task` is always enforced internally even if you remove it from config. |

### NLP Mode (Default)

```jsonc
{
  "semantic": {
    "mode": "nlp"
  }
}
```

Grammar stripping based on linguistic rules:
- Remove conjunctions and filler words
- Condense redundant pronouns
- Whitespace normalization
- **Zero latency** (< 1ms per message)

### MLM Mode (Experimental)

```jsonc
{
  "semantic": {
    "mode": "mlm",
    "model": "Xenova/all-MiniLM-L6-v2"
  }
}
```

Uses **Masked Language Model** via Transformers.js:
- Model download ~70MB on first use
- Latency 50-200ms per message
- Extra RAM ~200MB
- **All-pairs** duplicate detection (not just adjacent), more accurate
- Quantized: `dtype: "q8"` — model ~71MB (instead of 284MB full)
- **Required**: `npm install -g @huggingface/transformers`

### LLM Mode (Experimental, Local)

```jsonc
{
  "semantic": {
    "mode": "llm"
  }
}
```

Uses **summarization pipeline** via `@huggingface/transformers` (T5-small):
- Model download ~300MB (q8) on first use
- Latency 1-5s per text block
- Can compress 5-10x for long text
- **Local** — no internet connection or API key needed
- Falls back to NLP if model fails to load
- Default model: `Xenova/t5-small` (can be changed via `semantic.model`)

| Model | Language | Size | Accuracy |
| :--- | :--- | :--- | :--- |
| `Xenova/all-MiniLM-L6-v2` | Multilingual | ~71MB (q8) | ~93% |
| `Xenova/distilbert-base-uncased` | English | ~70MB | ~95% |
| `Xenova/bert-base-multilingual-uncased` | 100+ languages (incl. Indonesian) | ~170MB | ~94% |

### Example Use Case

```jsonc
{
  "semantic": {
    "mode": "nlp",
    "compressAssistantMessages": false,
    "minLengthChars": 500,        // only compress long messages
    "protectCodeBlocks": true,
    "protectErrors": true
  }
}
```

---

## ✂️ Layer 3 — Dynamic Context Pruning (DCP)

The most powerful layer. **Removes old messages from the context window** and replaces them with summaries. The LLM is given autonomy to call `ultrapress_compress`.

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `summarization.enabled` | `boolean` | `true` | Enable Layer 3. |
| `summarization.mode` | `"range"` / `"message"` | `"range"` | Pruning mode: `range` (sequential message block) or `message` (one/several specific IDs). |
| `summarization.maxContextLimit` | `number` | `60000` | Hard limit before compression nudge. |
| `summarization.minContextLimit` | `number` | `35000` | Token target after pruning. |
| `summarization.nudgeFrequency` | `number` | `4` | Show nudge every N turns. |
| `summarization.nudgeThreshold` | `number` | `0.70` | Nudge when context reaches this fraction of maxContextLimit (0-1). |
| `summarization.summaryBuffer` | `boolean` | `true` | Buffer summaries for batch processing. |
| `summarization.showCompression` | `boolean` | `true` | Show compression notifications in output. |
| `summarization.preserveLastN` | `number` | `4` | Do not prune the **last** N messages (0 = disable). Protects current conversation context. |
| `summarization.scoreThreshold` | `number` | `0.45` | Multi-signal importance scoring (0-1). `0` = disable. `0.45` = recommended. Messages with score above threshold are preserved even if in the old block. |

### Workflow

```
1. Context Monitor → detect token > 70% maxContextLimit (pre-emptive)
2. Nudge → insert warning into user prompt (every nudgeFrequency turn)
3. LLM calls → ultrapress_compress(mode="range", from="msg_X", to="msg_Y")
4. Compression Block → stored in memory (not yet executed)
5. Next chat → block executed: remove msg_X through msg_Y, insert summary
6. Original content → stored in plugin memory (not LLM context)
7. LLM can call → ultrapress_expand(block_id=0) to view original content
```

### Multi-Signal Importance Scoring

In addition to `preserveLastN`, each message is scored from 5 signals:
- **Recency** (30%) — newer messages get higher scores (exponential decay)
- **Role** (25%) — user > system > assistant > tool
- **Tool type** (20%) — `write`/`edit`/`bash` > `read`/`grep` > `todowrite`
- **Keywords** (15%) — task words (`implement`, `fix`, `urgent`) score high
- **Content size** (10%) — 50-500 chars ideal, very short/long score low

Activate with `scoreThreshold: 0.45`. Messages with score ≥ threshold are preserved even if old.

### Reversible Compression

`ultrapress_expand` tool — the LLM can "expand" back a summarized block to view the original content. Original content is stored in plugin memory (Node.js heap), **not** in the LLM context window — so 0 token cost until the LLM requests an expand.

### preserveLastN

Protection for recent messages from being removed by pruning. Very important for:

- **Active conversation** — current context stays intact
- **Newly given instructions** — not lost before execution
- **Feedback loop** — latest user corrections remain readable

```jsonc
{
  "summarization": {
    "preserveLastN": 5  // protect the last 5 messages
  }
}
```

> `preserveLastN: 0` = disable recency protection only. Tool-protected content and marker-protected messages can still be preserved.

### Protected Content

The following tool outputs are **automatically protected** from pruning:

- `task` — sub-agent delegation
- `skill` — skill loading/invocation
- `todowrite` / `todoread` — execution-plan continuity
- `write` — file writing
- `edit` — file editing
- `ultrapress_compress` — compression control tool output

In addition to tool protection, messages containing critical markers are preserved to avoid context loss during pruning:

- `TODO`, `FIXME`, `HACK`
- `ACTION ITEM`, `ROOT CAUSE`, `RCA`
- `DECISION`, `DECISION LOG`, `BLOCKER`

### Example Use Case

```jsonc
{
  "summarization": {
    "maxContextLimit": 50000,     // more aggressive — prune at 50k
    "minContextLimit": 30000,     // nudge starts at 30k
    "nudgeFrequency": 3,          // nudge more often
    "preserveLastN": 4
  }
}
```

```jsonc
{
  "summarization": {
    "maxContextLimit": 100000,    // conservative — allow large context
    "minContextLimit": 60000,
    "nudgeFrequency": 8,          // nudge rarely
    "preserveLastN": 6
  }
}
```

---

## 🧹 Layer 4 — Auto Cleanup

Cleans up "junk" from the context window automatically.

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `cleanup.deduplication.enabled` | `boolean` | `true` | Prevent identical repeated tool calls (same tool + args). |
| `cleanup.purgeErrors.enabled` | `boolean` | `true` | Delete error messages automatically after N turns. |
| `cleanup.purgeErrors.turns` | `number` | `4` | Number of turns before an error is removed. |

### Deduplication

Identical tool calls with identical arguments → second output replaced with a short reference:

```
[Duplicate output. See above ↑]
```

- Preserves first call output, references it
- Avoids re-executing identical read/write patterns
- Built-in smart detection for stateful commands (avoids false positives)

### Error Auto-Purge

Error messages more than N turns old are automatically removed from context:

```
[Error purged after 4 turns: <message id>]
```

- Cleans up deprecated errors from old code versions
- Prevents repeated stack traces from consuming window space
- Error contexts already completed by the agent don't need to persist

### Example Use Case

```jsonc
{
  "cleanup": {
    "deduplication": { "enabled": true },
    "purgeErrors": {
      "enabled": true,
      "turns": 3  // remove errors after 3 turns
    }
  }
}
```

---

## Custom Filters

In addition to built-in domain filters, you can define regex-based filters for specific commands.

### `CustomFilter` Shape (actual runtime format)

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `commandPattern` | `string` | ✅ | Regex to match command text (`new RegExp(commandPattern)`) |
| `stripPatterns` | `string[]` | optional | Regex list to remove matching lines |
| `keepPatterns` | `string[]` | optional | Regex list that always wins over `stripPatterns` |
| `maxLines` | `number` | optional | Keep at most N lines after filtering |

### Example — pytest summary

```jsonc
{
  "outputFilter": {
    "customFilters": [
      {
        "commandPattern": "pytest",
        "stripPatterns": ["PASSED"],
        "keepPatterns": ["FAILED", "ERROR", "test session starts"],
        "maxLines": 120
      }
    ]
  }
}
```

### Safety Notes

- If a custom regex is invalid, UltraPress ignores it and writes a debug log.
- Audit logs include matched filter count, removed line count, and max-line trims.
- Keep `keepPatterns` explicit for critical lines to avoid accidental context loss.

---

## Configuration Environment Variables

You can also override configuration via environment variables (highest priority):

| Variable | Config Key | Example |
| :--- | :--- | :--- |
| `ULTRAPRESS_ENABLED` | `enabled` | `"false"` |
| `ULTRAPRESS_NOTIFICATION` | `notification` | `"off"` |
| `ULTRAPRESS_OUTPUT_MAX_CHARS` | `outputFilter.maxCharsPerOutput` | `"4000"` |
| `ULTRAPRESS_SEMANTIC_MODE` | `semantic.mode` | `"nlp"` |
| `ULTRAPRESS_SEMANTIC_MODEL` | `semantic.model` | `"Xenova/all-MiniLM-L6-v2"` |
| `ULTRAPRESS_SUMMARIZATION_ENABLED` | `summarization.enabled` | `"true"` |
| `ULTRAPRESS_MAX_CONTEXT` | `summarization.maxContextLimit` | `"50000"` |
| `ULTRAPRESS_PRESERVE_LAST_N` | `summarization.preserveLastN` | `"5"` |
| `ULTRAPRESS_PURGE_ERRORS` | `cleanup.purgeErrors.enabled` | `"true"` |
| `ULTRAPRESS_PURGE_TURNS` | `cleanup.purgeErrors.turns` | `"3"` |

---

## `/up` Slash Commands

UltraPress adds several `/up` commands to OpenCode for runtime control:

| Command | Function |
| :--- | :--- |
| `/up status` | Display current token count, compression savings, active filters |
| `/up pause` | Pause UltraPress (temporarily disable all layers) |
| `/up resume` | Resume UltraPress after pause |
| `/up expand` | Expand the last compressed block |
| `/up compress` | Enable/verify summarization mode and show compression status/guide |
| `/up config` | Show current configuration (sanitized) |
| `/up prune` | Manually trigger message pruning |

---

## Complete Example Configurations

### Profile Selection Guide

| Environment | Recommended Profile | Notes |
| :--- | :--- | :--- |
| Most users (default) | **Configuration 0 — Balanced** | Best ratio of savings vs context safety |
| Very long sessions, heavy logs | **Configuration A — Aggressive** | Higher savings, more pruning pressure |
| Short/focused sessions, high caution | **Configuration B — Conservative** | Higher context retention, less compression |
| Low-resource devices (Termux/small VPS) | **Configuration C — NLP-Only** | Zero-model runtime, most stable footprint |

### Configuration 0 — Balanced (Default)

Recommended for most users. Good token savings with strong context safety.

```jsonc
{
  "enabled": true,
  "notification": "minimal",

  "outputFilter": {
    "enabled": true,
    "maxCharsPerOutput": 6000,
    "teeSaveOnTruncate": true,
    "customFilters": []
  },

  "semantic": {
    "enabled": true,
    "mode": "nlp",
    "compressUserMessages": true,
    "compressAssistantMessages": false,
    "compressToolOutputs": true,
    "protectCodeBlocks": true,
    "protectErrors": true,
    "minLengthChars": 250
  },

  "summarization": {
    "enabled": true,
    "mode": "range",
    "maxContextLimit": 60000,
    "minContextLimit": 35000,
    "nudgeFrequency": 4,
    "nudgeThreshold": 0.70,
    "summaryBuffer": true,
    "showCompression": true,
    "preserveLastN": 4,
    "scoreThreshold": 0.45
  },

  "cleanup": {
    "deduplication": { "enabled": true },
    "purgeErrors": {
      "enabled": true,
      "turns": 4
    }
  }
}
```

### Configuration A — Aggressive (Max Savings)

For very long sessions (200+ messages), long CLI output.

```jsonc
{
  "enabled": true,
  "notification": "minimal",

  "outputFilter": {
    "enabled": true,
    "maxCharsPerOutput": 3000,
    "teeSaveOnTruncate": true,
    "customFilters": []
  },

  "semantic": {
    "enabled": true,
    "mode": "mlm",
    "model": "Xenova/all-MiniLM-L6-v2",
    "compressUserMessages": true,
    "compressAssistantMessages": false,
    "compressToolOutputs": true,
    "protectCodeBlocks": true,
    "protectErrors": true,
    "minLengthChars": 150
  },

  "summarization": {
    "enabled": true,
    "mode": "range",
    "maxContextLimit": 40000,
    "minContextLimit": 20000,
    "nudgeFrequency": 3,
    "summaryBuffer": false,
    "showCompression": true,
    "preserveLastN": 3,
    "scoreThreshold": 0.40
  },

  "cleanup": {
    "deduplication": { "enabled": true },
    "purgeErrors": {
      "enabled": true,
      "turns": 3
    }
  }
}
```

### Configuration B — Conservative (Minimal Interruption)

For short, focused sessions. Maximum protection for important messages.

```jsonc
{
  "enabled": true,
  "notification": "detailed",

  "outputFilter": {
    "enabled": true,
    "maxCharsPerOutput": 12000,
    "teeSaveOnTruncate": false,
    "customFilters": []
  },

  "semantic": {
    "enabled": true,
    "mode": "nlp",
    "compressUserMessages": false,
    "compressAssistantMessages": false,
    "compressToolOutputs": true,
    "protectCodeBlocks": true,
    "protectErrors": true,
    "minLengthChars": 500
  },

  "summarization": {
    "enabled": true,
    "mode": "range",
    "maxContextLimit": 90000,
    "minContextLimit": 60000,
    "nudgeFrequency": 8,
    "summaryBuffer": false,
    "showCompression": true,
    "preserveLastN": 6,
    "scoreThreshold": 0
  },

  "cleanup": {
    "deduplication": { "enabled": true },
    "purgeErrors": {
      "enabled": true,
      "turns": 6
    }
  }
}
```

### Configuration C — NLP-Only (Zero Latency)

No ML models. No downloads. Works offline.

```jsonc
{
  "enabled": true,
  "notification": "minimal",

  "outputFilter": {
    "enabled": true,
    "maxCharsPerOutput": 6000,
    "teeSaveOnTruncate": false,
    "customFilters": []
  },

  "semantic": {
    "enabled": true,
    "mode": "nlp",
    "compressUserMessages": true,
    "compressAssistantMessages": false,
    "compressToolOutputs": true,
    "protectCodeBlocks": true,
    "protectErrors": true,
    "minLengthChars": 250
  },

  "summarization": {
    "enabled": true,
    "mode": "range",
    "maxContextLimit": 60000,
    "minContextLimit": 35000,
    "nudgeFrequency": 5,
    "nudgeThreshold": 0.70,
    "summaryBuffer": true,
    "showCompression": true,
    "preserveLastN": 4,
    "scoreThreshold": 0.45
  },

  "cleanup": {
    "deduplication": { "enabled": true },
    "purgeErrors": {
      "enabled": true,
      "turns": 4
    }
  }
}
```

---

## JSON Schema

The source of truth is [`ultrapress.schema.json`](../ultrapress.schema.json).

> Keep schema/docs/runtime in sync whenever adding or changing config keys.

---

## TypeScript Interface Reference

```typescript
interface UltraPressConfig {
  enabled: boolean
  notification: "off" | "minimal" | "detailed"
  outputFilter: OutputFilterConfig
  semantic: SemanticConfig
  summarization: SummarizationConfig
  cleanup: CleanupConfig
}

interface OutputFilterConfig {
  enabled: boolean
  maxCharsPerOutput: number
  teeSaveOnTruncate: boolean
  customFilters: CustomFilter[]
}

interface SemanticConfig {
  enabled: boolean
  mode: "nlp" | "mlm" | "llm"
  model?: string
  compressUserMessages: boolean
  compressAssistantMessages: boolean
  compressToolOutputs: boolean
  protectCodeBlocks: boolean
  protectErrors: boolean
  minLengthChars: number
}

interface SummarizationConfig {
  enabled: boolean
  mode: "range" | "message"
  maxContextLimit: number
  minContextLimit: number
  nudgeFrequency: number
  summaryBuffer: boolean
  showCompression: boolean
  preserveLastN: number
  scoreThreshold: number
}

interface CleanupConfig {
  deduplication: { enabled: boolean }
  purgeErrors: { enabled: boolean; turns: number }
}
```

---

## ❓ Configuration Troubleshooting

| Problem | Cause | Solution |
| :--- | :--- | :--- |
| Plugin not active | `enabled: false` | Set `"enabled": true` |
| Important messages deleted | `preserveLastN` too small | Increase to 5-7 |
| OpenCode slow | `mlm` mode + large model | Switch to `"mode": "nlp"` |
| Too many notifications | `enableDebug: true` + `notification: "detailed"` | Set `"enableDebug": false` (recommended) or lower `notification` |
| Errors never disappear | `purgeErrors.turns` too large | Lower to 2-3 |
| All tool calls dedup'd | Stateful commands also get dedup'd | Built-in already handles this. If any are missed, report. |

---

> 💡 **Best Practice**: Start with defaults, then adjust based on usage patterns. For long sessions (>100 messages), lower `maxContextLimit` and increase `preserveLastN`.
