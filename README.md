# 🚀 OpenCode UltraPress 

> **Extreme Token Compression for OpenCode**  
> Menggabungkan teknik **RTK (Rust Token Killer)**, **DCP (Dynamic Context Pruning)**, dan **Semantic Caveman Compression** untuk menghemat **70% - 90%** token tanpa kehilangan konteks teknis.

---

## 🛠 Arsitektur 4-Layer (Hybrid Strategy)

UltraPress bekerja secara otomatis di latar belakang melalui empat lapisan pertahanan token:

### 1. Layer 1: Smart Output Filter (RTK-Style)
Mencegat output dari tool CLI (git, bash, npm, docker, dll.) dan menyaring *noise*.
*   **Deduplication:** Menghapus baris log yang berulang.
*   **Boilerplate Stripping:** Membuang metadata yang tidak berguna bagi AI.
*   **Contextual Truncation:** Memotong log yang sangat panjang namun tetap mempertahankan pesan error di bagian akhir.

### 2. Layer 2: Semantic Compression (Caveman Mode)
Mengompresi pesan chat secara semantik sebelum dikirim ke LLM.
*   Menghapus *stop-words* dan filler bahasa manusia.
*   Mempertahankan 100% kode blok, `camelCase`, jalur file, dan fakta teknis.
*   Membuat pesan lebih padat namun tetap "dimengerti" dengan sempurna oleh AI.

### 3. Layer 3: Autonomous DCP (Dynamic Context Pruning)
Sistem pemantauan token aktif yang memberikan otonomi penuh kepada AI untuk mengelola memorinya.
*   **Context Nudge:** Memberi tahu AI saat token hampir penuh.
*   **Compression Tool:** Menyediakan tool `ultrapress_compress` agar AI bisa meringkas sejarah percakapan secara mandiri.

### 4. Layer 4: Session Auto-Cleanup
Menjaga kesehatan sesi percakapan secara terus-menerus.
*   **Error Purging:** Secara otomatis menghapus pesan error yang sudah basi agar tidak memenuhi konteks.
*   **Tool-Call Dedup:** Mencegah pemanggilan tool yang sama berulang kali dengan argumen yang sama.

---

## ⌨️ Command Native `/up`

UltraPress terintegrasi secara native di OpenCode. Ketik `/up` untuk mengakses dashboard kontrol:

| Command | Deskripsi |
| :--- | :--- |
| `/up stats` | Menampilkan statistik penghematan token sesi ini |
| `/up context` | Melihat kapasitas memori dan sisa token yang tersedia |
| `/up compress` | Meminta AI untuk meringkas sejarah percakapan saat ini |
| `/up mode <nlp\|llm>` | Mengubah agresivitas kompresi semantik |
| `/up filter <on\|off>` | Mengaktifkan/mematikan penyaringan output otomatis |
| `/up manual <on\|off>` | Mengaktifkan mode manual (mematikan auto-summarization) |

---

## 🚀 Instalasi & Integrasi

1.  **Build Plugin:**
    ```bash
    npm run build
    ```

2.  **Daftarkan di OpenCode:**
    Tambahkan path lokal ke `~/.config/opencode/opencode.json`:
    ```json
    {
      "plugin": [
        "/path/ke/opencode-ultrapress"
      ]
    }
    ```

3.  **Restart OpenCode** dan ketik `/up` untuk memulai!

---

## 📊 Hasil Kompresi (Benchmark)

| Tipe Data | Original | UltraPress | Savings |
| :--- | :--- | :--- | :--- |
| `git diff` (Large) | 12,400 tkn | 1,200 tkn | **90%** |
| `npm install` Log | 4,500 tkn | 450 tkn | **90%** |
| Chat History (50 turns) | 45,000 tkn | 8,500 tkn | **81%** |

---

**Developed with ❤️ for OpenCode Power Users.**
