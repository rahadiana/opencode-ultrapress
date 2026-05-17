# AGENTS.md — Context for AI Agents

This file provides structured context for AI agents (OpenCode, Claude, Cursor, Copilot, etc.) auditing, contributing to, or working with this codebase.

## Project Identity

- **Name**: UltraPress (`@rahadiana/opencode-ultrapress`)
- **Purpose**: Token compression plugin for OpenCode AI
- **Language**: TypeScript (ESM)
- **Runtime**: Bun (test) / Node 18+ (production)
- **Package manager**: npm

## Architecture: 4-Layer Pipeline

```
Tool Output → L1 Filter → L2 Semantic → L3 DCP Pruning → L4 Cleanup → Context Window
```

| Layer | Purpose | Key Files |
|-------|---------|-----------|
| L1 | Output filtering (RTK-style) | `layers/layer1-output-filter.ts`, `filters/*.ts` |
| L2 | Semantic compression (NLP/MLM/LLM) | `layers/layer2-caveman.ts`, `caveman/*.ts` |
| L3 | Dynamic Context Pruning | `layers/layer3-dcp.ts`, `dcp/*.ts` |
| L4 | Dedup + error cleanup | `layers/layer4-cleanup.ts`, `cleanup/*.ts` |

## Critical Constraints (DO NOT VIOLATE)

1. **Plugin exports MUST be functions only** — OpenCode plugin loader throws `TypeError` for non-function exports
2. **`task` (sub-agent) output must NOT be compressed** at any layer — protected by `skipTools: ["task"]`
3. **Code blocks must never be touched** — syntax and case-sensitiveness are critical
4. **Stack traces and error messages must be preserved** — every line carries information
5. **`dts: true`** in `tsup.config.ts` — `.d.ts` must match `"types"` in `package.json`

## Known Audit Pitfalls

AI agents frequently make these mistakes when auditing this codebase:

| Mistake | Why It's Wrong |
|---------|---------------|
| Claiming `toolName` is always `undefined` | `ToolPart` has `{ type: "tool", tool: string }` — `output.parts.find(p => p.type === "tool")?.tool` works |
| Claiming L2 compression never applies | Line 266 writes `output.parts[i].text = content` — verified |
| Claiming `command.execute.before` doesn't exist | It's in OpenCode plugin API (`index.d.ts` line 227) |
| Claiming installation docs are missing | README lines 90-98, 125, 624 |
| Claiming `benchmarks/run.ts` doesn't exist | It's at `benchmarks/run.ts` with 5 fixtures |

**Rule**: Always cross-check against actual source files before reporting a bug. Read the file, don't infer from diffs.

## Build & Test

```bash
npm run lint     # tsc --noEmit
npm test         # bun test
npm run build    # tsup
npm run benchmark # tsx benchmarks/run.ts
```

All three must pass before any PR.

## Key Configuration

See `docs/konfigurasi-lengkap.md` for all config keys and their defaults.

## OpenCode Plugin API Hooks Used

| Hook | Used For |
|------|----------|
| `command.execute.before` | `/up` slash commands |
| `tool.execute.after` | L1 output filtering + L4 cleanup |
| `chat.message` | L2 compression + L3 pruning + real token sync |
| `experimental.session.compacting` | Protected context injection |
| Custom tools | `ultrapress_compress`, `ultrapress_expand` |

## Dependencies

- `@opencode-ai/plugin` (`^1.14.0`) — pinned, NOT `latest`
- `@huggingface/transformers` (`^4.2.0`) — MLM + LLM + tokenizer
- `zod` (`^4.4.3`) — NOT imported directly, `tool.schema` from plugin

## Schema Conventions

All config fields must have corresponding entries in:
1. `src/config/schema.ts` — TypeScript interface
2. `src/config/defaults.ts` — default values
3. `ultrapress.schema.json` — JSON Schema
4. `docs/konfigurasi-lengkap.md` — documentation

Tests use `makeConfig()` and `makeStats()` factory functions — update both when adding fields.
