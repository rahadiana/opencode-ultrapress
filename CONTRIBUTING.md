# Contributing to UltraPress

Selamat datang! Kontribusi sangat diterima. Berikut panduan untuk memulai.

## Area Kontribusi

| Area | Tingkat Kesulitan | Deskripsi |
|---|---|---|
| **New Filters** | ⭐ Mudah | Tambah filter Layer 1 untuk tool/framework baru (Docker, Terraform, K8s, Svelte, Flutter) |
| **Multi-Language NLP** | ⭐⭐ Menengah | Perluas aturan grammar stripping untuk bahasa baru (Japanese, Arabic, etc.) |
| **Benchmark Dataset** | ⭐ Mudah | Kontribusikan fixture log dari stack kamu ke `benchmarks/fixtures/` |
| **Bug Reports** | ⭐ Mudah | Laporkan edge case: output tidak terfilter, pesan penting terhapus |
| **LLM Mode Models** | ⭐⭐ Menengah | Test model summarization lain via `semantic.model` config |
| **DCP Scoring Tuning** | ⭐⭐ Menengah | Tuning bobot 5-signal scoring di `scorer.ts` |
| **CI/CD Improvements** | ⭐ Mudah | Tambah matrix testing, publish automation |

## Setup Development

```bash
git clone https://github.com/rahadiana/opencode-ultrapress.git
cd opencode-ultrapress
npm install
npm run build
npm test
```

**Prasyarat:** Node.js >= 18, Bun (untuk testing).

## Struktur Proyek

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
docs/                     # Konfigurasi + arsitektur
```

## Alur Kontribusi

1. **Fork** repo
2. **Buat branch**: `feat/nama-fitur` atau `fix/nama-bug`
3. **Implementasi** + tests
4. **Jalankan**: `npm run lint && npm test && npm run build`
5. **Commit** dengan pesan [conventional commits](https://www.conventionalcommits.org/)
6. **Buat Pull Request** — isi template PR dengan jelas

## Konvensi Commit

```
feat: deskripsi fitur baru
fix: deskripsi perbaikan bug
docs: perubahan dokumentasi
refactor: perubahan kode tanpa ubah behavior
test: penambahan/perbaikan test
ci: perubahan CI/CD
```

## Membuat Filter Baru (Layer 1)

1. Buat file di `src/filters/[tool].ts`
2. Export function `filterXxx(command, output, maxChars): FilterResult`
3. Tambah detection di `layer1-output-filter.ts`
4. Tambah test di `tests/layer1.test.ts`
5. Tambah fixture di `benchmarks/fixtures/`

Lihat `src/filters/git.ts` sebagai contoh template.

## Menambah Aturan NLP (Layer 2)

1. Tambah strippable words di `src/caveman/rules.ts`
2. Tambah preserved fact regex di `src/caveman/facts.ts`
3. Tambah test case di test file yang relevan

## Testing

```bash
bun test                    # semua test
bun test tests/layer1.test.ts   # test spesifik
npm run benchmark           # benchmark
```

## Need Help?

- Buka [Issue](https://github.com/rahadiana/opencode-ultrapress/issues) dengan label `question`
- Lihat `docs/konfigurasi-lengkap.md` untuk semua config key
- Lihat `docs/architecture.md` untuk diagram arsitektur
