"""Excel readers for SAINT, CAJA, and BARRA reports.

Assumptions:
- Files exist under the project root at data/saint.xlsx, data/caja.xlsx, data/barra.xlsx.
- Column normalization is generic: lowercase, strip spaces, replace whitespace and hyphens with underscores.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Iterable

import pandas as pd


DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def _normalize_columns(columns: Iterable[str]) -> list[str]:
    normalized = []
    for col in columns:
        if col is None:
            normalized.append("")
            continue
        text = str(col).strip().lower()
        text = "_".join(text.replace("-", " ").split())
        normalized.append(text)
    return normalized


def _read_excel(file_path: Path) -> pd.DataFrame:
    df = pd.read_excel(file_path)
    df = df.dropna(how="all")
    df.columns = _normalize_columns(df.columns)
    return df


def _read_excel_bytes(content: bytes, *, header: int | None = 0) -> pd.DataFrame:
    df = pd.read_excel(BytesIO(content), header=header)
    df = df.dropna(how="all")
    return df


def _to_number(value) -> float:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if text == "":
        return 0.0
    # Handle 1.234,56 vs 1,234.56
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return 0.0


def _fix_saint_split_rows(df: pd.DataFrame) -> pd.DataFrame:
    """
    Fix SAINT rows where product code is on one row and name on the next row.
    Assumes the first two columns are code and name.
    """
    if df.shape[1] < 2 or df.empty:
        return df

    code_col = df.columns[0]
    name_col = df.columns[1]

    code_series = df[code_col].astype("string")
    name_series = df[name_col].astype("string")

    code_only = code_series.notna() & name_series.isna()
    name_only = code_series.isna() & name_series.notna()

    # Match code-only row with next row that has only name
    next_is_name_only = name_only.shift(-1, fill_value=False)
    to_fix = code_only & next_is_name_only

    if to_fix.any():
        df.loc[to_fix, name_col] = name_series.shift(-1)
        df = df.loc[~name_only.shift(1, fill_value=False)].copy()

    return df


def read_saint_upload(content: bytes) -> pd.DataFrame:
    df = _read_excel_bytes(content, header=None)
    df = _fix_saint_split_rows(df)
    if df.shape[1] < 7:
        return pd.DataFrame(columns=["producto", "cantidad"])
    result = df[[1, 6]].copy()
    result.columns = ["producto", "cantidad"]
    result = result.dropna(subset=["producto"])
    result["cantidad"] = result["cantidad"].map(_to_number)
    return result


def read_caja_upload(content: bytes) -> pd.DataFrame:
    df = _read_excel_bytes(content, header=None)
    if df.shape[0] <= 7 or df.shape[1] <= 10:
        return pd.DataFrame(columns=["producto", "cantidad"])
    data = df.iloc[7:].copy()
    result = data[[0, 10]].copy()
    result.columns = ["producto", "cantidad"]
    result = result.dropna(subset=["producto"])
    result["cantidad"] = result["cantidad"].map(_to_number)
    return result


def read_barra_upload(content: bytes) -> pd.DataFrame:
    df = _read_excel_bytes(content, header=None)
    if df.shape[0] <= 7 or df.shape[1] <= 9:
        return pd.DataFrame(columns=["producto", "cantidad"])
    data = df.iloc[7:].copy()
    # En este formato, la columna J ya es cantidad de tragos.
    result = data[[0, 9]].copy()
    result.columns = ["producto", "cantidad"]
    result = result.dropna(subset=["producto"])
    result["cantidad"] = result["cantidad"].map(_to_number)
    return result


def leer_saint() -> pd.DataFrame:
    """Leer y limpiar el reporte SAINT."""
    df = _read_excel(DATA_DIR / "saint.xlsx")
    df = _fix_saint_split_rows(df)
    return df


def leer_caja() -> pd.DataFrame:
    """Leer y limpiar el reporte CAJA LICORES."""
    return _read_excel(DATA_DIR / "caja.xlsx")


def leer_barra() -> pd.DataFrame:
    """Leer y limpiar el reporte BARRA."""
    return _read_excel(DATA_DIR / "barra.xlsx")


if __name__ == "__main__":
    # Quick manual check
    print(leer_saint().head())
    print(leer_caja().head())
    print(leer_barra().head())
