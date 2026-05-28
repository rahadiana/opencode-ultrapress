# UltraPress Architecture Overview

## What UltraPress aims to solve

When interacting with codebases via OpenCode, every message carries base tokens, and every tool result is concatenated into history. Over a long session, the cumulative token count can exceed the model's context window, causing:

- **Lost context** — earlier instructions, error details, or file contents get dropped
- **Degraded accuracy** — the model starts hallucinating after losing key information
- **Frustrating restarts** — user must manually summarize and start a new session

UltraPress solves this by intercepting output at 4 layers and progressively compressing it.

## How the 4 layers work

Architecture diagram (informal, not pako):

<image width="350" src="./image/banner.svg" alt="UltraPress Banner" />

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OpenCode AI Process                              │
│  ┌───────────┐   ┌──────────────┐   ┌────────────┐   ┌──────────────────┐  │
│  │ L1 Filter │──►│ L2 Caveman   │──►│ L3 DCP     │──►│ L4 Cleanup       │  │
│  │ (output)  │   │ (semantic)   │   │ (compress) │   │ (post-process)   │  │
│  └───────────┘   └──────────────┘   └────────────┘   └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Layer 1 — Output Filter (tool.execute.after)

Intercepts every tool execution result.

- Classifies each tool by name — `bash`, `git`, `read`, `grep`, `glob`, etc.
- Applies a command-specific filter that keeps only the most relevant lines.
- Falls back to generic smart truncation for unrecognised tools.
- When truncation occurs, the full output is tee-saved to a temp file, and the model sees a truncated version with a note reading `[truncated, see path]`.

### Layer 2 — Caveman Semantic (chat.message)

Works on message history after it's stored.

- **NLP** — TF-IDF sentence scoring (default, no dependencies).
- **MLM** — Masked Language Model via Transformers.js embeddings.
- **LLM** — LLM-based summarization.
- Compresses conversation history to 2–3 sentences.
- Protects code blocks (``` fences) and error messages from compression.

### Layer 3 — DCP (Dynamic Context Placeholder) (chat.message)

Compresses stale conversation spans into high-fidelity summaries.

- **Scorer** (`src/dcp/scorer.ts`): Scores each message by purpose (instructional > diagnostic > summary > context), recency, and role.
- **Pruner** (`src/dcp/prune.ts`): Selects stale candidates, groups into batches.
- **Compress State** (`src/dcp/compress-state.ts`): Generates summaries preserving factual information.
- **Storage** (`src/dcp/storage.ts`): Persists original content for expansion via `ultrapress_expand`.
- Token-aware: skips auto-compress when batch < 5 messages.

Protected content (system prompts, recent messages within `preserveLastN`, critical keywords) is never compressed.

### Layer 4 — Cleanup (tool.execute.after)

Post-filter cleanup that runs alongside L1.

- **Dedup** — Consecutive identical tool calls are collapsed into one.
- **Error purge** — Stale error messages older than N turns are removed.
- Keeps things tidy without affecting model-visible output.

## Hook Execution Order

```
1. command.execute.before      → /up command handling + config persistence
2. tool.execute.after          → L1 Output Filter + L4 Cleanup
3. chat.message                → L2 Caveman Semantic + L3 DCP Compression
4. experimental.chat.messages.transform → Strip mode-injection artifacts
5. experimental.session.compacting    → Inject protected context during compaction
```

## Session Stats Tracking

```
totalTokensRaw        = Sum of all raw token counts from L1 and L4
totalTokensCompressed = Sum of all compressed token counts from L1 and L4
savedByLayer.*        = Per-layer tracked savings (filter, semantic, summarization, cleanup)
```

Overall savings:

```
totalSaved  = totalTokensRaw - totalTokensCompressed
overallPct  = (totalSaved / totalTokensRaw) x 100
```

L3 (summarization) savings are tracked in `savedByLayer.summarization` and displayed separately in the `/up stats` breakdown as accumulated savings across all compression rounds. L3 does NOT modify `totalTokensCompressed` — that counter reflects only L1/L4 compression.

## File Map

```
src/
├── index.ts                    # Plugin entry, hook registration
├── commands/slash.ts           # /up command handler + stats display
├── config/                     # Schema, defaults, validation
├── layers/                     # 4 compression layers
├── caveman/                    # L2: NLP/MLM/LLM implementations
├── dcp/                        # L3: scorer, pruner, compression, storage
├── cleanup/                    # L4: dedup + purge
├── filters/                    # L1: command-type filters
└── utils/                      # Logger, token counter
```
