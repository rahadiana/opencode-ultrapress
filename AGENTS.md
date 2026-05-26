# AGENTS.md

## What this repo is
- `@rahadiana/opencode-ultrapress`: OpenCode plugin (TypeScript, ESM) for 4-layer token compression.
- Runtime artifacts are published from `dist/` (`package.json` `main`/`types` point there).

## Source of truth (read first)
- `src/index.ts`: real wiring/entrypoint (`server(ctx)`), all hook registrations.
- `package.json`: exact dev commands and publish behavior.
- `.github/workflows/ci.yml`: CI truth (`bun run lint`, `bun run build`, `bun test`).
- `.github/workflows/publish.yml`: npm publish flow (CI-gated + manual dispatch).
- `tsup.config.ts`, `tsconfig.json`: build and strict TS constraints.
- `docs/konfigurasi-lengkap.md` + `ultrapress.schema.json`: config surface.

## Exact commands (don’t guess)
- Install deps: `npm install` (repo uses npm lockfile).
- Typecheck: `npm run lint` (`tsc --noEmit`).
- Tests: `npm test` (`bun test`).
- Build: `npm run build` (`tsup`, emits ESM + d.ts).
- Benchmark: `npm run benchmark` (`tsx benchmarks/run.ts`).

Recommended verification order for code changes: `npm run lint` → `npm test` → `npm run build`.

## Architecture that matters
- Pipeline intent: **L1 filter → L2 semantic → L3 pruning → L4 cleanup**.
- Hook map in `src/index.ts`:
  - `command.execute.before`: `/up` command interception + config mutation persistence.
  - `tool.execute.after`: L1 filtering + L4 cleanup on tool output.
  - `chat.message`: token sync + L2/L3 processing + post-command assistant follow-up suppression.
  - `experimental.chat.messages.transform`: strip `[analyze-mode]/[search-mode]` injections.
  - `experimental.session.compacting`: inject protected context for compaction.
- Custom tools: `ultrapress_compress`, `ultrapress_expand`.

## Critical repo-specific constraints
- Do **not** change plugin export shape: default export is `server`, and hooks are returned from `server(ctx)`.
- `/up` behavior is fragile by platform design:
  - command output is written via `output.parts`.
  - follow-up model leakage is mitigated in `chat.message` using session-scoped suppression.
  - avoid “clever” message structure mutations in transform hooks; prior attempts caused `failed send command`.
- Config/schema coupling is strict: when adding a config key, update all of:
  1. `src/config/schema.ts`
  2. `src/config/defaults.ts`
  3. `ultrapress.schema.json`
  4. `docs/konfigurasi-lengkap.md`

## Testing/benchmark quirks
- Unit tests run with Bun; if you only run Node-based checks, you can miss test failures.
- `benchmarks/run.ts` is fixture-driven and measures each layer independently (not chained pipeline output).

## Practical workflow notes
- If docs conflict with code, trust hooks/scripts/config in repo root and `src/index.ts`.
- For `/up` issues, inspect only these first: `src/index.ts` (command + chat hooks), `src/commands/slash.ts` (rendered command text).
