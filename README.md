# UltraPress — 4-Layer Token Compression for OpenCode AI

UltraPress is an OpenCode AI plugin that compresses conversation context in real-time using a 4-layer pipeline. It intercepts tool outputs, chat messages, and compaction events to reduce token consumption without losing critical information.

---

## Quick Start

```
# In OpenCode chat:
/up enable          # Enable compression
/up stats           # View compression statistics
/up config          # View current configuration
```

### Installation

```bash
# From npm (published package)
npm install -g @rahadiana/opencode-ultrapress
# Then add to opencode.json as a plugin

# From local clone
cd opencode-ultrapress
npm install
npm run build
# Add as local plugin in opencode.json:
# { "type": "plugin", "path": "/path/to/opencode-ultrapress" }
```

> **Note**: After upgrading, run `npm run build` and restart OpenCode. If OpenCode caches the old plugin, clear the cache or reinstall.

### Build / Test Commands

```bash
npm install       # Install deps (npm lockfile)
npm run lint      # Typecheck (tsc --noEmit)
npm test          # Run tests (bun test)
npm run build     # Build dist/ (tsup, ESM + d.ts)
npm run benchmark # Run benchmarks (tsx benchmarks/run.ts)
```

---

## Architecture

### Pipeline: L1 Filter → L2 Semantic → L3 DCP → L4 Cleanup

Each layer targets a different compression opportunity:

| Layer | Hook | What It Does |
|-------|------|--------------|
| **L1** Output Filter | `tool.execute.after` | Truncates & filters tool output (command-specific) |
| **L2** Semantic | `chat.message` | NLP scoring & compression of conversation messages |
| **L3** DCP | `chat.message` | Compresses stale message spans into summaries |
| **L4** Cleanup | `tool.execute.after` | Deduplicates identical tool calls, purges stale errors |

### Hook Registration (`src/index.ts`)

```
command.execute.before          → /up command + config persistence
tool.execute.after              → L1 filtering + L4 cleanup
chat.message                    → Token sync + L2/L3 + post-command suppression
experimental.chat.messages.transform → Strip mode-injection artifacts
experimental.session.compacting → Inject protected context during compaction
```

Custom tools registered: `ultrapress_compress`, `ultrapress_expand`

---

## Layer Details

### L1 — Output Filter (`src/layers/layer1-output-filter.ts`)

Intercepts tool outputs and applies command-specific filters:

- **Bash**: Detects build/docker/grep/generic commands — keeps only errors, warnings, final status
- **Git**: `status` → compact file list, `diff` → changed lines only, `log` → one-liners, `add/commit/push` → summary
- **Filesystem**: `ls/find/tree/cat` — dedup, group by directory, limit per file
- **Test runners**: Jest/Vitest/Pytest/Cargo/Bun — failures + summary only, strips pass lines
- **Generic fallback**: Strip ANSI, dedup lines, collapse blanks, smart truncate (head 70% + tail 25%)

Config: `maxCharsPerOutput` (default 6000), `skipTools`, `teeSaveOnTruncate`, custom regex filters.

### L2 — Semantic (`src/layers/layer2-caveman.ts`, `src/caveman/`)

NLP-based compression with 3 modes:

| Mode | Backend | When to Use |
|------|---------|-------------|
| `nlp` | TF-IDF sentence scoring (no deps) | Fast, on-device, ~1ms |
| `mlm` | Transformers.js embeddings | Better semantic preservation |
| `llm` | LLM-based summarization | Highest quality, slowest |

All modes protect code blocks (``` fences) and error messages from compression.

### L3 — DCP (`src/layers/layer3-dcp.ts`, `src/dcp/`)

Adaptive context compression. Decides WHEN to compress via:

1. **Scorer** (`scorer.ts`): Scores each message by purpose, recency, and role
2. **Pruner** (`prune.ts`): Selects stale candidates, groups into batches
3. **Compress State** (`compress-state.ts`): Generates high-fidelity summaries
4. **Storage** (`storage.ts`): Persists compressed content for expansion via `ultrapress_expand`

Token-aware: auto-compress only when batch ≥ 5 messages to avoid wasting tokens on tiny blocks.

### L4 — Cleanup (`src/layers/layer4-cleanup.ts`)

Post-filter cleanup: deduplicates consecutive identical tool calls, purges stale error messages after N turns.

---

## Commands

All commands are prefixed with `/up`:

| Command | Description |
|---------|-------------|
| `/up` | Toggle compression on/off |
| `/up enable` | Enable compression |
| `/up disable` | Disable compression |
| `/up stats` | Show layer-by-layer compression statistics |
| `/up config [key=value ...]` | View or set config (persisted across sessions) |
| `/up schema` | Print JSON config schema |
| `/up notify [off\|minimal\|detailed]` | Set notification level |

### Stats Display Example

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

## Configuration

Config is persisted in `~/.config/opencode/ultrapress/storage/config.json`.

```json
{
  "enabled": true,
  "enableDebug": false,
  "outputFilter": {
    "enabled": true,
    "maxCharsPerOutput": 6000,
    "teeSaveOnTruncate": true,
    "skipTools": ["task"],
    "customFilters": []
  },
  "semantic": {
    "enabled": true,
    "mode": "nlp",
    "model": "",
    "compressUserMessages": true,
    "compressAssistantMessages": true,
    "compressToolOutputs": true,
    "protectCodeBlocks": true,
    "protectErrors": true,
    "skipTools": ["task"]
  },
  "summarization": {
    "enabled": true,
    "minMessagesForCompression": 10,
    "batchThreshold": 5,
    "maxBatchSize": 12,
    "contextLines": 3,
    "memoryLimit": 300
  },
  "cleanup": {
    "enabled": true,
    "deduplication": { "enabled": true },
    "purgeErrors": { "enabled": true, "turns": 5 }
  },
  "commands": { "enabled": true },
  "notification": "minimal"
}
```

Set via `/up config`:

```
/up config outputFilter.maxCharsPerOutput=4000
/up config semantic.mode=llm
/up config notification=detailed
```

Full schema: `ultrapress.schema.json`

---

## Development History (Changelog)

| Version | Date | Changes |
|---------|------|---------|
| 0.2.14 | May 28, 2026 | Rewrote README, stats display fix (remove hardcoded `−`), fix L3 stats corrupting totalTokensCompressed |
| 0.2.13 | May 28, 2026 | L3 token-aware threshold (skip batch < 5), externalize @huggingface/transformers, auto-check npm for newer version |
| 0.2.11 | May 28, 2026 | Separate plugin config to `ultrapress.plugin.json`, auto-migration from old `ultrapress.json` |
| 0.2.10 | May 28, 2026 | Transformers optional (optionalDependencies), auto-install fallback, config migration on upgrade |
| 0.2.9 | May 27, 2026 | Fix scoreThreshold default mismatch (synced code to 0.45) |
| 0.2.8 | May 27, 2026 | Multi-session stats, subagent usage tracking, npm publish CI |
| 0.2.7 | May 26, 2026 | Broaden `/up` follow-up suppression, strip AI-slop pattern injections |
| 0.2.6 | May 25, 2026 | `enableDebug` toggle, MLM/LLM logger routing, `/up` handler stabilization |
| 0.2.5 | May 23, 2026 | No functional changes — version bumped to align npm with git |
| 0.2.4 | May 23, 2026 | Balanced defaults (preserveLastN: 4, scoreThreshold: 0.45), critical context protection, ONNX thread fix, config validation hardening |
| 0.2.3 | May 22, 2026 | Schema guard, ONNX dispose fix, migration fix |
| 0.2.2 | May 21, 2026 | Session resume fix, DCP tool integration, init script fix |
| 0.2.1 | May 20, 2026 | Command fix, system prompt injection, session stats tracking |
| 0.2.0 | May 19, 2026 | SemVer reset, L4 cleanup, config refactor, public README |
| 0.1.0 | Mar 2026 | Initial: 4-layer pipeline, L1/L2/L3 core, DCP scorer/pruner, /up commands, private alpha |

---

## File Map

```
src/
├── index.ts                        # Plugin entry, hook registration
├── commands/
│   └── slash.ts                    # /up command handler + stats display
├── config/
│   ├── defaults.ts                 # Default configuration values
│   ├── schema.ts                   # TypeScript types & runtime schema
│   └── validate.ts                 # Config sanitization & validation
├── layers/
│   ├── layer1-output-filter.ts     # L1: Tool output filtering
│   ├── layer2-caveman.ts           # L2: Semantic compression
│   ├── layer3-dcp.ts               # L3: DCP conversation compression
│   └── layer4-cleanup.ts           # L4: Dedup & error purge
├── caveman/
│   ├── nlp.ts                      # TF-IDF sentence scoring
│   ├── mlm.ts                      # Transformers.js embeddings
│   ├── llm.ts                      # LLM-based summarization
│   ├── rules.ts                    # Compression rules & heuristics
│   └── facts.ts                    # Fact extraction utilities
├── dcp/
│   ├── scorer.ts                   # Message importance scoring
│   ├── prune.ts                    # Stale message selection
│   ├── compress-state.ts           # Summary generation logic
│   ├── compress-tool.ts            # ultrapress_compress tool
│   ├── expand-tool.ts              # ultrapress_expand tool
│   ├── storage.ts                  # Compressed content persistence
│   ├── context-monitor.ts          # Context size monitoring
│   └── protected-content.ts        # Content protection during compression
├── cleanup/
│   ├── dedup.ts                    # Consecutive identical tool call dedup
│   └── purge-errors.ts             # Stale error message purging
├── filters/
│   ├── bash.ts                     # Shell command output filters
│   ├── git.ts                      # Git command output filters
│   ├── fs.ts                       # Filesystem command filters
│   ├── test.ts                     # Test runner output filters
│   └── generic.ts                  # Universal smart filter
└── utils/
    ├── logger.ts                   # Debug logging
    └── token-count.ts              # Token counting (tiktoken-like)
```

---

## Project Files

| File | Purpose |
|------|---------|
| `package.json` | ESM package, `main`/`types` point to `dist/` |
| `tsconfig.json` | Strict TypeScript config |
| `tsup.config.ts` | Build config (ESM + d.ts) |
| `ultrapress.schema.json` | Full JSON schema for config |
| `AGENTS.md` | Agent context for AI-assisted development |
| `CHANGELOG.md` | Version history |
| `.github/workflows/ci.yml` | CI: lint → build → test |
| `.github/workflows/publish.yml` | npm publish (CI-gated + manual dispatch) |
| `benchmarks/run.ts` | Layer-by-layer performance benchmarks |
| `docs/konfigurasi-lengkap.md` | Full config documentation |
