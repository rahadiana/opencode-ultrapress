# UltraPress / DCP — Token Compression for OpenCode AI

A 4-layer token compression plugin for OpenCode AI. Intercepts tool outputs, chat messages, and session compaction events to reduce token consumption without sacrificing information fidelity.

**Published as**: `@tarquinen/opencode-dcp` on npm  
**Local moniker**: UltraPress (`@rahadiana/opencode-ultrapress`)  
**Requires**: OpenCode AI with plugin support

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Layer Reference](#layer-reference)
  - [L1 — Output Filter (command-specific truncation)](#l1--output-filter)
  - [L2 — Caveman Semantic (NLP/MLM/LLM compression)](#l2--caveman-semantic)
  - [L3 — DCP (Dynamic Context Placeholder)](#l3--dcp-dynamic-context-placeholder)
  - [L4 — Cleanup (dedup + error purge)](#l4--cleanup)
- [Commands](#commands)
- [Hook Map](#hook-map)
- [Configuration Reference](#configuration-reference)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Change History](#change-history)

---

## Installation

```bash
# === Published package (recommended) ===
opencode plugin @tarquinen/opencode-dcp@latest --global

# === Local development / fork ===
git clone https://github.com/rahadiana/opencode-ultrapress.git
cd opencode-ultrapress
npm install
npm run build
# Then add to opencode.json:
#   "plugin": ["/path/to/opencode-ultrapress"]
```

After installation, restart OpenCode. Verify with:

```
/up stats
```

> **After upgrading**: Rebuild (`npm run build` if local) and restart OpenCode. If OpenCode caches the old plugin version, clear your config cache or uninstall/reinstall.

---

## Quick Start

```
/up                  # Toggle compression on/off
/up enable           # Enable compression (if disabled)
/up config           # View current configuration
/up stats            # Layer-by-layer compression statistics
```

By default, all 4 layers are enabled with conservative settings:
- L1 truncates tool outputs >6000 chars
- L2 compresses conversation messages with TF-IDF scoring (nlp mode)
- L3 compresses stale message spans into summaries (batch ≥5)
- L4 deduplicates identical tool calls and purges stale errors

---

## Architecture Overview

The plugin registers 4 hooks across the OpenCode lifecycle. Data flows sequentially through these hooks, each applying a specific compression strategy:

```
User input
    │
    ▼
command.execute.before  ───  /up command interception + config persistence
    │
    ▼
tool.execute.after      ───  L1: Output filter (truncate + filter cmd output)
                         ───  L4: Cleanup (dedup identical tool calls, purge errors)
    │
    ▼
chat.message            ───  L2: Semantic compression (NLP/MLM/LLM)
                         ───  L3: DCP placeholder compression
                         ───  Token sync + post-command suppression
    │
    ▼
experimental.chat.messages.transform  ───  Strip mode-injection artifacts
    │
    ▼
experimental.session.compacting       ───  Inject protected context during compaction
    │
    ▼
Model receives compressed context
```

### Compression Pipeline Per Layer

```
              L1                  L2                  L3                  L4
Tool Output ─────► Truncate ─────► (semantic) ─────► DCP Summary ─────► Dedup
                      │               │                  │                  │
                      ▼               ▼                  ▼                  ▼
                100 chars      20 tokens            "summary:   First unique
                "build OK"     compress              build fix"   tool call only
```

### Token Flow Accounting

Stats are tracked by hook:

| Source | `totalTokensRaw` | `totalTokensCompressed` | `savedByLayer.*` |
|--------|:---:|:---:|:---:|
| L1 (tool.execute.after) | +raw | +compressed | +saved |
| L2 (chat.message) | — | — | +saved |
| L3 (chat.message) | — | — | +saved (accumulated) |
| L4 (tool.execute.after) | +raw | +compressed | +saved |

L3 savings are accumulated across all compression rounds (not current session state) because L3 compresses chat messages from session storage that have already been counted by L1/L2. Use `/up stats` to view the breakdown.

---

## Layer Reference

### L1 — Output Filter

**File**: `src/layers/layer1-output-filter.ts`  
**Hooks into**: `tool.execute.after`

Applies command-specific output filtering. Each command type has a custom filter:

| Command Pattern | Filter Behavior |
|----------------|-----------------|
| `bash` (build) | Strip HEADER/SUMMARY/FILES, keep errors + final status line |
| `bash` (docker) | Strip tags/registry/config, keep errors + image ID |
| `bash` (grep) | Strip empty results, keep total count |
| `git status` | Compact to 1 file per line, strip empty sections |
| `git diff` | Only changed lines (`+`/`-`), collapse unchanged |
| `git log` | One-liner format: `hash date message` |
| `git add/commit/push` | Single-line summary |
| `ls/find/tree/cat` | Dedup paths, group by directory, max 3 files per dir |
| `cat` (single file) | Keeps content verbatim |
| Jest/Vitest/Pytest/Cargo/Bun | Only failures + summary line, strip passing tests |
| **Generic fallback** | Strip ANSI escape codes, dedup consecutive blank lines, collapse repeating non-blank lines, smart truncate (head 70% + tail 25%) |

**Config**: `outputFilter.maxCharsPerOutput`, `outputFilter.skipTools`, `outputFilter.teeSaveOnTruncate`, `outputFilter.customFilters`

### L2 — Caveman Semantic

**File**: `src/layers/layer2-caveman.ts`  
**Hooks into**: `chat.message`

NLP-based message compression. Three backends, selectable via `semantic.mode`:

| Mode | Backend | Dependencies | Speed | Quality |
|------|---------|-------------|------|---------|
| `nlp` | TF-IDF + sentence scoring | None (pure JS) | ~1–5ms | Medium |
| `mlm` | Transformers.js embeddings | `@huggingface/transformers` (optional) | ~50–200ms | Good |
| `llm` | LLM-based summarization | Provider model | ~500ms–2s | Best |

All modes protect:
- Code blocks (``` fences) — never compressed
- Error messages — preserved verbatim
- URLs and file paths — kept intact

### L3 — DCP (Dynamic Context Placeholder)

**File**: `src/layers/layer3-dcp.ts`  
**Hooks into**: `chat.message`

Adaptive conversation compression. Decides **when** to compress based on session state:

1. **Context Monitor** (`src/dcp/context-monitor.ts`): Tracks token counts per role (user/assistant/tool)
2. **Scorer** (`src/dcp/scorer.ts`): Scores each message by:
   - **Purpose**: instructional > diagnostic > summary > context
   - **Recency**: older = more compressible
   - **Role**: tool outputs compress more aggressively than user messages
3. **Pruner** (`src/dcp/prune.ts`): Selects stale messages, groups into batches of configurable size
4. **Compression** (`src/dcp/compress-state.ts`): Generates high-fidelity summaries preserving factual information
5. **Storage** (`src/dcp/storage.ts`): Persists original content for expansion via `ultrapress_expand` custom tool

Token-aware: skips auto-compress when batch size < 5 messages (configurable via `summarization.batchThreshold`).

Protected content (from `src/dcp/protected-content.ts`):
- System prompts
- Recent messages (`preserveLastN`)
- Messages with critical keywords (errors, configs, etc.)

### L4 — Cleanup

**File**: `src/layers/layer4-cleanup.ts`  
**Hooks into**: `tool.execute.after`

Two sub-strategies:

1. **Dedup** (`src/cleanup/dedup.ts`): Detects identical consecutive tool calls (same tool + same output) and collapses to one. Useful when retries produce identical diagnostic output.
2. **Error Purge** (`src/cleanup/purge-errors.ts`): After N turns (configurable), removes stale error/exception messages that are no longer relevant to the current conversation flow.

---

## Commands

All commands are prefixed with `/up`:

| Command | Description |
|---------|-------------|
| `/up` | Toggle compression on/off |
| `/up enable` | Enable compression |
| `/up disable` | Disable compression |
| `/up stats` | Layer-by-layer compression statistics |
| `/up config` | View current configuration (JSON) |
| `/up config <key>=<value> [...]` | Set configuration values (persisted across restarts) |
| `/up schema` | Print full JSON schema for config |
| `/up notify off` | Disable all compression notifications |
| `/up notify minimal` | Show only errors and major events (default) |
| `/up notify detailed` | Show per-layer compression notifications |

### Config via `/up config`

```
/up config outputFilter.maxCharsPerOutput=4000
/up config semantic.mode=llm
/up config summarization.preserveLastN=6
/up config notification=detailed
```

### Stats Output

```
UltraPress Session Stats
========================
Total Messages  : 140
Sent Messages   : 55
Received        : 85
Total Original  : 670.0k
Total Compressed: 261.9k
Overall Savings : 408.1k (+61%)

── Layer Breakdown ──
L1 (Output Filter)
  120 tools filtered, saved 46.2k
L2 (Semantic)
  30 messages, saved 175.9k
L3 (Summary)
  95 compressions, saved 40.6M (accumulated)
L4 (Cleanup)
  25 tools deduped, saved 61.5k

Total Tool Calls Filtered  : 120
Total Semantic Compressions: 30
Total DCP Compressions     : 95
Total Deduplications       : 25

real session tokens may vary due to repeated compression by platform
```

---

## Hook Map

### Hook Registration Order (`src/index.ts`)

```
1. command.execute.before
   └─ Handles: /up, /up enable, /up disable, /up stats, /up config, /up schema, /up notify
   └─ Side effect: Creates ~/.config/opencode/ultrapress/storage/config.json on first /up
   └─ Side effect: Notifies if npm has a newer version available

2. tool.execute.after
   └─ Runs L1 (output filter) on every tool execution
   └─ Runs L4 cleanup (dedup identical tool calls, purge stale errors)
   └─ Tracks: totalTokensRaw += rawTokens, totalTokensCompressed += compressedTokens (for L1/L4)
   └─ Skips tools listed in outputFilter.skipTools (default: ["task"])

3. chat.message { role: any }
   └─ Token sync: captures sent/received statistics
   └─ L2 (semantic): compresses user/assistant/messages when configured
   └─ L3 (DCP): checks if context needs compaction, runs scorer + pruner + compress
   └─ Post-command suppression: prevents model from following up on /up commands

4. experimental.chat.messages.transform
   └─ Strips [analyze-mode] and [search-mode] injection patterns from messages
   └─ Important: avoid message structure mutations — prior attempts caused "failed send command"

5. experimental.session.compacting
   └─ Injects protected context (recent messages, critical instructions) during platform compaction
   └─ Appends session stats summary (original + compressed tokens) to protected context
```

### Custom Tools

| Tool | Description |
|------|-------------|
| `ultrapress_compress` | Manually compress a range or specific messages (mode: range/message) |
| `ultrapress_expand` | Expand a previously compressed block by block_id or topic |

---

## Configuration Reference

Config is stored in `~/.config/opencode/ultrapress/storage/config.json`. Full JSON schema: `ultrapress.schema.json`.

### Root Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Master toggle for all compression |
| `enableDebug` | boolean | `false` | Enable verbose debug logging to console |
| `notification` | string | `"minimal"` | Notification level: `off`, `minimal`, `detailed` |

### `outputFilter` (L1)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable L1 filtering |
| `maxCharsPerOutput` | number | `6000` | Max chars before truncation |
| `teeSaveOnTruncate` | boolean | `true` | Save full output to temp file when truncated |
| `skipTools` | string[] | `["task"]` | Tool names to skip filtering |
| `customFilters` | array | `[]` | Custom regex filters: `{ name, pattern, strip?: bool, keep?: bool, maxLines?: number }` |

### `semantic` (L2)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable L2 semantic compression |
| `mode` | string | `"nlp"` | Backend: `nlp`, `mlm`, or `llm` |
| `model` | string | `""` | Model name for MLM/LLM modes |
| `compressUserMessages` | boolean | `true` | Compress user messages |
| `compressAssistantMessages` | boolean | `true` | Compress assistant messages |
| `compressToolOutputs` | boolean | `true` | Compress tool output messages |
| `protectCodeBlocks` | boolean | `true` | Preserve code blocks verbatim |
| `protectErrors` | boolean | `true` | Preserve error messages verbatim |
| `skipTools` | string[] | `["task"]` | Tool outputs to skip |

### `summarization` (L3 / DCP)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable L3 DCP compression |
| `preserveLastN` | number | `4` | Preserve last N messages from compression |
| `scoreThreshold` | number | `0.45` | Score threshold (0–1). Higher = fewer messages compressed |
| `batchThreshold` | number | `5` | Min messages before auto-compress kicks in |
| `maxBatchSize` | number | `12` | Max messages per compression batch |
| `contextLines` | number | `3` | Context lines preserved around compressed spans |
| `memoryLimit` | number | `300` | Max stored compressed blocks |

### `cleanup` (L4)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable L4 cleanup |
| `deduplication.enabled` | boolean | `true` | Dedup identical consecutive tool calls |
| `purgeErrors.enabled` | boolean | `true` | Purge stale error messages |
| `purgeErrors.turns` | number | `5` | Turns before stale errors get purged |

### Config Validation Rules

Applied in `src/config/validate.ts`:

- `maxCharsPerOutput`: clamped to [500, 100000]
- `preserveLastN`: integer, min 0
- `scoreThreshold`: float, clamped to [0, 1]
- `batchThreshold`: integer, min 1
- `maxBatchSize`: integer, min `batchThreshold + 1`
- All `enabled` keys: coerced to boolean
- Unknown keys: stripped with warning
- Missing keys: filled from defaults

---

## Development

### Source Map

```
src/
├── index.ts                        # Plugin entry, hook registration (single exports default)
├── commands/
│   └── slash.ts                    # /up command handler, buildStatsResponse, config setter
├── config/
│   ├── defaults.ts                 # Default config values
│   ├── schema.ts                   # TypeScript interfaces (UltraConfig, each layer config)
│   └── validate.ts                 # Config sanitization, clamping, fallback
├── layers/
│   ├── layer1-output-filter.ts     # L1: command-type-aware output truncation + filtering
│   ├── layer2-caveman.ts           # L2: NLP-based semantic message compression
│   ├── layer3-dcp.ts               # L3: DCP conversation span compression
│   └── layer4-cleanup.ts           # L4: tool call dedup + error purge
├── cleanup/
│   ├── dedup.ts                    # Consecutive identical tool call deduplication
│   └── purge-errors.ts             # Stale error/exception message purging
├── caveman/
│   ├── nlp.ts                      # TF-IDF sentence scoring for compression
│   ├── mlm.ts                      # Transformers.js embedding-based compression
│   ├── llm.ts                      # LLM-based summarization via provider model
│   ├── rules.ts                    # Compression rules & heuristics
│   └── facts.ts                    # Fact extraction and preservation
├── dcp/
│   ├── scorer.ts                   # Message importance scoring (purpose, recency, role)
│   ├── prune.ts                    # Stale message selection and batch grouping
│   ├── compress-state.ts           # Summary generation from message batches
│   ├── compress-tool.ts            # ultrapress_compress custom tool handler
│   ├── expand-tool.ts              # ultrapress_expand custom tool handler
│   ├── storage.ts                  # Compressed block persistence
│   ├── context-monitor.ts          # Session token count tracking
│   └── protected-content.ts        # Content preservation rules during compression
├── filters/
│   ├── bash.ts                     # Shell command output filter
│   ├── git.ts                      # Git command output filter
│   ├── fs.ts                       # Filesystem command output filter
│   ├── test.ts                     # Test runner output filter (jest/vitest/pytest/cargo/bun)
│   └── generic.ts                  # Universal smart truncation filter
├── utils/
│   ├── logger.ts                   # Namespaced debug logging
│   └── token-count.ts              # Token counting (tiktoken-like heuristic)
└── tests/                          # (see tests/ directory at repo root)

tests/
├── layer3-dcp.test.ts              # L3 scorer, pruner, compress-unit tests
└── regression.test.ts              # End-to-end regression tests
```

### Quick Commands

```bash
npm install          # Install dependencies (uses npm lockfile)
npm run lint         # TypeScript typecheck (tsc --noEmit)
npm test             # Run unit tests (bun test)
npm run build        # Build dist/ — ESM + .d.ts declarations (tsup)
npm run benchmark    # Run layer-by-layer performance benchmarks (tsx benchmarks/run.ts)
```

**Verification order**: `npm run lint` → `npm test` → `npm run build`

### Adding a Config Key

To add a new configuration parameter, update **all 4** of:

1. `src/config/schema.ts` — TypeScript interface
2. `src/config/defaults.ts` — Default value
3. `ultrapress.schema.json` — JSON Schema definition
4. `docs/konfigurasi-lengkap.md` — Full documentation (Indonesian)

### CI/CD

| Workflow | File | Trigger | Actions |
|----------|------|---------|---------|
| CI | `.github/workflows/ci.yml` | PR / push to main | `lint` → `test` → `build` |
| Publish | `.github/workflows/publish.yml` | Tag `v*` | CI gates → `npm publish` → GitHub Release |

The publish workflow syncs version from the git tag (strip leading `v`). Do not manually `npm publish` — let CI handle it.

### Test / Benchmark Quirks

- Unit tests run with **Bun** — Node-only checks may miss failures
- `benchmarks/run.ts` is fixture-driven and measures each layer independently (not chained pipeline)
- `npm run lint` is `tsc --noEmit` — strict TypeScript checking

---

## Troubleshooting

### Plugin Not Loading

```
# Verify plugin is registered:
opencode config get plugin

# Verify plugin directory exists (local installs):
ls ~/.config/opencode/plugins/

# Check for build errors:
cd /path/to/opencode-ultrapress
npm run build
```

### `/up` Commands Not Working

- Ensure the plugin is registered in `opencode.json`'s `"plugin"` array
- Restart OpenCode after adding/removing a plugin
- If seeing "failed send command", ensure you're not mutating message structure in hook handlers

### Stats Show Negative Savings

- This was a display bug in versions <0.2.14 where `−` was hardcoded in the percentage display
- Also fixed: L3 stats no longer corrupt `totalTokensCompressed` (previously decremented to 0)
- Update to latest version and restart OpenCode

### L3 Not Compressing

- Check `summarization.enabled` is true
- Check `summarization.batchThreshold` — auto-compress only runs when pending messages ≥ threshold (default 5)
- Protected messages (`preserveLastN`) are never compressed
- Use `ultrapress_compress` manually to force compression

### L2 MLM/LLM Mode Not Working

- MLM requires `@huggingface/transformers` in node_modules (optional dependency)
- LLM requires an active provider model in OpenCode
- Fall back to `nlp` mode if dependencies are missing

### Cache / Stale Plugin

After upgrading, if OpenCode doesn't pick up changes:
```bash
# Reinstall plugin
opencode plugin remove @tarquinen/opencode-dcp
opencode plugin @tarquinen/opencode-dcp@latest --global
```

## Further Reading

- **Architecture**: [`docs/architecture.md`](docs/architecture.md) — detailed architecture diagrams and overview
- **Config Reference**: [`docs/konfigurasi-lengkap.md`](docs/konfigurasi-lengkap.md) — full configuration documentation (Indonesian)
- **Changelog**: [`CHANGELOG.md`](CHANGELOG.md) — complete version history
- **Source Code**: [GitHub](https://github.com/rahadiana/opencode-ultrapress)
