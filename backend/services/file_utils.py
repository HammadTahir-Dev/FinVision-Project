"""
services/file_utils.py — Shared, tolerant file readers.

CSV files exported from Excel on Windows are often not UTF-8 (e.g. "Café"
saved as cp1252). pandas' default read_csv crashes on those, which made the
upload stay "failed" and broke chat/forecast for the file.
"""
import pandas as pd

_ENCODINGS = ("utf-8", "utf-8-sig", "cp1252", "latin-1")


def read_csv_any(path: str, **kwargs) -> pd.DataFrame:
    last_err = None
    for enc in _ENCODINGS:
        try:
            return pd.read_csv(path, encoding=enc, **kwargs)
        except UnicodeDecodeError as e:
            last_err = e
    raise last_err  # pragma: no cover  (latin-1 accepts any byte sequence)
