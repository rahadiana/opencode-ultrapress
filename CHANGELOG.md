# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.2.16] — 2026-05-28

### Changed
- Rewrote README: proper title reflecting DCP+Caveman+RTK combination, embedded banner SVG, architecture diagram, correct install command (`opencode plugin @tarquinen/opencode-dcp@latest --global`), references to `docs/architecture.md` and `docs/konfigurasi-lengkap.md`

### Fixed
- Stats display: hardcoded `−` sign showing `(−100%)` → proper `(+100%)` sign
- L3 stats accounting: `totalTokensCompressed` no longer corrupted by L3 savings (previously decremented to 0)
- Added `scoreThreshold` to `SummarizationConfig` type, defaults, and validation
- Removed unused `SessionStats` import from `layer3-dcp.ts`
- Updated `docs/architecture.md`: renamed GSC → Caveman, L3 nudge → DCP, updated hook order and file map
- Updated `docs/konfigurasi-lengkap.md`: added `scoreThreshold` to config table, code example, and interface definition

## [0.2.13] — 2026-05-28

### Changed
- L3 token-aware threshold: skip auto-compress when batch < 5 messages
- Externalize `@huggingface/transformers` from bundle so `onnxruntime` `.node` resolves at runtime
- Auto-check npm for newer version on startup, warn to clear cache if stale
- Exclude `.node` binaries from npm package, add postbuild cleanup

## [0.2.12] — 2026-05-28

### Changed
- Separate plugin config to `ultrapress.plugin.json` with auto-migration from legacy `ultrapress.json`

## [0.2.11] — 2026-05-28

### Changed
- **Config file separated from built-in**: plugin now uses `ultrapress.plugin.json` instead of `ultrapress.json` to avoid colliding with OpenCode's built-in Ultrapress. Built-in's `"enabled"` no longer affects our plugin, and vice versa.
- **Auto-migration**: if old `ultrapress.json` exists, it's copied to the new filename on first load.

---

## [0.2.10] — 2026-05-28

### Fixed
- **`error()` logger now respects `enableDebug`**: when `enableDebug: false`, all log output including errors is suppressed.
- **MLM/LLM import error handling**: `@huggingface/transformers` moved to `optionalDependencies`. Import failures now show a clear error message instead of a cryptic stack trace.
- **Config migration on upgrade**: auto-writes sanitized config on load so new fields (like `enableDebug`) appear in the file after upgrading.
- **Defensive config write**: `enableDebug` field is always explicitly included in the auto-created `ultrapress.plugin.json` even in edge-case runtime scenarios.
- **Auto-install fallback for MLM mode**: when `semantic.mode` is `"mlm"` but `@huggingface/transformers` is not installed, falls back to NLP for the session and attempts `npm install` in the background. Config file stays `"mlm"` for next restart.

---

### Fixed
- **scoreThreshold default mismatch**: `defaults.ts` had 0.20 while `schema.json` and docs documented 0.45. Synced code default to 0.45.

---

## [0.2.8] — 2026-05-27

### Fixed
- **/up follow-up suppression**: bypass role check entirely — strip leaked `/up` output patterns from any follow-up message instead of clearing full output. More targeted cleanup prevents info loss.

---

## [0.2.7] — 2026-05-26

### Fixed
- **/up follow-up suppression broadened**: catch non-assistant role messages that leak `/up` command output, preventing follow-up model leakage.
- **Strip leaked `delegate_task` / `ANALYSIS MODE` patterns**: remove `MANDATORY delegate_task params` blocks and `ANALYSIS/SEARCH MODE` injections from `experimental.chat.messages.transform` hook. Stops AI-slop patterns from reaching the model.

---

## [0.2.6] — 2026-05-25

### Added
- **enableDebug toggle**: new `enableDebug` config key to control UltraPress console logs independently. Default `false` (silent). Set `true` to see L1-L4 debug output in OpenCode terminal.
- **Logger routing**: MLM/LLM mode console logs now go through `logger` module instead of raw `console.log`, respecting the configured log level.

### Fixed
- **Log level timing**: `enableDebug` log level is applied before config loading output, preventing spurious startup messages.
- **/up handler stabilization**: fixed follow-up detection for `/up` command to reliably suppress leaked command output after slash commands.

---

## [0.2.5] — 2026-05-23

### Changed
- No functional changes. Version bumped to align npm with git state.

---

## [0.2.4] — 2026-05-23

### Added
- **Balanced runtime defaults**: tuned default config for better out-of-box experience — `preserveLastN: 4`, `scoreThreshold: 0.45`, `minContextLimit: 35000`, `maxContextLimit: 60000`.
- **Docs synced**: `ultrapress.schema.json` and config reference docs updated to match default values.

### Fixed
- **Critical context protection**: protected context strings are injected during `experimental.session.compacting` to prevent compression/pruning from losing critical agent instructions.
- **ONNX Runtime thread leak**: limited ONNX Runtime threads to 2 + proper pipeline dispose to prevent Bun process leaks on Windows.
- **Block ID safe integer range**: keep compression block IDs within `Number.MAX_SAFE_INTEGER` by combining time prefix with counter.
- **Config validation hardening**: resolve config type mismatches, add validation layer, harden compression against edge cases.
- **ultrapress.schema.json sync**: schema file now accurately reflects all fields in `schema.ts` (including `nudgeThreshold`, `model`, `skipTools`, etc.). Fixed MLM pre-load path.
- **CI publish fix**: `NODE_AUTH_TOKEN` passed to `setup-node` step so `.npmrc` is correctly written with auth credentials for npm publish.

---

## [0.2.3] — 2026-05-20

### Added
- **Balanced defaults**: re-tuned `preserveLastN`, `scoreThreshold`, `minContextLimit`, `maxContextLimit` for stable long sessions.

### Fixed
- **Critical context protection**: `getProtectedContextString()` now included in compaction hook output so critical agent instructions are not lost during compression/pruning.
- **Schema defaults synced**: `ultrapress.schema.json` defaults aligned with `defaults.ts`.

---

## [0.2.2] — 2026-05-19

### Fixed
- **ultrapress.schema.json sync**: schema file now accurately reflects all fields from `schema.ts`. Added missing `nudgeThreshold`, `model`, `skipTools` entries. Fixed MLM pre-load path.
- **Config validation**: resolve type mismatches between schema and defaults. Added validation layer to catch config issues at startup.
- **Block ID range**: compression block IDs now stay within `Number.MAX_SAFE_INTEGER` using time-prefixed counter instead of unbounded increment.
- **ONNX thread leak**: restrict ONNX Runtime to 2 threads + dispose pipeline properly to prevent Bun process leaks on Windows.
- **CI publish auth**: pass `NODE_AUTH_TOKEN` to `setup-node` step so `.npmrc` is properly created with npm credentials.

---

## [0.2.1] — 2026-05-18

### Fixed
- **L3 DCP nudge was dead code**: `processTurnForDCP()` was never called from `chat.message` hook — the turn-level nudge prompting LLM to call `ultrapress_compress` never fired. Wired into `chat.message` hook with proper nudge injection.
- **Double-counting L2 savings**: `stats.savedByLayer.semantic` incremented twice (once in `processMessageContext()`, once in `chat.message` hook). Removed redundant line in `index.ts`.
- **Session isolation**: `nextBlockId` started at 0, risking ID collisions across plugin restarts. Changed to `Date.now()` and added `resetCompressionState()` call at `server()` startup.

### Added
- **Config persistence**: `/up mode`, `/up filter`, `/up manual` now persist changes to `ultrapress.plugin.json` on disk. Mutations survive plugin restart.
- **Config mutation tracking**: `handleSlashCommand()` returns `SlashResult { response, configMutated }` for selective disk writes.

---

## [0.2.0] — 2026-05-17

### Added
- **LLM mode (local)**: summarization pipeline via `@huggingface/transformers` (T5-small, no API key)
- **Multi-signal importance scoring** (`scoreThreshold`): 5-signal scoring for smarter pruning
- **All-pairs MLM dedup**: detects duplicate sentences anywhere in text, not just adjacent
- **Reversible compression**: `ultrapress_expand` tool to restore original content from blocks
- **Real token tracking**: `actualTokensInput/Output/Reasoning` from OpenCode API
- **Accurate token counting**: `countTokens()` via `AutoTokenizer` (`Xenova/gpt2`)
- **Sub-agent protection**: `skipTools: ["task"]` skips L1+L2 for sub-agent output
- **Configurable nudge threshold**: `nudgeThreshold` (0-1, default 0.70)
- **Pre-emptive nudge**: nudge at 70% of `maxContextLimit` instead of 100%
- **Quantized MLM**: `dtype: "q8"` reduces model size from ~284MB to ~71MB
- **`ultrapress.schema.json`**: JSON Schema for IDE autocomplete
- **LICENSE** (MIT)
- **CONTRIBUTING.md**: contribution guide with area table
- **Issue templates**: bug report + feature request
- **PR template**: structured pull request template
- **CI/CD**: GitHub Actions workflow (Bun, lint+build+test)

### Changed
- **Package**: `@xenova/transformers` → `@huggingface/transformers` v4
- **Dependencies pinned**: `@opencode-ai/plugin` from `"latest"` to `"^1.14.0"`
- **Model default**: MLM from `distilbert-base-uncased` to `all-MiniLM-L6-v2`
- **Export format**: `export default server` (function) for plugin loader compatibility
- **Example file**: `ultrapress.plugin.json.example` → `ultrapress.plugin.jsonc.example` (valid JSONC)
- **TSup**: `dts: false` → `dts: true` for `.d.ts` generation
- **Logger**: added `warn()` function

### Fixed
- Non-function export causing `TypeError` in plugin loader
- Missing `.d.ts` files despite `package.json` reference
- Unused `processTurnForDCP` import
- `processMessageContext` call missing `role` argument (type error)
- Unused `current` variable in `buildNudgePrompt`
- `makeConfig`/`makeStats` test fixtures missing new schema fields

---

## [0.1.0] — 2026-05-11

### Added
- Initial plugin release for OpenCode AI
- **Layer 1**: Smart Output Filter (RTK-style) with domain-specific filters for `git`, `npm`, `pytest`, `bash`, and filesystem commands
- **Layer 2**: Semantic Compression with NLP (Grammar Stripping) and MLM (AI-based) modes
- **Layer 3**: Dynamic Context Pruning (DCP) with autonomous LLM nudging and `ultrapress_compress` tool
- **Layer 4**: Session Auto-Cleanup with error purging and tool-call deduplication
- Native `/up` slash command support with subcommands: `stats`, `context`, `compress`, `mode`, `filter`, `manual`
- Dedicated config file support at `~/.config/opencode/ultrapress.plugin.json`
- Auto-creation of config file with best-practice defaults on first run
- History token sync on session resume
- Session statistics tracking per layer

[0.2.9]: https://github.com/rahadiana/opencode-ultrapress/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/rahadiana/opencode-ultrapress/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/rahadiana/opencode-ultrapress/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/rahadiana/opencode-ultrapress/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/rahadiana/opencode-ultrapress/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/rahadiana/opencode-ultrapress/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/rahadiana/opencode-ultrapress/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/rahadiana/opencode-ultrapress/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/rahadiana/opencode-ultrapress/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/rahadiana/opencode-ultrapress/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rahadiana/opencode-ultrapress/releases/tag/v0.1.0
