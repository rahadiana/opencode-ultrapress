# ⚙️ Konfigurasi UltraPress — Referensi Lengkap

> File: `~/.config/opencode/ultrapress.json`

UltraPress bekerja *out-of-the-box* dengan nilai default terbaik. File konfigurasi bersifat opsional — jika tidak ditemukan, plugin akan otomatis membuatnya saat pertama kali dijalankan.

---

## 📋 Struktur Dasar

```jsonc
{
  "enabled": true,           // Master switch
  "notification": "minimal", // Level notifikasi
  "autoUpdate": true,        // Auto-update dari npm

  // LAYER 1 — Output Filtering
  "outputFilter": { /* ... */ },

  // LAYER 2 — Semantic Compression
  "semantic": { /* ... */ },

  // LAYER 3 — Dynamic Context Pruning (DCP)
  "summarization": { /* ... */ },

  // LAYER 4 — Auto Cleanup
  "cleanup": { /* ... */ }
}
```

---

## 🔘 Global Settings

| Key | Tipe | Default | Deskripsi |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | `true` | Master switch. `false` = matikan seluruh plugin. |
| `notification` | `"off"` / `"minimal"` / `"detailed"` | `"minimal"` | Seberapa detail log UltraPress di console OpenCode. |
| `autoUpdate` | `boolean` | `true` | Auto-check & update dari npm saat OpenCode restart. |

---

## 🎯 Layer 1 — Output Filter

Mencegat output tool CLI sebelum masuk context window. Paling efektif untuk log panjang & repetitive.

| Key | Tipe | Default | Deskripsi |
| :--- | :--- | :--- | :--- |
| `outputFilter.enabled` | `boolean` | `true` | Aktifkan Layer 1. |
| `outputFilter.maxCharsPerOutput` | `number` | `8000` | Batas karakter sebelum dipotong *middle-out*. Awal & akhir output dipertahankan. |
| `outputFilter.teeSaveOnTruncate` | `boolean` | `true` | Jika output terpotong, simpan log asli ke file `.log` sementara. Berguna untuk debugging. |
| `outputFilter.customFilters` | `CustomFilter[]` | `[]` | Filter kustom untuk tool CLI spesifik. [Lihat detail](#custom-filters). |

### Contoh Kasus

```jsonc
{
  "outputFilter": {
    "maxCharsPerOutput": 4000,   // lebih agresif — potong di 4k karakter
    "teeSaveOnTruncate": true
  }
}
```

> 💡 Untuk sesi dengan banyak `git diff` atau `npm install`, turunkan `maxCharsPerOutput` ke 2000-4000.

---

## 🧠 Layer 2 — Semantic Compression

Mengompresi teks pesan secara semantik tanpa mengubah makna. Tidak menyentuh code blocks.

| Key | Tipe | Default | Deskripsi |
| :--- | :--- | :--- | :--- |
| `semantic.enabled` | `boolean` | `true` | Aktifkan Layer 2. |
| `semantic.mode` | `"nlp"` / `"mlm"` / `"llm"` | `"nlp"` | Mode kompresi. NLP = rule-based (zero latency). MLM = AI-based (perlu download model). LLM = via LLM API *(coming soon)*. |
| `semantic.model` | `string` | `"Xenova/distilbert-base-uncased"` | Model MLM (hanya untuk mode `mlm`). |
| `semantic.compressUserMessages` | `boolean` | `true` | Kompresi pesan dari user. |
| `semantic.compressAssistantMessages` | `boolean` | `false` | Kompresi pesan dari assistant. Tidak disarankan karena bisa menghilangkan nuance. |
| `semantic.compressToolOutputs` | `boolean` | `true` | Kompresi output tool setelah diffilter L1. |
| `semantic.protectCodeBlocks` | `boolean` | `true` | **JANGAN PERNAH** sentuh konten dalam triple backticks (```` ``` ````). |
| `semantic.protectErrors` | `boolean` | `true` | Lindungi error messages dan stack traces agar tetap akurat. |
| `semantic.minLengthChars` | `number` | `200` | Skip kompresi jika teks lebih pendek dari ini. Hemat CPU untuk pesan pendek. |

### Mode NLP (Default)

```jsonc
{
  "semantic": {
    "mode": "nlp"
  }
}
```

Grammar stripping berbasis aturan linguistik:
- Hapus kata sambung (`yang`, `dan`, `akan`, `bahwa`)
- Padatkan kata ganti berlebihan
- Normalisasi whitespace
- **Zero latency** (< 1ms per pesan)

### Mode MLM (Experimental)

```jsonc
{
  "semantic": {
    "mode": "mlm",
    "model": "Xenova/all-MiniLM-L6-v2"
  }
}
```

Menggunakan **Masked Language Model** via Transformers.js:
- Download model ~70MB saat pertama kali
- Latensi 50-200ms per pesan
- RAM tambahan ~200MB
- Deteksi duplikat semantik (cosine similarity antar kalimat)
- **Wajib**: `npm install -g @xenova/transformers`

| Model | Bahasa | Ukuran | Akurasi |
| :--- | :--- | :--- | :--- |
| `Xenova/distilbert-base-uncased` | Inggris | ~70MB | ~95% |
| `Xenova/all-MiniLM-L6-v2` | Multilingual | ~80MB | ~93% |
| `Xenova/bert-base-multilingual-uncased` | 100+ bahasa (incl. Indonesia) | ~170MB | ~94% |

### Contoh Kasus

```jsonc
{
  "semantic": {
    "mode": "nlp",
    "compressAssistantMessages": false,
    "minLengthChars": 500,        // hanya kompresi pesan panjang
    "protectCodeBlocks": true,
    "protectErrors": true
  }
}
```

---

## ✂️ Layer 3 — Dynamic Context Pruning (DCP)

Layer paling powerful. **Menghapus pesan lama dari context window** dan menggantinya dengan ringkasan. LLM diberi otonomi memanggil `ultrapress_compress`.

| Key | Tipe | Default | Deskripsi |
| :--- | :--- | :--- | :--- |
| `summarization.enabled` | `boolean` | `true` | Aktifkan Layer 3. |
| `summarization.mode` | `"range"` / `"message"` | `"range"` | Mode pruning: `range` (blok pesan berurutan) atau `message` (satu/beberapa ID spesifik). |
| `summarization.maxContextLimit` | `number` | `70000` | Ambang batas **keras**. Saat token mencapai ini, pruning HARUS dilakukan. |
| `summarization.minContextLimit` | `number` | `40000` | Ambang batas **nudge**. Saat token di atas ini, LLM diberi peringatan. |
| `summarization.nudgeFrequency` | `number` | `5` | Munculkan nudge setiap N turn chat (setelah melewati minContextLimit). |
| `summarization.summaryBuffer` | `boolean` | `true` | Setelah kompresi, beri jeda sebelum nudge aktif lagi. Mencegah spam nudge. |
| `summarization.showCompression` | `boolean` | `true` | Tampilkan notifikasi ke user saat kompresi berhasil. |
| `summarization.preserveLastN` | `number` | `3` | Jangan prune N pesan **terakhir** (0 = disable). Melindungi konteks percakapan terkini. |

### Alur Kerja

```
1. Context Monitor → deteksi token > minContextLimit (40k)
2. Nudge → sisipkan peringatan ke user prompt (setiap nudgeFrequency turn)
3. LLM panggil → ultrapress_compress(mode="range", from="msg_X", to="msg_Y")
4. Compression Block → disimpan di memory (belum dieksekusi)
5. Chat berikutnya → block dieksekusi: hapus msg_X sd msg_Y, sisipkan ringkasan
```

### preserveLastN

Proteksi pesan terbaru agar tidak terhapus oleh pruning. Sangat penting untuk:

- **Percakapan yang sedang aktif** — konteks terkini tetap utuh
- **Instruksi yang baru diberikan** — tidak hilang sebelum dieksekusi
- **Feedback loop** — koreksi user terbaru tetap terbaca

```jsonc
{
  "summarization": {
    "preserveLastN": 5  // lindungi 5 pesan terakhir
  }
}
```

> `preserveLastN: 0` = matikan proteksi. Semua pesan kecuali yang diproteksi (`task`, `write`, `edit`) bisa kena pruning.

### Protected Content

Tool output berikut **otomatis diproteksi** dari pruning:

- `task` — delegasi sub-agent
- `write` — file writing
- `edit` — file editing
- `bash` (hanya hasil error) — `bash` hasil sukses tetap bisa dipruning
- `read` — file reading (hanya output yang difilter)

### Contoh Kasus

```jsonc
{
  "summarization": {
    "maxContextLimit": 50000,     // lebih agresif — prune di 50k
    "minContextLimit": 30000,     // nudge mulai di 30k
    "nudgeFrequency": 3,          // nudge lebih sering
    "preserveLastN": 4
  }
}
```

```jsonc
{
  "summarization": {
    "maxContextLimit": 100000,    // conservative — biarkan konteks besar
    "minContextLimit": 60000,
    "nudgeFrequency": 8,          // jarang nudge
    "preserveLastN": 6
  }
}
```

---

## 🧹 Layer 4 — Auto Cleanup

Membersihkan "sampah" dari context window secara otomatis.

| Key | Tipe | Default | Deskripsi |
| :--- | :--- | :--- | :--- |
| `cleanup.deduplication.enabled` | `boolean` | `true` | Cegah tool call identik berulang (tool + args sama). |
| `cleanup.purgeErrors.enabled` | `boolean` | `true` | Hapus pesan error otomatis setelah N turn. |
| `cleanup.purgeErrors.turns` | `number` | `4` | Jumlah turn sebelum error dihapus. |

### Deduplication

Tool call yang sama dengan argumen identik → output kedua diganti dengan referensi singkat:

```
[Duplicate output. Identical to previous call #abc123]
Summary: <100 karakter pertama dari output asli>
```

**Tool yang didedup**: `bash`, `read_file`, `list_dir`, `grep_search`, `shell`, `run_command`

**Pengecualian** (tidak di-dedup meskipun identik):
- `bash` perintah yang mengubah state: `git commit`, `git push`, `npm install`, `cargo build`, `rm`, `touch`

### Error Purging

Error yang sudah basi (lebih dari N turn) otomatis dihapus dari context. Mencegah error lama memenuhi context window.

```jsonc
{
  "cleanup": {
    "deduplication": { "enabled": true },
    "purgeErrors": {
      "enabled": true,
      "turns": 3       // hapus error setelah 3 turn (lebih agresif)
    }
  }
}
```

---

## 🔧 Custom Filters

Tambahkan filter kustom untuk tool CLI yang tidak tercover oleh filter bawaan.

```jsonc
{
  "outputFilter": {
    "customFilters": [
      {
        "commandPattern": "kubectl|helm",
        "stripPatterns": [
          "^\\s*$",                       // baris kosong
          "^(NAME|AGE|STATUS|READY)\\s",  // header tabel
          "^\\|──",                       // tree chars
          "^\\s*ok$"                      // status ok
        ],
        "keepPatterns": [
          "Error",                        // selalu pertahankan error
          "Failed",
          "CrashLoopBackOff",
          "ImagePullBackOff"
        ],
        "maxLines": 200
      }
    ]
  }
}
```

| Field | Tipe | Deskripsi |
| :--- | :--- | :--- |
| `commandPattern` | `string` (regex) | Pola nama command yang difilter. `kubectl|helm` = filter semua command mengandung kata kubectl atau helm. |
| `stripPatterns` | `string[]` (regex) | Baris yang **match** pola ini → dihapus. |
| `keepPatterns` | `string[]` (regex) | Baris yang **match** pola ini → **selalu** dipertahankan (override stripPatterns). |
| `maxLines` | `number` | Batas maksimum baris output (middle-out truncation). |

### Contoh Filter per Stack

<details>
<summary><b>Kubernetes / Docker</b></summary>

```json
{
  "commandPattern": "kubectl|docker|helm",
  "stripPatterns": ["^\\s*$", "^(NAME|AGE|STATUS|IMAGE)\\s"],
  "keepPatterns": ["Error|Failed|CrashLoop|BackOff"],
  "maxLines": 150
}
```
</details>

<details>
<summary><b>Build Tools (Webpack, Vite, Turbopack)</b></summary>

```json
{
  "commandPattern": "webpack|vite|turbo",
  "stripPatterns": ["√|✓|ℹ", "^(cache|sync)", "^\\(symbol"],
  "keepPatterns": ["ERROR|WARNING|FAILED"],
  "maxLines": 100
}
```
</details>

<details>
<summary><b>Database (psql, mysql, mongo)</b></summary>

```json
{
  "commandPattern": "psql|mysql|mongosh",
  "stripPatterns": ["^-\\(.*rows?\\)", "^\\s*\\|", "^\\(\\d+ rows?\\)"],
  "keepPatterns": ["ERROR|FATAL|syntax error|constraint"],
  "maxLines": 300
}
```
</details>

---

## 🎯 Preset Konfigurasi

<details>
<summary><b>🔋 Hemat Maksimal</b> — Session panjang / banyak tool output</summary>

```json
{
  "notification": "minimal",
  "outputFilter": {
    "maxCharsPerOutput": 4000,
    "teeSaveOnTruncate": true
  },
  "semantic": {
    "mode": "nlp",
    "minLengthChars": 150,
    "compressUserMessages": true,
    "compressToolOutputs": true
  },
  "summarization": {
    "maxContextLimit": 50000,
    "minContextLimit": 25000,
    "nudgeFrequency": 3,
    "preserveLastN": 2,
    "showCompression": false
  },
  "cleanup": {
    "deduplication": { "enabled": true },
    "purgeErrors": { "enabled": true, "turns": 3 }
  }
}
```
</details>

<details>
<summary><b>🧠 Preservasi Maksimal</b> — Session coding intensif</summary>

```json
{
  "notification": "detailed",
  "outputFilter": {
    "maxCharsPerOutput": 12000,
    "teeSaveOnTruncate": true
  },
  "semantic": {
    "mode": "nlp",
    "compressAssistantMessages": false,
    "minLengthChars": 500,
    "protectCodeBlocks": true
  },
  "summarization": {
    "maxContextLimit": 100000,
    "minContextLimit": 60000,
    "nudgeFrequency": 8,
    "preserveLastN": 6,
    "showCompression": true
  },
  "cleanup": {
    "deduplication": { "enabled": true },
    "purgeErrors": { "enabled": false }
  }
}
```
</details>

<details>
<summary><b>🔇 Silent Mode</b> — Tidak ada notifikasi sama sekali</summary>

```json
{
  "notification": "off",
  "semantic": { "minLengthChars": 999999 },
  "summarization": {
    "showCompression": false,
    "maxContextLimit": 200000,
    "minContextLimit": 150000
  }
}
```
</details>

<details>
<summary><b>🧪 MLM Mode</b> — Gunakan AI untuk kompresi semantik</summary>

```json
{
  "semantic": {
    "mode": "mlm",
    "model": "Xenova/bert-base-multilingual-uncased",
    "minLengthChars": 300,
    "protectCodeBlocks": true,
    "protectErrors": true
  }
}
```

> ⚠️ Wajib install: `npm install -g @xenova/transformers`
> ⚠️ Model didownload otomatis (~170MB untuk multilingual)
</details>

---

## 📦 Skema TypeScript (Type Definitions)

Untuk referensi tipe yang lebih detail, lihat [`src/config/schema.ts`](../src/config/schema.ts):

```typescript
interface UltraPressConfig {
  enabled: boolean
  autoUpdate: boolean
  notification: "off" | "minimal" | "detailed"

  outputFilter: OutputFilterConfig
  semantic: SemanticConfig
  summarization: SummarizationConfig
  cleanup: CleanupConfig
}

interface OutputFilterConfig {
  enabled: boolean
  maxCharsPerOutput: number
  teeSaveOnTruncate: boolean
  customFilters: CustomFilter[]
}

interface SemanticConfig {
  enabled: boolean
  mode: "nlp" | "mlm" | "llm"
  model?: string
  compressUserMessages: boolean
  compressAssistantMessages: boolean
  compressToolOutputs: boolean
  protectCodeBlocks: boolean
  protectErrors: boolean
  minLengthChars: number
}

interface SummarizationConfig {
  enabled: boolean
  mode: "range" | "message"
  maxContextLimit: number
  minContextLimit: number
  nudgeFrequency: number
  summaryBuffer: boolean
  showCompression: boolean
  preserveLastN: number
}

interface CleanupConfig {
  deduplication: { enabled: boolean }
  purgeErrors: { enabled: boolean; turns: number }
}
```

---

## ❓ Troubleshooting Konfigurasi

| Problem | Penyebab | Solusi |
| :--- | :--- | :--- |
| Plugin tidak aktif | `enabled: false` | Set `"enabled": true` |
| Pesan penting terhapus | `preserveLastN` terlalu kecil | Naikkan ke 5-7 |
| OpenCode lambat | Mode `mlm` + model besar | Switch ke `"mode": "nlp"` |
| Notifikasi terlalu banyak | `notification: "detailed"` | Set ke `"minimal"` atau `"off"` |
| Error tidak kunjung hilang | `purgeErrors.turns` terlalu besar | Turunkan ke 2-3 |
| Semua tool call di-dedup | Perintah stateful ikut kena dedup | Built-in sudah handle ini. Jika ada yang terlewat, laporkan. |

---

> 💡 **Best Practice**: Mulai dengan default, lalu adjust berdasarkan pola penggunaan. Untuk session panjang (>100 pesan), turunkan `maxContextLimit` dan naikkan `preserveLastN`.
