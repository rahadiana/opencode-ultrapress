# Contributing to UltraPress

Welcome! Contributions are highly appreciated. Here's how to get started.

## Contribution Areas

| Area | Difficulty | Description |
|---|---|---|
| **New Filters** | ⭐ Easy | Add Layer 1 filters for new tools/frameworks (Docker, Terraform, K8s, Svelte, Flutter) |
| **Multi-Language NLP** | ⭐⭐ Medium | Expand grammar stripping rules for new languages (Japanese, Arabic, etc.) |
| **Benchmark Dataset** | ⭐ Easy | Contribute log fixtures from your stack to `benchmarks/fixtures/` |
| **Bug Reports** | ⭐ Easy | Report edge cases: unfiltered output, important messages removed |
| **LLM Mode Models** | ⭐⭐ Medium | Test alternative summarization models via `semantic.model` config |
| **DCP Scoring Tuning** | ⭐⭐ Medium | Tune the 5-signal scoring weights in `scorer.ts` |
| **CI/CD Improvements** | ⭐ Easy | Add matrix testing, publish automation |

## Development Setup

```bash
git clone https://github.com/rahadiana/opencode-ultrapress.git
cd opencode-ultrapress
npm install
npm run build
npm test
```

**Prerequisites:** Node.js >= 18, Bun (for testing).

## Project Structure

```
src/
├── index.ts              # Entry point: hook registrations
├── commands/slash.ts     # /up command handler
├── layers/               # 4-layer orchestration
│   ├── layer1-output-filter.ts
│   ├── layer2-caveman.ts
│   ├── layer3-dcp.ts
│   └── layer4-cleanup.ts
├── caveman/              # L2 compression engines
│   ├── nlp.ts, mlm.ts, llm.ts, rules.ts, facts.ts
├── dcp/                  # L3 DCP engine
│   ├── compress-tool.ts, compress-state.ts, prune.ts
│   ├── context-monitor.ts, scorer.ts, expand-tool.ts
├── filters/              # L1 domain filters
│   ├── git.ts, test.ts, bash.ts, fs.ts, generic.ts
├── cleanup/              # L4 cleanup
│   ├── dedup.ts, purge-errors.ts
├── config/               # Schema + defaults
├── utils/                # Token count, logger
tests/                    # Unit tests (Bun)
benchmarks/               # Benchmark script + fixtures
docs/                     # Configuration + architecture
```

## Contribution Workflow

1. **Fork** the repo
2. **Create branch**: `feat/feature-name` or `fix/bug-name`
3. **Implement** + tests
4. **Run**: `npm run lint && npm test && npm run build`
5. **Commit** using [conventional commits](https://www.conventionalcommits.org/)
6. **Create Pull Request** — fill out the PR template clearly

## Commit Conventions

```
feat: description of a new feature
fix: description of a bug fix
docs: documentation changes
refactor: code changes without behavior change
test: test additions/fixes
ci: CI/CD changes
```

## Creating a New Filter (Layer 1)

1. Create file at `src/filters/[tool].ts`
2. Export function `filterXxx(command, output, maxChars): FilterResult`
3. Add detection in `layer1-output-filter.ts`
4. Add test in `tests/layer1.test.ts`
5. Add fixture in `benchmarks/fixtures/`

See `src/filters/git.ts` as a template example.

## Adding NLP Rules (Layer 2)

1. Add strippable words in `src/caveman/rules.ts`
2. Add preserved fact regex in `src/caveman/facts.ts`
3. Add test case in the relevant test file

## Testing

```bash
bun test                         # all tests
bun test tests/layer1.test.ts    # specific test
npm run benchmark                # benchmark
```

## Need Help?

- Open an [Issue](https://github.com/rahadiana/opencode-ultrapress/issues) with the `question` label
- See `docs/konfigurasi-lengkap.md` for all config keys
- See `docs/architecture.md` for the architecture diagram
