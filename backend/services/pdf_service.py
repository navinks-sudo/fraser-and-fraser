"""PDF support — split a PDF into one PNG per page so each page flows through
the regular VisionMax → TextIQ → IndexGenius pipeline like a normal image.

Uses PyMuPDF (fitz) — pure-Python wheel, no external poppler dependency. Renders
each page at 200 DPI by default which is the sweet spot for OCR on archival
scans without producing absurdly large files.
"""
import io
from pathlib import Path

import fitz  # PyMuPDF


PDF_EXTS = {".pdf"}


def is_pdf(filename: str) -> bool:
    return Path(filename).suffix.lower() in PDF_EXTS


def split_pdf_to_pngs(pdf_bytes: bytes, dpi: int = 200) -> list[bytes]:
    """Render every page of a PDF to a PNG.

    Returns a list of PNG byte strings, one per page, in order.
    """
    images: list[bytes] = []
    zoom = dpi / 72  # PyMuPDF measures in 72-DPI units
    matrix = fitz.Matrix(zoom, zoom)

    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        for page in doc:
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            buf = io.BytesIO()
            buf.write(pix.tobytes("png"))
            images.append(buf.getvalue())
    return images


def page_count(pdf_bytes: bytes) -> int:
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        return doc.page_count
