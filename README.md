<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/image/banner.svg">
  <img alt="UltraPress — DCP + Caveman + RTK Token Compression" src="./docs/image/banner.svg" width="100%">
</picture>

# UltraPress — DCP + Caveman + RTK Token Compression

[![npm](https://img.shields.io/npm/v/@tarquinen/opencode-dcp)](https://www.npmjs.com/package/@tarquinen/opencode-dcp)
[![CI](https://github.com/rahadiana/opencode-ultrapress/actions/workflows/ci.yml/badge.svg)](https://github.com/rahadiana/opencode-ultrapress/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A 4-layer token compression plugin for **OpenCode AI**, combining three complementary compression techniques to maximize context retention while minimizing token consumption.

| Technique | Layer | Strategy |
|-----------|-------|----------|
| **DCP** (Dynamic Context Placeholder) | L3 | Compresses stale conversation spans into expandable summaries |
| **Caveman** (Semantic Compression) | L2 | NLP/MLM/LLM-based message reduction preserving meaning |
| **RTK** (Real-Time Truncation) | L1 + L4 | Command-specific output filtering + deduplication |

**Published as**: [`@tarquinen/opencode-dcp`](https://www.npmjs.com/package/@tarquinen/opencode-dcp) on npm  
**Local name**: `@rahadiana/opencode-ultrapress`  
**Requires**: OpenCode AI with plugin support

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Layer Reference](#layer-reference)
  - [L1 — Output Filter (RTK)](#l1--output-filter-rtk)
  - [L2 — Caveman Semantic](#l2--caveman-semantic)
  - [L3 — DCP (Dynamic Context Placeholder)](#l3--dcp-dynamic-context-placeholder)
  - [L4 — Cleanup (RTK)](#l4--cleanup-rtk)
- [Commands](#commands)
- [Hook Reference](#hook-reference)
- [Configuration](#configuration)
- [Custom Tools](#custom-tools)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Further Reading](#further-reading)

---

## Installation

```bash
# === Recommended: install from npm as an OpenCode plugin ===
opencode plugin @tarquinen/opencode-dcp@latest --global

# === Local development / fork ===
git clone https://github.com/rahadiana/opencode-ultrapress.git
cd opencode-ultrapress
npm install
npm run build
# Then add to opencode.json:
#   "plugin": ["/path/to/opencode-ultrapress"]
```

After installation, restart OpenCode and verify:

```
/up stats
```

> **After upgrading**: Rebuild (`npm run build` if local) and restart OpenCode. If caching issues persist, uninstall/reinstall.

---

## Quick Start

```
/up              Toggle compression on/off
/up enable       Enable compression
/up disable      Disable compression
/up config       View current configuration
/up stats        Layer-by-layer statistics
/up config k=v   Set a config value (persisted across restarts)
```

All 4 layers are enabled by default with conservative settings. Run `/up stats` immediately to see your baseline.

---

## Architecture

The plugin registers 5 hooks across the OpenCode lifecycle. Data flows sequentially, each applying a distinct compression strategy:

```
   command.execute.before        tool.execute.after          chat.message
   ┌──────────────────────┐      ┌──────────────────┐       ┌──────────────────────┐
   │ /up command handling │      │ L1 Output Filter │       │ L2 Caveman Semantic  │
   │ Config persistence   │      │ L4 Cleanup       │       │ L3 DCP Compression   │
   │ Version notification │      │ (dedup + purge)  │       │ Token sync           │
   └──────────────────────┘      └──────────────────┘       └──────────────────────┘
                                                                      │
                                                                      ▼
                                             ┌───────────────────────────────────┐
                                             │ experimental.chat.messages       │
                                             │ .transform → Strip injections    │
                                             │ experimental.session.compacting  │
                                             │ → Inject protected context       │
                                             └───────────────────────────────────┘
```

**Full architecture documentation with diagrams**: [`docs/architecture.md`](docs/architecture.md)

---

## Layer Reference

### L1 — Output Filter (RTK)

*Real-time command-specific output truncation.*

**Files**: [`src/layers/layer1-output-filter.ts`](src/layers/layer1-output-filter.ts), [`src/filters/`](src/filters/)  
**Hook**: `tool.execute.after`

Each command type gets a custom filter:

| Command | Strategy |
|---------|----------|
| `bash` (build) | HEADER/SUMMARY/FILES stripped. Keep errors + final status |
| `bash` (docker) | Tags/registry/config stripped. Keep errors + image ID |
| `bash` (grep) | Empty results stripped. Keep total count |
| `git status` | One file per line. Empty sections stripped |
| `git diff` | Only `+`/`-` lines preserved. Unchanged collapsed |
| `git log` | One-liner: `hash date message` |
| `git add/commit/push` | Single-line summary |
| `ls`/`find`/`tree` | Dedup paths, grouped by directory, max 3 per dir |
| `cat` (single file) | Content preserved verbatim |
| Jest/Vitest/Pytest/Cargo/Bun | Failures + summary only. Passing stripped |
| Generic fallback | ANSI stripped, blank lines collapsed, smart truncation (70/25 split) |

When truncated, full output is tee-saved to a temp `.log` file: `[truncated, see path]`.

**Config**: `outputFilter.maxCharsPerOutput` (6000), `skipTools`, `customFilters`

---

### L2 — Caveman Semantic

*NLP-based message compression preserving meaning.*

**Files**: [`src/layers/layer2-caveman.ts`](src/layers/layer2-caveman.ts), [`src/caveman/`](src/caveman/)  
**Hook**: `chat.message`

Three backends:

| Mode | Backend | Dependencies | Speed | Quality |
|------|---------|-------------|-------|---------|
| `nlp` | TF-IDF sentence scoring | None | ~1-5ms | Medium |
| `mlm` | Transformers.js embeddings | `@huggingface/transformers` | ~50-200ms | Good |
| `llm` | LLM summarization | Provider model | ~500ms-2s | Best |

All modes protect code blocks, errors, and short messages.

---

### L3 — DCP (Dynamic Context Placeholder)

*Conversation span compression with expandable summaries.*

**Files**: [`src/layers/layer3-dcp.ts`](src/layers/layer3-dcp.ts), [`src/dcp/`](src/dcp/)  
**Hook**: `chat.message`

Adaptive pipeline:

1. **Context Monitor** — tracks token counts by role
2. **Scorer** — rates messages by purpose, recency, and role
3. **Pruner** — selects stale candidates, groups into batches
4. **Compress State** — generates high-fidelity summaries
5. **Storage** — persists originals for later expansion via `ultrapress_expand`

Token-aware: skips auto-compress when batch < `batchThreshold` (default 5).

Protected (never compressed): system prompts, last N messages (`preserveLastN`), messages with critical keywords.

---

### L4 — Cleanup (RTK)

*Post-filter deduplication and error purging.*

**Files**: [`src/layers/layer4-cleanup.ts`](src/layers/layer4-cleanup.ts), [`src/cleanup/`](src/cleanup/)  
**Hook**: `tool.execute.after` (alongside L1)

| Strategy | Behavior |
|----------|----------|
| **Dedup** | Identical consecutive tool calls collapsed to one |
| **Error Purge** | Stale errors purged after N turns (default 5) |

---

## Commands

All commands prefixed with `/up`:

| Command | Description |
|---------|-------------|
| `/up` | Toggle compression on/off |
| `/up enable` | Enable compression |
| `/up disable` | Disable compression |
| `/up stats` | Full layer-by-layer statistics |
| `/up config` | View current persistent config (JSON) |
| `/up config k=v` | Set config (e.g. `notification=detailed`) |
| `/up schema` | Print JSON config schema |
| `/up notify off` | Disable notifications |
| `/up notify minimal` | Show only major events (default) |
| `/up notify detailed` | Show per-layer notifications |

### Stats Example

```
UltraPress Session Stats
========================
Total Messages  : 140
Sent Messages   : 55
Received        : 85
Total Original  : 670.0k
Total Compressed: 261.9k
Overall Savings : 408.1k (+61%)

-- Layer Breakdown --
L1 (Output Filter)
  120 tools filtered, saved 46.2k
L2 (Semantic)
  30 messages, saved 175.9k
L3 (Summary)
  95 compressions, saved 40.6M (accumulated)
L4 (Cleanup)
  25 tools deduped, saved 61.5k
```

---

## Hook Reference

| Hook | Handles |
|------|---------|
| `command.execute.before` | `/up` commands, config persistence, version check |
| `tool.execute.after` | L1 output filter + L4 cleanup |
| `chat.message` | L2 semantic + L3 DCP compression, token sync, post-command suppression |
| `experimental.chat.messages.transform` | Strip `[analyze-mode]`/`[search-mode]` artifacts |
| `experimental.session.compacting` | Inject protected context during compaction |

---

## Configuration

Full reference: [`docs/konfigurasi-lengkap.md`](docs/konfigurasi-lengkap.md) *(Bahasa Indonesia)*

Config is auto-created at `~/.config/opencode/ultrapress.plugin.json` on first run.

### Defaults

```json
{
  "enabled": true,
  "enableDebug": false,
  "notification": "minimal",
  "outputFilter": {
    "enabled": true, "maxCharsPerOutput": 6000, "teeSaveOnTruncate": true,
    "skipTools": ["task"], "customFilters": []
  },
  "semantic": {
    "enabled": true, "mode": "nlp", "model": "Xenova/all-MiniLM-L6-v2",
    "compressUserMessages": true, "compressAssistantMessages": false,
    "compressToolOutputs": true, "protectCodeBlocks": true,
    "protectErrors": true, "minLengthChars": 250, "skipTools": ["task"]
  },
  "summarization": {
    "enabled": true, "preserveLastN": 4, "scoreThreshold": 0.45,
    "batchThreshold": 5, "maxBatchSize": 12, "contextLines": 3, "memoryLimit": 300
  },
  "cleanup": {
    "enabled": true,
    "deduplication": { "enabled": true },
    "purgeErrors": { "enabled": true, "turns": 5 }
  },
  "commands": { "enabled": true }
}
```

```
/up config outputFilter.maxCharsPerOutput=4000
/up config semantic.mode=llm
/up config summarization.preserveLastN=6
```

---

## Custom Tools

Two tools the LLM can invoke:

| Tool | Usage |
|------|-------|
| `ultrapress_compress(mode, from_id, to_id, message_ids)` | Manually compress a message range or specific IDs |
| `ultrapress_expand(block_id, topic)` | Expand a previously compressed block by ID or topic |

---

## Development

### Source Map

```
src/
  index.ts                  Plugin entry, hook registration
  commands/slash.ts         /up command handler, stats, config setter
  config/                   Schema, defaults, validation
  layers/                   4 compression layer files
  caveman/                  L2: NLP/MLM/LLM implementations
  dcp/                      L3: scorer, pruner, compression, storage, tools
  cleanup/                  L4: dedup, error purge
  filters/                  L1: bash, git, fs, test, generic filters
  utils/                    Logger, token counter
```

### Commands

```
npm install       Install deps (npm lockfile)
npm run lint      Typecheck (tsc --noEmit)
npm test          Unit tests (bun test)
npm run build     Build dist/ (tsup, ESM + d.ts)
npm run benchmark Performance benchmarks
```

### CI/CD

| Workflow | Trigger | Steps |
|----------|---------|-------|
| CI | PR / push | lint -> test -> build |
| Publish | Tag `v*` | CI gates -> npm publish -> GitHub Release |

Version synced from git tag (strip leading `v`). Do not manually publish.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Plugin not loaded | `opencode config get plugin` to verify. Rebuild if local |
| `/up` not working | Restart OpenCode. Check plugin registration |
| L3 not compressing | `summarization.enabled` must be true. Batch must reach threshold |
| L2 MLM/LLM failing | Fall back to `nlp` mode. Install `@huggingface/transformers` |
| Caching issues | `opencode plugin remove @tarquinen/opencode-dcp` then reinstall |

---

## Further Reading

| Document | Description | Language |
|----------|-------------|----------|
| [`docs/architecture.md`](docs/architecture.md) | Architecture overview with diagrams | EN |
| [`docs/konfigurasi-lengkap.md`](docs/konfigurasi-lengkap.md) | Complete configuration reference | ID |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history | EN |
| [`ultrapress.schema.json`](ultrapress.schema.json) | JSON Schema for config | Machine |

---

*Because tokens are expensive, but context is priceless.*

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/image/banner.svg">
  <img alt="UltraPress Banner" src="./docs/image/banner.svg" width="100%">
</picture>
