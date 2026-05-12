"""Parses uploaded spreadsheet files (.xlsx, .xls, .csv) into a JSON-friendly form."""
import csv
import io
from pathlib import Path
from typing import Any

import openpyxl


SPREADSHEET_EXTS = {".xlsx", ".xls", ".csv", ".tsv"}


def is_spreadsheet(filename: str) -> bool:
    return Path(filename).suffix.lower() in SPREADSHEET_EXTS


def _stringify(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (str, int, float, bool)):
        return v
    return str(v)


def parse_spreadsheet(file_path: str) -> dict:
    """Parse the file and return:

    {
        "sheets": [
            {
                "name": "Sheet1",
                "columns": ["Name", "Birth", ...],   # first row treated as header
                "rows": [{"Name": "...", "Birth": "..."}, ...],
                "row_count": N,
            }
        ]
    }
    """
    suffix = Path(file_path).suffix.lower()

    if suffix in {".csv", ".tsv"}:
        return _parse_csv(file_path, delimiter="," if suffix == ".csv" else "\t")
    if suffix in {".xlsx", ".xls"}:
        return _parse_xlsx(file_path)
    raise ValueError(f"Unsupported spreadsheet extension: {suffix}")


def _parse_csv(file_path: str, delimiter: str) -> dict:
    # Sniff encoding: try utf-8 then fall back to cp1252.
    raw = Path(file_path).read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8", errors="replace")

    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows = list(reader)
    if not rows:
        return {"sheets": [{"name": "Sheet1", "columns": [], "rows": [], "row_count": 0}]}

    columns = [(c or f"col_{i+1}").strip() for i, c in enumerate(rows[0])]
    data_rows = []
    for r in rows[1:]:
        rec = {}
        for i, c in enumerate(columns):
            rec[c] = r[i] if i < len(r) else None
        data_rows.append(rec)

    return {
        "sheets": [
            {
                "name": "Sheet1",
                "columns": columns,
                "rows": data_rows,
                "row_count": len(data_rows),
            }
        ]
    }


def _parse_xlsx(file_path: str) -> dict:
    wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
    sheets = []
    for ws in wb.worksheets:
        rows_iter = ws.iter_rows(values_only=True)
        try:
            header = next(rows_iter)
        except StopIteration:
            sheets.append({"name": ws.title, "columns": [], "rows": [], "row_count": 0})
            continue
        columns = [
            (str(c).strip() if c is not None else f"col_{i+1}")
            for i, c in enumerate(header)
        ]
        data_rows = []
        for r in rows_iter:
            # Skip rows that are entirely empty
            if all(v is None or (isinstance(v, str) and not v.strip()) for v in r):
                continue
            rec = {}
            for i, c in enumerate(columns):
                rec[c] = _stringify(r[i]) if i < len(r) else None
            data_rows.append(rec)
        sheets.append({
            "name": ws.title,
            "columns": columns,
            "rows": data_rows,
            "row_count": len(data_rows),
        })
    wb.close()
    return {"sheets": sheets}
