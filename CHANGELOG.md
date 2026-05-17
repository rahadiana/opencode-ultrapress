# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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
- **Example file**: `ultrapress.json.example` → `ultrapress.jsonc.example` (valid JSONC)
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
- Dedicated config file support at `~/.config/opencode/ultrapress.json`
- Auto-creation of config file with best-practice defaults on first run
- History token sync on session resume
- Session statistics tracking per layer

[Unreleased]: https://github.com/rahadiana/opencode-ultrapress/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rahadiana/opencode-ultrapress/releases/tag/v0.1.0
