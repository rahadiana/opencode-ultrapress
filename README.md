<p align="center">
  <img src="./docs/image/banner.svg" alt="UltraPress Banner" width="100%" />
</p>

<div align="center">

# 🚀 OpenCode UltraPress

**Token Compression Plugin for OpenCode AI**

[![CI](https://github.com/rahadiana/opencode-ultrapress/actions/workflows/ci.yml/badge.svg)](https://github.com/rahadiana/opencode-ultrapress/actions/workflows/ci.yml)
[![npm](https://img.shields.io/badge/npm-soon!-lightgrey)](https://www.npmjs.com/package/@rahadiana/opencode-ultrapress)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

> **UltraPress** menghemat token context window melalui 4 layer kompresi yang berjalan otomatis di latar belakang — dari filtering output CLI, semantic compression, dynamic context pruning, hingga auto-cleanup. LLM kamu tetap pintar, token tetap hemat.

---

## 📑 Daftar Isi

- [⚡ Instalasi & Setup](#-instalasi--setup)
  - [Persyaratan Sistem](#persyaratan-sistem)
  - [Install dari GitHub](#1-install-plugin)
  - [Daftarkan ke OpenCode](#2-daftarkan-ke-opencode)
  - [Konfigurasi Personal](#3-opsional-buat-konfigurasi-personal)
  - [Verifikasi Instalasi](#verifikasi-instalasi)
  - [Uninstall](#uninstall)
- [🛠 Arsitektur 4-Layer](#-arsitektur-4-layer)
  - [Pipeline Flow](#pipeline-flow)
  - [Layer 1 — Smart Output Filter](#layer-1--smart-output-filter)
  - [Layer 2 — GSC Semantic Compression](#layer-2--gsc-semantic-compression)
  - [Layer 3 — Dynamic Context Pruning (DCP)](#layer-3--dynamic-context-pruning-dcp)
  - [Layer 4 — Session Auto-Cleanup](#layer-4--session-auto-cleanup)
- [⚙️ Konfigurasi](#️-konfigurasi)
  - [Dokumentasi lengkap →](./docs/konfigurasi-lengkap.md)
- [⌨️ Slash Command `/up`](#️-slash-command-up)
  - [Daftar Sub-command](#daftar-sub-command)
  - [Contoh Output](#contoh-output)
- [❷ Support MLM & NLP](#-support-mlm--nlp)
  - [Mode NLP (Default)](#mode-nlp-default)
  - [Mode MLM (Experimental)](#mode-mlm-experimental)
  - [Perbandingan Mode](#perbandingan-mode)
- [🏗 Arsitektur Kode](#-arsitektur-kode)
  - [Struktur Direktori](#struktur-direktori)
  - [Hook Registration Map](#hook-registration-map)
  - [Data Flow Detail](#data-flow-detail)
- [🧪 Pengujian](#-pengujian)
- [📊 Benchmark](#-benchmark)
- [🚀 Pengembangan Lokal](#-pengembangan-lokal)
- [❓ FAQ & Troubleshooting](#-faq--troubleshooting)
- [🗺 Roadmap](#-roadmap)
- [🤝 Kontribusi](#-kontribusi)
- [📝 Changelog](#-changelog)
- [📄 License](#-license)

---

## ⚡ Instalasi & Setup

### Persyaratan Sistem

| Dependency | Versi Minimum | Catatan |
| :--- | :--- | :--- |
| **Node.js** | `>= 18` | Direkomendasikan Node 22 LTS |
| **OpenCode AI** | Latest | Menggunakan `@opencode-ai/plugin ^1.14` |
| **Git** | Any | Diperlukan untuk install dari GitHub |
| **Bun** | Latest | Hanya untuk development/testing |
| **@huggingface/transformers** | Auto-install | Hanya digunakan jika mode `mlm` aktif |

### 1. Install Plugin

> ⚠️ **Belum tersedia di npm.** Untuk saat ini, install langsung dari GitHub.

```bash
# Dari GitHub (direkomendasikan — selalu versi terbaru)
npm install -g github:rahadiana/opencode-ultrapress

# Atau clone & link manual
git clone https://github.com/rahadiana/opencode-ultrapress.git
cd opencode-ultrapress
npm install
npm run build
npm link
```

> 💡 **Nama paket**: `@rahadiana/opencode-ultrapress` (akan tersedia di npm setelah rilis stabil)

### 2. Daftarkan ke OpenCode

Tambahkan plugin ke file konfigurasi OpenCode di `~/.config/opencode/config.json`:

```json
{
  "plugins": ["@rahadiana/opencode-ultrapress"]
}
```

> 💡 **Tips**: OpenCode akan otomatis me-resolve plugin yang diinstal secara global melalui runtime `@opencode-ai/plugin`. Restart OpenCode setelah menambahkan plugin.

### 3. (Opsional) Buat Konfigurasi Personal

UltraPress bekerja out-of-the-box dengan default terbaik. Untuk kustomisasi:

```bash
# Install dari GitHub → copy dari repo yang sudah di-clone
cp ultrapress.json.example ~/.config/opencode/ultrapress.json

# Atau dari global install
cp $(npm root -g)/@rahadiana/opencode-ultrapress/ultrapress.json.example ~/.config/opencode/ultrapress.json
```

Kemudian edit `~/.config/opencode/ultrapress.json` sesuai kebutuhan. Jika file tidak ditemukan, UltraPress akan otomatis membuatnya dengan nilai default saat pertama kali dijalankan.

### Verifikasi Instalasi

Setelah restart OpenCode, ketik di chat:

```
/up stats
```

Jika muncul dashboard statistik, UltraPress sudah aktif. Jika tidak:
1. Pastikan plugin ada di `config.json` → `"plugins": ["@rahadiana/opencode-ultrapress"]`
2. Cek log OpenCode untuk error
3. Pastikan Node.js >= 18 terinstall (`node --version`)

### Uninstall

```bash
# Jika install dari GitHub (global)
npm uninstall -g @rahadiana/opencode-ultrapress

# Jika pakai npm link
npm unlink -g @rahadiana/opencode-ultrapress

# Bersihkan config
rm ~/.config/opencode/ultrapress.json
```

---

## 🛠 Arsitektur 4-Layer

UltraPress mencegat alur pesan OpenCode di 4 titik berbeda, masing-masing dengan strategi kompresi yang spesifik.

### Pipeline Flow

```mermaid
flowchart LR
    A([Tool Output]) -->|"tool.execute.after"| L1[Layer 1\nOutput Filter]
    B([Chat Message]) -->|"chat.message"| PRUNE{Prune\nPending?}
    PRUNE -->|yes| REMOVE[Remove msgs\n& inject summary]
    PRUNE -->|no| L2[Layer 2\nGSC Semantic]
    REMOVE --> L2
    L2 --> L3[Layer 3\nNudge Monitor]
    L3 -->|"nudge injected"| LLM{LLM}
    LLM -->|"calls tool"| DCP_TOOL[ultrapress_compress]
    DCP_TOOL -.->|"block stored"| PRUNE
    D([Session Compact]) -->|"session.compacting"| L4[Layer 4\nCleanup]

    L1 & L2 & L4 --> CTX[(Context\nWindow)]
```

---

### Layer 1 — Smart Output Filter

> **Hook**: `tool.execute.after` · **File**: `layer1-output-filter.ts` · **Filter**: `src/filters/`

Mencegat output dari tool CLI **sebelum** masuk ke context window. Layer paling agresif — langsung memotong log yang tidak perlu.

**Strategi Utama:**

| Strategi | Deskripsi |
| :--- | :--- |
| **Domain Routing** | Setiap tool CLI dirutekan ke filter spesifik: `git`, `npm/node`, `pytest/jest`, dan filesystem. Tool yang tidak dikenal masuk ke generic filter. |
| **Middle-out Truncation** | Memotong log dari tengah, mempertahankan awal (konteks) dan akhir (error/result). Lebih pintar dari head/tail truncation. |
| **Deduplication** | Menghapus baris log berulang yang identik secara real-time. Sangat efektif untuk log build & test. |
| **Tee Save** | Jika output terpotong, log asli disimpan ke file `.log` sementara agar tetap bisa diakses jika diperlukan. |

**Filter Bawaan:**

| Filter | File | Trigger Tools |
| :--- | :--- | :--- |
| **Git** | `filters/git.ts` | `git diff`, `git log`, `git show` — hapus diff hunks yang redundant, pertahankan summary |
| **Test** | `filters/test.ts` | `pytest`, `jest`, `vitest`, `mocha` — ringkas failure output, hapus passing tests |
| **Bash** | `filters/bash.ts` | Generic shell output — dedup baris, potong middle-out |
| **Filesystem** | `filters/fs.ts` | `ls`, `cat`, `find` — batasi jumlah file, truncate konten panjang |
| **Generic** | `filters/generic.ts` | Fallback untuk semua tool lain — middle-out truncation + dedup |

---

### Layer 2 — GSC Semantic Compression

> **Hook**: `chat.message` · **File**: `layer2-caveman.ts` · **Engine**: `src/caveman/`

Mengompresi teks pesan secara **semantik** — menghilangkan kata-kata tidak penting tanpa mengubah makna. Layer 2 dan Layer 3 **tidak saling kompresi** — tidak ada double compression.

**Aturan Kompresi:**

- Kata sambung (`yang`, `dan`, `akan`, `bahwa`) → dihapus
- Kata ganti berlebihan → dipadatkan
- Redundansi ("saya pikir saya akan" → "saya akan") → dihapus
- Spasi ganda, whitespace tidak perlu → dinormalisasi
- **Code blocks** (dalam ` ``` `) → **TIDAK PERNAH** disentuh
- **Error messages & stack traces** → diproteksi penuh
- Pesan < 200 karakter → di-skip

**Mode Operasi:**

Lihat [❷ Support MLM & NLP](#-support-mlm--nlp) untuk detail perbandingan NLP vs MLM.

---

### Layer 3 — Dynamic Context Pruning (DCP)

> **Hook**: `chat.message` (pruning) + `tool.execute.after` (compress tool) · **File**: `layer3-dcp.ts` · **Engine**: `src/dcp/`

Sistem paling canggih: **memberi otonomi kepada LLM untuk mengelola memorinya sendiri**. Berbeda dari Layer 2 yang hanya mengompresi teks, Layer 3 **benar-benar menghapus pesan lama dari context window** dan menggantinya dengan ringkasan.

**Mekanisme:**

```
1. Context Monitor → deteksi token mendekati maxContextLimit
2. Autonomous Nudge → sisipkan prompt ke user message: "context window hampir penuh, panggil ultrapress_compress"
3. LLM memanggil → ultrapress_compress(mode="range", from=<id>, to=<id>)
4. Compression Block → disimpan di memory (compress-state.ts)
5. chat.message hook → cek block pending → hapus pesan dalam range → sisipkan ringkasan sebagai synthetic message
```

**Fitur Kunci:**

| Fitur | Deskripsi |
| :--- | :--- |
| **Block-based Pruning** | Saat `ultrapress_compress` dipanggil, LLM menentukan range pesan yang akan diringkas. Block disimpan, lalu dieksekusi pada chat **berikutnya** (bukan saat ini — menghindari race condition). |
| **prune via `chat.message` Hook** | Setiap pesan baru → plugin memeriksa block pending → menghapus pesan dalam range dari array context → menyisipkan ringkasan. |
| **Protected Content** | Tool output penting (`task`, `write`, `edit`, `bash` hasil sukses, `read`) dilindungi dari pruning. Hanya `read` output yang difilter. Lihat `protected-content.ts`. |
| **Nesting Support** | Kompresi bisa dilakukan di atas kompresi sebelumnya. Ringkasan bertingkat digabung otomatis. |
| **`preserveLastN`** | Melindungi N pesan **terakhir** dari pruning — menjaga konteks percakapan terkini tetap utuh. Default: `3`. Set ke `0` untuk disable. |
| **Multi-Signal Scoring** | Selain `preserveLastN`, tiap pesan diskor dari 5 sinyal (recency, role, tool type, keyword, content size). Pesan dengan score tinggi tetap dipertahankan meskipun masuk block lama. Default: off (`scoreThreshold: 0`), rekomendasi: `0.45`. |
| **Reversible Compression** | `ultrapress_expand` tool — LLM bisa "mengembangkan" kembali block yang sudah diringkas untuk lihat konten asli. Konten asli disimpan di plugin memory (bukan di context LLM). |
| **Nudge @70%** | Nudge dikirim saat context mencapai 70% limit (bukan 100%), memberi LLM waktu untuk kompresi sebelum context benar-benar penuh. |
| **summaryBuffer** | Setelah pruning, memberi ruang napas (tidak langsung trigger nudge lagi). |

**Dua Mode Pruning:**

| Mode | Deskripsi |
| :--- | :--- |
| `range` | Kompresi berbasis rentang: pilih from_id dan to_id. Semua pesan di antaranya diringkas menjadi satu. |
| `message` | Kompresi surgical: pilih satu atau beberapa ID pesan spesifik untuk diringkas. |

---

### Layer 4 — Session Auto-Cleanup

> **Hook**: `tool.execute.after` + `session.compacting` · **File**: `layer4-cleanup.ts`

Membersihkan "sampah" dari context window secara otomatis.

**Fitur:**

| Fitur | Deskripsi |
| :--- | :--- |
| **Error Purging** | Menghapus pesan error/tool failure setelah N turn chat (default: 4 turn). Error basi hanya membuang token. |
| **Tool-Call Dedup** | Mencegah LLM mengulangi tool call yang identik (tool + args sama) dalam session yang sama. |

---

## ⚙️ Konfigurasi

> 📖 **Dokumentasi konfigurasi lengkap** (semua key, tipe, default, contoh, preset, custom filter, troubleshooting) ada di:
> [`docs/konfigurasi-lengkap.md`](./docs/konfigurasi-lengkap.md)

### Struktur Dasar

File: `~/.config/opencode/ultrapress.json`

```jsonc
{
  "enabled": true,           // Master switch
  "notification": "minimal", // "off" | "minimal" | "detailed"
  "autoUpdate": true,        // Auto-update dari npm

  "outputFilter": { /* Layer 1 — Output Filtering */ },
  "semantic":      { /* Layer 2 — Semantic Compression */ },
  "summarization": { /* Layer 3 — DCP Pruning */ },
  "cleanup":       { /* Layer 4 — Auto Cleanup */ }
}
```

| Layer | Key | Fungsi |
| :--- | :--- | :--- |
| **L1** | `outputFilter` | Batasi panjang output CLI, filter baris repetitive |
| **L2** | `semantic` | Kompresi teks NLP/MLM tanpa merusak makna |
| **L3** | `summarization` | Hapus pesan lama, ganti ringkasan, proteksi `preserveLastN` |
| **L4** | `cleanup` | Dedup tool call, auto-purge error basi |

> 👉 **[Buka dokumentasi lengkap →](./docs/konfigurasi-lengkap.md)** mencakup semua key, tipe, default, custom filter, preset (Hemat Maksimal / Preservasi / Silent / MLM), dan troubleshooting.

---

## ⌨️ Slash Command `/up`

Semua interaksi dengan UltraPress melalui satu command: `/up`.

### Daftar Sub-command

| Command | Alias | Deskripsi |
| :--- | :--- | :--- |
| `/up stats` | `s`, `stat` | Dashboard penghematan token sesi ini |
| `/up context` | `c`, `ctx` | Status context window: kapasitas, limit, sisa |
| `/up compress` | `comp` | Tampilkan status layer + panduan kompresi |
| `/up help` | `h`, `?` | Bantuan command |

**Catatan**: Sub-command bersifat case-insensitive dan mendukung fuzzy matching parsial.

### Contoh Output

**`/up stats`**:

```
📊 ULTRAPRESS STATS
──────────────────────────────────────────
  Raw tokens       : 127,450
  Compressed tokens: 89,215
  Tokens saved     : 38,235 (30.0%)

  By Layer:
  L1 Output Filter : 18,400
  L2 Semantic      : 12,100
  L3 Summarization :  5,835
  L4 Cleanup       :  1,900

  Activity:
  Compressions : 3
  Deduplications: 12
  Errors purged: 2

  Session: 2h 15m
──────────────────────────────────────────
```

**`/up context`**:

```
🧠 CONTEXT STATUS
──────────────────────────────────────────
  Current tokens     : ~52,000
  Max context limit  : 70,000
  Available          : ~18,000 (25.7%)
  Nudge threshold    : 40,000
  Status             : 🟡 Nearing limit (nudge will fire soon)
  Next nudge in      : 3 turns
──────────────────────────────────────────
```

---

## ❷ Support MLM & NLP

### Mode NLP (Default)

Grammar stripping berbasis aturan linguistik. **Zero latency**, tidak memerlukan model eksternal.

**Cara kerja:**
1. Deteksi struktur kalimat (subjek, predikat, objek)
2. Hapus kata sambung, kata ganti berlebihan, filler words
3. Padatkan redundansi tanpa mengubah makna
4. Proteksi code blocks & error messages

### Mode MLM (Experimental)

Menggunakan **Masked Language Model** via `@huggingface/transformers` (Transformers.js) untuk tokenisasi yang lebih akurat.

**Aktivasi:**

```json
{
  "semantic": {
    "mode": "mlm",
    "model": "Xenova/distilbert-base-uncased"
  }
}
```

**Catatan Penting:**
- ⚠️ Model di-download otomatis saat pertama kali (~70MB untuk distilbert-base)
- ⚠️ First-run latency 5-15 detik untuk load model
- ⚠️ RAM usage bertambah ~200MB saat model aktif
- ⚠️ Kompatibilitas: CPU-only (tidak memerlukan GPU)
- 🌐 Untuk Bahasa Indonesia: gunakan `Xenova/bert-base-multilingual-uncased`

### Perbandingan Mode

| Aspek | NLP | MLM | LLM |
| :--- | :--- | :--- | :--- |
| **Latensi** | < 1ms | 50-200ms | 1-5s |
| **RAM** | 0 MB | ~70 MB (q8) | ~300 MB (q8) |
| **Akurasi** | ~85% | ~95% | ~99% |
| **Bahasa** | Indonesia + Inggris | 100+ bahasa | Semua |
| **Koneksi Internet** | ❌ Tidak perlu | ❌ Hanya download awal | ❌ Hanya download awal |
| **Stabil** | ✅ | ⚠️ Experimental | ⚠️ Experimental |
| **Model** | — | `all-MiniLM-L6-v2` | `t5-small` (summarization) |

---

## 🏗 Arsitektur Kode

### Struktur Direktori

```
opencode-ultrapress/
├── src/
│   ├── index.ts                    # Entry point, hook registration, plugin server
│   ├── config/
│   │   ├── schema.ts               # TypeScript type definitions (UltraPressConfig, etc.)
│   │   └── defaults.ts             # Default config values + merge logic
│   ├── layers/
│   │   ├── layer1-output-filter.ts # RTK engine — routes tool output to domain filters
│   │   ├── layer2-caveman.ts       # Semantic compression orchestrator
│   │   ├── layer3-dcp.ts           # DCP orchestrator — nudge injection, pruning trigger
│   │   └── layer4-cleanup.ts       # Auto-cleanup — dedup + error purging
│   ├── filters/
│   │   ├── git.ts                  # Git-specific output filter
│   │   ├── test.ts                 # Test runner output filter
│   │   ├── bash.ts                 # Shell output filter
│   │   ├── fs.ts                   # Filesystem tool output filter
│   │   └── generic.ts              # Fallback filter
│   ├── dcp/
│   │   ├── compress-state.ts       # In-memory state for pending compression blocks
│   │   ├── compress-tool.ts        # ultrapress_compress tool definition & handler
│   │   ├── context-monitor.ts      # Token usage monitoring + nudge logic
│   │   ├── prune.ts                # Message removal + summary injection engine
│   │   ├── protected-content.ts    # Defines which tool outputs are protected
│   │   └── summary-store.ts        # Stores summaries for nesting support
│   ├── caveman/
│   │   ├── nlp.ts                  # Rule-based NLP compressor
│   │   └── mlm.ts                  # MLM-based compressor (Transformers.js)
│   ├── commands/
│   │   └── slash.ts                # /up slash command handler
│   └── utils/
│       ├── token-count.ts          # Token estimation (char-based approximation)
│       └── logger.ts               # Logging with configurable verbosity
├── tests/
│   ├── layer1.test.ts              # Output filter unit tests
│   ├── layer2.test.ts              # Semantic compression unit tests
│   └── layer3-dcp.test.ts          # DCP pruning + nudge unit tests
├── benchmarks/
│   ├── run.ts                      # Benchmark runner
│   └── fixtures/                   # Benchmark test data
├── docs/
│   └── image/
│       └── banner.svg              # README banner
├── ultrapress.json.example         # Template konfigurasi
├── tsconfig.json                   # TypeScript config
├── tsup.config.ts                  # Build config (tsup)
├── package.json
├── CHANGELOG.md
├── LICENSE
└── README.md
```

### Hook Registration Map

| OpenCode Hook | Trigger | UltraPress Handler | Layer |
| :--- | :--- | :--- | :--- |
| `tool.execute.after` | Setelah tool CLI selesai | Output filtering + token tracking + dedup | L1, L4 |
| `chat.message` | Sebelum user message dikirim ke LLM | Pruning pending blocks + semantic compression + nudge injection | L2, L3 |
| `command.execute.before` | User mengetik `/up` | Slash command handler | — |
| `experimental.session.compacting` | OpenCode compacting session | Protected context injection | L4 |
| `config` | Plugin initialization | Register `/up` command | — |
| `tool` (definition) | Plugin init | Register `ultrapress_compress` tool | L3 |

### Data Flow Detail

```
1. Plugin Init
   config hook → register /up command
   tool definition → register ultrapress_compress
   load/migrate config from ~/.config/opencode/ultrapress.json

2. Tool Execution (every tool call)
   tool.execute.after → L1 processToolOutput()
     → Domain routing (git→git.ts, test→test.ts, etc.)
     → Middle-out truncation
     → Deduplication
   → L4 applyCleanup()
     → Dedup check
     → Error registration for purge

3. Chat Message (every user message)
   chat.message → L3 check pending compression blocks
     → applyPruning() — remove old messages, inject summaries
   → L2 processMessageContext() — semantic compression
   → L3 context monitor — check token count
     → if near limit → inject nudge prompt
   → L3 turnTick() — update turn counter

4. LLM calls ultrapress_compress
   tool.execute.after → compress tool handler
     → Create CompressionBlock in compress-state.ts
     → Store summary for nesting
   → Block will be executed on NEXT chat.message

5. Session Compacting
   session.compacting → L4 protected context injection
```

---

## 🧪 Pengujian

Jalankan seluruh test suite:

```bash
bun test
```

| Test File | Cakupan | Layer |
| :--- | :--- | :--- |
| `tests/layer1.test.ts` | Output filtering: domain routing, truncation, tee save, dedup | L1 |
| `tests/layer2.test.ts` | Semantic compression: NLP grammar stripping, code block protection, min length skip | L2 |
| `tests/layer3-dcp.test.ts` | DCP: pruning with preserveLastN, nudge frequency, nesting summaries, protected content | L3 |

```bash
# Run spesifik layer
bun test tests/layer1.test.ts
bun test tests/layer2.test.ts
bun test tests/layer3-dcp.test.ts

# Run dengan TypeScript type checking
bun run lint
```

---

## 📊 Benchmark

Jalankan benchmark lengkap untuk mengukur efektivitas **semua 4 layer**:

```bash
npm run benchmark
```

### Hasil Benchmark Terbaru

```
┌────────────────────────────────┬──────────────────────────────────────────┬────────────┬──────────────┬──────────┐
│ Fixture                        │ Layer                                    │ Original   │ Compressed   │ Savings  │
├────────────────────────────────┼──────────────────────────────────────────┼────────────┼──────────────┼──────────┤
│ git-diff-large.txt             │ L1 — Git Filter                          │      1,657 │          969 │      42% │
│ npm-install-log.txt            │ L1 — Generic Filter                      │        431 │          430 │       0% │
│ pytest-log.txt                 │ L1 — Generic Filter                      │      1,200 │        1,199 │       0% │
│ chat-history.json              │ L2 — NLP Semantic                        │        625 │          490 │      22% │
│ dcp-conversation.json          │ L3 — DCP Pruning (14→summary)            │      2,347 │          645 │      73% │
│                                │   ↳ 13 msg removed, 1 summary injected   │            │              │          │
│ 3x identical npm test          │ L4 — Tool Call Dedup                     │      2,244 │          854 │      62% │
│                                │   ↳ 2 duplicates collapsed               │            │              │          │
│ 5 errors × 6 turns             │ L4 — Error Auto-Purge                    │        845 │            0 │     100% │
│                                │   ↳ 5 errors purged after threshold      │            │              │          │
└────────────────────────────────┴──────────────────────────────────────────┴────────────┴──────────────┴──────────┘

✅ Total: 9,349 → 4,587 tokens (51% overall savings)
```

### Ringkasan per Layer

| Layer | Fixture | Avg Savings | Karakteristik |
| :--- | :--- | :--- | :--- |
| **L1** Output Filter | 3 fixture | **21%** | Paling efektif untuk log CLI verbose (`git diff`: 42%). Output pendek tidak banyak terpengaruh. |
| **L2** Semantic NLP | 1 fixture | **22%** | Konsisten mengompresi natural language tanpa merusak makna. Code blocks diproteksi penuh. |
| **L3** DCP Pruning | 1 fixture | **73%** | Penghemat terbesar — menghapus 14 pesan lama & ganti 1 ringkasan. Efek compound di session panjang. |
| **L4** Auto Cleanup | 2 fixture | **72%** | Dedup menghemat 62% dari tool call berulang. Error purge 100% setelah threshold. |

> 💡 **Insight**: L3 (DCP) adalah layer dengan penghematan tertinggi karena menghapus pesan lama secara bulk. Dalam session panjang (100+ messages), efek komulatif L3 + L4 bisa mencapai **70-90% penghematan token**. Dataset dan script ada di [`benchmarks/`](./benchmarks/) — kontribusikan fixture dari stack kamu untuk hasil yang lebih representatif.

---

## 🚀 Pengembangan Lokal

```bash
# 1. Clone repository
git clone https://github.com/rahadiana/opencode-ultrapress.git
cd opencode-ultrapress

# 2. Install dependencies
npm install

# 3. Build TypeScript
npm run build          # tsup — compile ke dist/

# 4. Development mode (watch)
npm run dev            # tsup --watch

# 5. Run tests
npm test               # bun test

# 6. Type checking
npm run lint           # tsc --noEmit

# 7. Benchmark
npm run benchmark      # tsx benchmarks/run.ts
```

**Workflow Development:**

1. Edit file di `src/`
2. `npm run dev` untuk auto-rebuild
3. `npm test` untuk verifikasi
4. Restart OpenCode untuk reload plugin
5. Test via `/up stats` di chat

---

## ❓ FAQ & Troubleshooting

<details>
<summary><b>Plugin tidak muncul setelah install</b></summary>

1. Pastikan plugin terdaftar di `~/.config/opencode/config.json`:
   ```json
   { "plugins": ["@rahadiana/opencode-ultrapress"] }
   ```
2. Restart OpenCode sepenuhnya (bukan reload window)
3. Cek apakah package terinstall: `npm list -g @rahadiana/opencode-ultrapress`
</details>

<details>
<summary><b>Error "Cannot find module @huggingface/transformers"</b></summary>

Mode MLM memerlukan dependency tambahan. Install manual:
```bash
npm install -g @huggingface/transformers
```
Atau switch ke mode `"nlp"` yang tidak memerlukan dependency eksternal.
</details>

<details>
<summary><b>OpenCode terasa lambat setelah install</b></summary>

- Cek mode semantic: `"mode": "mlm"` — MLM loading model di awal bisa lambat. Switch ke `"nlp"` untuk zero latency.
- Cek `notification` level: `"detailed"` mencetak banyak log. Set ke `"minimal"`.
- Pastikan `minLengthChars` tidak terlalu rendah (default 200 sudah optimal).
</details>

<details>
<summary><b>Pesan penting saya terhapus oleh pruning</b></summary>

- Naikkan `preserveLastN` (default 3 → coba 5 atau 7)
- Tool output penting otomatis diproteksi (`task`, `write`, `edit`, `bash`)
- Jika tetap terhapus, laporkan sebagai bug dengan log detail
</details>

<details>
<summary><b>Bagaimana cara disable layer tertentu?</b></summary>

Set `"enabled": false` pada layer yang ingin dimatikan:
```json
{
  "semantic": { "enabled": false },
  "summarization": { "enabled": false }
}
```
</details>

<details>
<summary><b>Error TypeScript saat development</b></summary>

Pastikan dependencies terinstall:
```bash
npm install
npm run lint    # tsc --noEmit untuk cek type error
```
</details>

---

## 🗺 Roadmap

| Fitur | Status | Target |
| :--- | :--- | :--- |
| Layer 1: Domain-aware output filtering | ✅ Done | v0.1.0 |
| Layer 2: NLP semantic compression | ✅ Done | v0.1.0 |
| Layer 2: MLM mode | ⚠️ Experimental | v0.2.0 |
| Layer 2: LLM mode (local summarization) | ✅ Done | v0.2.0 |
| Layer 2: All-pairs MLM dedup | ✅ Done | v0.2.0 |
| Layer 3: Block-based DCP pruning | ✅ Done | v0.1.0 |
| Layer 3: `preserveLastN` protection | ✅ Done | v0.1.0 |
| Layer 3: Multi-signal importance scoring | ✅ Done | v0.2.0 |
| Layer 3: Reversible compression (`ultrapress_expand`) | ✅ Done | v0.2.0 |
| Layer 3: Pre-emptive nudge @70% | ✅ Done | v0.2.0 |
| Layer 3: Surgical message pruning | ✅ Done | v0.1.0 |
| Layer 4: Error purging & dedup | ✅ Done | v0.1.0 |
| `/up` slash commands | ✅ Done | v0.1.0 |
| Real token tracking (OpenCode API) | ✅ Done | v0.2.0 |
| Custom filter API | ✅ Done | v0.1.0 |
| TF-IDF scoring (MLM improvement) | 🚧 Planned | v0.2.0 |
| Sentence similarity (MLM improvement) | 🚧 Planned | v0.2.0 |
| Sub-agent (`task`) token tracking & compression | 💡 Idea | TBD |
| UI stats dashboard di OpenCode | 💡 Idea | TBD |
| Support lebih banyak bahasa (NLP) | 💡 Idea | TBD |

---

## 🤝 Kontribusi

Kontribusi sangat diterima! Area yang paling membutuhkan bantuan:

1. **New Filters**: Tambahkan filter Layer 1 untuk framework/stack baru (Kubernetes, Docker, Terraform, Svelte, Flutter, dll).
2. **MLM Roadmap**: Bantu implementasi TF-IDF scoring atau sentence similarity yang sebenarnya.
3. **Benchmark Dataset**: Kontribusikan fixture data dari stack teknologi kamu.
4. **Multi-language NLP**: Perluas aturan grammar stripping untuk lebih banyak bahasa.
5. **Bug Reports**: Laporkan edge case — tool output yang tidak terfilter dengan baik, pesan penting yang terhapus, dll.

### Development Setup

```bash
git clone https://github.com/rahadiana/opencode-ultrapress.git
cd opencode-ultrapress
npm install
npm run build
npm test
npm run benchmark
```

### Pull Request Process

1. Fork repository
2. Buat branch fitur (`git checkout -b feature/amazing-filter`)
3. Commit perubahan (`git commit -m 'Add amazing filter'`)
4. Push ke branch (`git push origin feature/amazing-filter`)
5. Buka Pull Request — pastikan `bun test` dan `npm run lint` passing

---

## 📝 Changelog

Lihat [CHANGELOG.md](./CHANGELOG.md) untuk riwayat lengkap perubahan per versi.

---

## 📄 License

MIT © [rahadiana](https://github.com/rahadiana)

---

<div align="center">

**UltraPress** — *Because tokens are expensive, but context is priceless.* ❤️

</div>
