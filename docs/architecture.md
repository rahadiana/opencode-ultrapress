# Architecture — OpenCode UltraPress

## Pipeline Overview

Data dari setiap interaksi di OpenCode mengalir melalui 4 layer pertahanan secara berurutan. Penting: setiap layer berjalan pada **hook yang berbeda**, bukan dalam satu pipeline yang sama.

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

## Urutan Eksekusi Per Hook

### `tool.execute.after`
1. **Layer 1** — Filter output tool mentah sebelum masuk ke context window.
2. **Layer 4 (Dedup)** — Cek apakah output identik dengan sebelumnya; jika ya, hapus.

### `chat.message`
1. **Layer 3 (DCP)** — Hitung estimasi token kumulatif. Jika mendekati limit, inject nudge prompt.
2. **Layer 2 (GSC Semantic)** — Kompresi semantik pada pesan user/assistant yang lolos filter role & panjang minimum.
3. **Layer 4 (Purge)** — Tandai pesan error lama untuk dihapus setelah N turn.

### `experimental.session.compacting` _(jika OpenCode mensupport hook ini)_
- **Layer 3 (Protected Context)** — Inject ringkasan yang dilindungi agar tidak hilang saat OpenCode melakukan auto-compaction.

---

## Kenapa Tidak Ada Double Compression?

Layer 2 dan Layer 3 **tidak saling kompresi satu sama lain** karena:

1. **Layer 2** beroperasi pada **teks pesan individu** (user message atau assistant response).
2. **Layer 3** hanya **menghitung token** dan menyisipkan teks nudge baru — ia tidak mengkompresi ulang teks yang sudah ada.
3. Layer 3 mendeklarasikan `ultrapress_compress` sebagai **tool untuk LLM** (bukan auto-compression). LLM yang secara otonom memanggil tool itu, bukan sistem UltraPress.

---

## Error Handling Strategy

| Layer | Behavior Saat Error |
| :--- | :--- |
| Layer 1 | Fallback ke raw output — **tidak pernah crash** |
| Layer 2 (NLP) | Fallback ke teks asli — compression dianggap gagal, session lanjut normal |
| Layer 2 (MLM) | Fallback ke NLP mode — model gagal load, tapi session tetap jalan |
| Layer 3 | Skip nudge — tidak ada efek samping |
| Layer 4 | Skip purge — pesan lama tetap ada |

Semua layer menggunakan pola `try/catch` yang mengembalikan input asli (*passthrough*) pada kegagalan.

---

## Keterbatasan yang Diketahui

- **MLM mode** saat ini menggunakan model sebagai tokenizer yang lebih akurat, bukan untuk inferensi penuh. Ini adalah **EXPERIMENTAL** feature. Lihat [MLM Mode](#mlm-mode-experimental) di README.
- Token counting menggunakan heuristic berbasis karakter (3.7 chars/token untuk prosa), bukan `tiktoken`. Akurasi ~85-90% untuk campuran Inggris/kode.
- Hook `tool.execute.after` hanya aktif jika OpenCode memanggil tool melalui agent loop — tidak berlaku untuk pesan manual.
