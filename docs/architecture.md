# Architecture — OpenCode UltraPress

## Pipeline Overview

Data from every interaction in OpenCode flows through 4 defense layers sequentially. Important: each layer runs on a **different hook**, not within a single pipeline.

```mermaid
flowchart LR
    subgraph OpenCode Runtime
        A([Tool Execution]) -->|"tool.execute.after"| L1
        B([Chat Message]) -->|"chat.message"| L2
        B -->|"chat.message"| L3
        C([Session Compacting]) -->|"experimental.session.compacting"| L4_compact
    end

    subgraph L1["Layer 1 — Output Filter"]
        direction TB
        L1A[Detect command type\ngit/npm/pytest/etc] --> L1B[Apply domain filter\nstrip boilerplate]
        L1B --> L1C[Middle-out truncate\nif > maxChars]
    end

    subgraph L2["Layer 2 — GSC Semantic"]
        direction TB
        L2A[Check role & config] --> L2B{Mode?}
        L2B -->|nlp| L2C[Grammar Stripping\nRule-based]
        L2B -->|mlm| L2D[AI Tokenizer\nEXPERIMENTAL]
        L2C & L2D --> L2E[Return compressed\nor original if no savings]
    end

    subgraph L3["Layer 3 — DCP Monitor"]
        direction TB
        L3A[Count tokens\nin current message] --> L3B{Above threshold?}
        L3B -->|yes| L3C[Inject nudge prompt\nto user message]
        L3B -->|no| L3D[Pass through]
    end

    subgraph L4_compact["Layer 4 — Session Cleanup"]
        direction TB
        L4A[Auto error purge\nafter N turns] --> L4B[Dedup repeated\ntool outputs]
    end

    L1 -->|filtered output| OpenCode_Context[(OpenCode\nContext Window)]
    L2 -->|compressed message| OpenCode_Context
    L3 -->|nudge injected| OpenCode_Context
    L4_compact -->|protected context| OpenCode_Context
```

---

## Execution Order Per Hook

### `tool.execute.after`
1. **Layer 1** — Filter raw tool output before it enters the context window.
2. **Layer 4 (Dedup)** — Check if output is identical to previous; if yes, remove.

### `chat.message`
1. **Layer 3 (DCP)** — Count cumulative token estimate. If approaching limit, inject nudge prompt.
2. **Layer 2 (GSC Semantic)** — Semantic compression on user/assistant messages that pass role filter & minimum length.
3. **Layer 4 (Purge)** — Mark old error messages for removal after N turns.

### `experimental.session.compacting` _(if OpenCode supports this hook)_
- **Layer 3 (Protected Context)** — Inject protected summary so it won't be lost when OpenCode performs auto-compaction.

---

## Why There Is No Double Compression?

Layer 2 and Layer 3 **do not compress each other** because:

1. **Layer 2** operates on **individual message text** (user message or assistant response).
2. **Layer 3** only **counts tokens** and inserts new nudge text — it does not re-compress existing text.
3. Layer 3 declares `ultrapress_compress` as a **tool for the LLM** (not auto-compression). The LLM autonomously calls that tool, not the UltraPress system.

---

## Error Handling Strategy

| Layer | Behavior on Error |
| :--- | :--- |
| Layer 1 | Fallback to raw output — **never crashes** |
| Layer 2 (NLP) | Fallback to original text — compression considered failed, session continues normally |
| Layer 2 (MLM) | Fallback to NLP mode — model fails to load, but session keeps running |
| Layer 3 | Skip nudge — no side effects |
| Layer 4 | Skip purge — old messages remain |

All layers use a `try/catch` pattern that returns the original input (*passthrough*) on failure.

---

## Known Limitations

- **MLM mode** currently uses the model as a more accurate tokenizer, not for full inference. This is an **EXPERIMENTAL** feature. See [MLM Mode](#mlm-mode-experimental) in README.
- Token counting uses character-based heuristics (3.7 chars/token for prose), not `tiktoken`. ~85-90% accuracy for mixed English/code.
- The `tool.execute.after` hook only fires if OpenCode calls a tool through the agent loop — does not apply to manual messages.
