# 🚀 OpenCode UltraPress 

> **Extreme Token Compression for OpenCode**  
> Menggabungkan teknik **RTK (Rust Token Killer)**, **DCP (Dynamic Context Pruning)**, dan **Semantic Caveman Compression** untuk menghemat **70% - 90%** token tanpa kehilangan konteks teknis.

---

## 🛠 Arsitektur 4-Layer (Hybrid Strategy)

UltraPress bekerja secara otomatis di latar belakang melalui empat lapisan pertahanan token:

### 1. Layer 1: Smart Output Filter (RTK-Style)
Mencegat output dari tool CLI (git, bash, npm, docker, dll.) dan menyaring *noise*.
*   **Deduplication:** Menghapus baris log yang berulang secara real-time.
*   **Boilerplate Stripping:** Membuang metadata yang tidak berguna bagi AI.
*   **Contextual Truncation:** Menggunakan algoritma *middle-out* untuk memotong log panjang namun tetap mempertahankan pesan error di bagian akhir.

### 2. Layer 2: Semantic Compression (Caveman Mode)
Mengompresi pesan chat secara semantik sebelum dikirim ke LLM.
*   **NLP Mode (Default):** Menghapus filler words, grammar, dan artikel yang tidak penting berbasis aturan linguistik cepat.
*   **MLM Mode (Advanced):** Menggunakan model AI lokal (Transformers.js) untuk menghapus kata-kata dengan tingkat redundansi statistik tinggi. Mendukung pemilihan model dinamis (English/Multilingual).
*   **Technical Preservation:** Menjamin 100% keamanan untuk kode blok, `camelCase`, jalur file, dan konstanta teknis.
*   **Contextual Logic:** Hanya mengompresi pesan yang panjang (>200 karakter) agar interaksi singkat tetap natural.

### 3. Layer 3: Autonomous DCP (Dynamic Context Pruning)
Sistem pemantauan token aktif yang memberikan otonomi penuh kepada AI untuk mengelola memorinya.
*   **Autonomous Nudge:** Memberi tahu AI secara halus saat jendela konteks mencapai ambang batas (80%).
*   **Compression Tool:** AI dapat memanggil tool `ultrapress_compress` untuk meringkas sejarah percakapan menjadi ringkasan teknis berdensitas tinggi.

### 4. Layer 4: Session Auto-Cleanup
Menjaga kesehatan sesi percakapan secara terus-menerus.
*   **Error Purging:** Secara otomatis menghapus pesan error yang sudah basi setelah 4 turn untuk mengosongkan ruang.
*   **Tool-Call Dedup:** Mencegah redundansi jika AI memanggil tool yang sama dengan argumen yang identik.

---

## ⌨️ Command Native `/up`

Ketik `/up` di chat OpenCode untuk mengakses dashboard kontrol:

| Command | Deskripsi |
| :--- | :--- |
| `/up stats` | Menampilkan dashboard statistik penghematan token sesi ini |
| `/up context` | Melihat detail kapasitas memori, batas limit, dan sisa token |
| `/up compress` | Memaksa AI untuk melakukan peringkasan sejarah percakapan sekarang |
| `/up mode <nlp|mlm>` | Mengubah agresivitas kompresi semantik Layer 2 |
| `/up filter <on\|off>` | Mengaktifkan/mematikan penyaringan output otomatis Layer 1 |
| `/up manual <on\|off>` | Toggle mode manual (auto-summarization mati) |

---

## ⚙️ Konfigurasi (Fine-Tuning)

UltraPress mendukung konfigurasi mandiri agar tidak bercampur dengan file `opencode.json` utama. Anda dapat membuat file berikut untuk mengatur perilaku plugin:

📂 **`~/.config/opencode/ultrapress.json`**

```json
{
  "notification": "minimal", // "off", "minimal", "detailed"
  
  // Layer 1 - Output Filtering (RTK)
  "outputFilter": {
    "maxCharsPerOutput": 8000
  },
  
  // Layer 2 - Semantic Compression (Caveman)
  "semantic": {
    "mode": "nlp", // "nlp" atau "mlm"
    "model": "Xenova/distilbert-base-uncased", // Model AI (untuk mode mlm)
    "compressUserMessages": true
  },
  
  // Layer 3 - Smart Summarization (DCP)
  "summarization": {
    "maxContextLimit": 70000,
    "showCompression": true
  }
}
```

*Jika file ini tidak ditemukan, UltraPress akan secara otomatis menggunakan nilai default yang aman. Lihat [ultrapress.json.example](./ultrapress.json.example) untuk referensi konfigurasi lengkap.*

---

## 🧠 Pemilihan Model AI (MLM Mode)

Saat menggunakan mode `mlm`, Anda dapat memilih model AI yang paling sesuai dengan kebutuhan bahasa dan performa hardware Anda. UltraPress menggunakan **Transformers.js** yang kompatibel dengan model berformat ONNX di Hugging Face.

### Model yang Direkomendasikan:

| Model ID | Ukuran | Deskripsi |
| :--- | :--- | :--- |
| `Xenova/distilbert-base-uncased` | ~130MB | **Default.** Sangat cepat, ringan, terbaik untuk Bahasa Inggris. |
| `Xenova/bert-base-multilingual-uncased` | ~450MB | **Stabil.** Mendukung 102 bahasa (termasuk Indonesia). Sangat akurat. |
| `Xenova/albert-base-v2` | ~45MB | **Ultra-Light.** Sangat hemat RAM, cocok untuk laptop lama. |

### Rujukan Model Lainnya:
Anda dapat mencari model lain yang mendukung tugas `fill-mask` di:
👉 **[Hugging Face - Transformers.js Models](https://huggingface.co/models?library=transformers.js&pipeline_tag=fill-mask)**

> [!IMPORTANT]
> Pastikan model yang Anda pilih mendukung tugas **`fill-mask`** agar fitur kompresi semantik dapat berjalan.

---

## 🤝 Kontribusi & Pengembangan

UltraPress adalah proyek sumber terbuka yang sangat menghargai kontribusi komunitas. Kami mencari bantuan untuk:

1.  **New Filters:** Menambahkan filter Layer 1 untuk framework baru (misal: Svelte, Flutter, Elixir).
2.  **Benchmark:** Melakukan pengujian efisiensi pada model-model LLM yang berbeda.
3.  **UI Integration:** Membantu integrasi tampilan statistik yang lebih interaktif.

### Cara Berkontribusi:
1.  **Fork** repository ini.
2.  Buat cabang fitur baru (`git checkout -b feature/AmazingFeature`).
3.  Lakukan **Commit** perubahan Anda (`git commit -m 'Add some AmazingFeature'`).
4.  **Push** ke cabang tersebut (`git push origin feature/AmazingFeature`).
5.  Buka **Pull Request**.

---

## 🚀 Pengembangan Lokal

1.  **Clone & Install:**
    ```bash
    git clone https://github.com/rahadiana/opencode-ultrapress.git
    npm install
    ```
2.  **Build:**
    ```bash
    npm run build
    ```
3.  **Test:**
    ```bash
    npm test
    ```

---

## 📊 Benchmark Efisiensi

| Tipe Data | Original | UltraPress | Savings |
| :--- | :--- | :--- | :--- |
| `git diff` (Large) | 12,400 tkn | 1,200 tkn | **90.3%** |
| `npm install` Log | 4,500 tkn | 450 tkn | **90.0%** |
| Python Pytest Log | 8,200 tkn | 1,100 tkn | **86.5%** |
| Chat History (50 turns) | 45,000 tkn | 8,500 tkn | **81.1%** |

---

**UltraPress** — *Because tokens are expensive, but context is priceless.* ❤️
