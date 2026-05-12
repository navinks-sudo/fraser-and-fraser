# Fraser & Fraser — Genealogy Pipeline

End-to-end AI-driven genealogy portal: upload archival scans / PDFs / spreadsheets, OCR them, extract every person and relationship with Gemini, and render an editable family tree.

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI · SQLAlchemy (async) · SQLite |
| Frontend | React 19 · Vite · TanStack Query · Zustand · Tailwind 4 · react-d3-tree |
| OCR | Ollama (`qwen2.5vl:7b`) primary · Google Gemini (`gemini-2.5-flash`) fallback |
| Structured extraction & tree synthesis | Google Gemini (`gemini-2.5-flash`) |
| PDF | PyMuPDF (renders each page → PNG) |
| Spreadsheets | openpyxl (xlsx/xls/csv/tsv) |

## Pipeline stages

1. **Upload** — images, PDFs (auto-split per page), or Excel/CSV.
2. **VisionMax** — manual + AI quality scoring (sharpness, contrast, noise, brightness, skew) with before/after gauges.
3. **TextIQ** — region-segmented OCR with word/char confidence (HSL heat-map), per-region translation to English.
4. **IndexGenius** — Gemini extracts every person + every relation + open-ended metadata, with self-rated per-field confidence.
5. **GedcomX** — Persons / Relationships / Raw JSON tabs, exportable.
6. **Family Tree** — gender-coloured circular avatars, click-to-inspect side panel, manual edit (add person, link relationships, delete), save back to DB, side-by-side compare with the source file.

## Quick start

```bash
# 1. Backend
pip install -r backend/requirements.txt
cp .env.example .env  # then fill in GEMINI_API_KEY
python seed_user.py    # creates admin / password123
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --timeout-keep-alive 600

# Windows shortcut:
#   double-click run_backend.bat

# 2. Frontend
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 → log in (`admin / password123`).

## Local OCR via Ollama

```bash
ollama pull qwen2.5vl:7b
ollama serve   # exposes :11434/v1
```

OCR will run entirely on your machine. Gemini handles the structured-extraction and tree-synthesis steps.

## Notes

- The SQLite DB and the `storage/` folder (uploaded images, parsed spreadsheets, rendered PDF pages) are **gitignored** — they'll regenerate from your uploads.
- `.env` is gitignored — never commit your Gemini key. Use `.env.example` as a template.
