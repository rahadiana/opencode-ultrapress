# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- Reproducible benchmark script (`npm run benchmark`) with real fixture datasets
- Architecture documentation (`docs/architecture.md`) with Mermaid pipeline diagram
- GitHub Actions CI/CD workflow (build + lint + test on every push/PR)
- Multilingual AI model support for MLM mode (`Xenova/bert-base-multilingual-uncased`)
- Dynamic model selection via `semantic.model` config key
- Model pre-loading on startup when MLM mode is enabled
- Model recommendation table in README with Hugging Face reference link
- EXPERIMENTAL label on MLM mode with honest limitation disclosure
- Comprehensive installation guide in README

### Changed
- Layer 2 renamed from "Caveman Mode" to "GSC (Grammar Stripping Compression)" in user-facing strings
- README benchmarks section updated — replaced static table with reproducible script instructions
- MLM mode now jujur (honest) about its current implementation scope

### Fixed
- `_ctx` typo in `index.ts` causing TypeScript error (line 121)
- Unused import `estimateTokens` removed from `mlm.ts`
- `NLPResult` type extended with optional `method` field

---

## [0.1.0] — 2026-05-11

### Added
- Initial plugin release for OpenCode AI
- **Layer 1**: Smart Output Filter (RTK-style) with domain-specific filters for `git`, `npm`, `pytest`, `bash`, and filesystem commands
- **Layer 2**: Semantic Compression with NLP (Grammar Stripping) and MLM (AI-based, EXPERIMENTAL) modes
- **Layer 3**: Dynamic Context Pruning (DCP) with autonomous LLM nudging and `ultrapress_compress` tool
- **Layer 4**: Session Auto-Cleanup with error purging and tool-call deduplication
- Native `/up` slash command support with subcommands: `stats`, `context`, `compress`, `mode`, `filter`, `manual`
- Dedicated config file support at `~/.config/opencode/ultrapress.json`
- Auto-creation of config file with best-practice defaults on first run
- History token sync on session resume
- Session statistics tracking per layer

[Unreleased]: https://github.com/rahadiana/opencode-ultrapress/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rahadiana/opencode-ultrapress/releases/tag/v0.1.0
