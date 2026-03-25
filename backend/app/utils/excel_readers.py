"""Excel readers for SAINT, CAJA, and BARRA reports.

Assumptions:
- Files exist under the project root at data/saint.xlsx, data/caja.xlsx, data/barra.xlsx.
- Column normalization is generic: lowercase, strip spaces, replace whitespace and hyphens with underscores.
"""
from __future__ import annotations

from io import BytesIO
import zipfile
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


_WORKBOOK_XML = "xl/workbook.xml"
_WORKBOOK_XML_REPLACEMENTS = {
    b"WindowWidth": b"windowWidth",
    b"WindowHeight": b"windowHeight",
    b"WindowX": b"windowX",
    b"WindowY": b"windowY",
}
_WORKSHEET_XML_REPLACEMENTS = {
    b"firstPageNo": b"firstPageNumber",
}


def _sanitize_xlsx_bytes(content: bytes) -> bytes:
    """
    Repair common Excel XML attribute casing issues that can crash openpyxl.
    This is a non-destructive, in-memory fix.
    """
    try:
        zin = zipfile.ZipFile(BytesIO(content), "r")
    except zipfile.BadZipFile:
        return content

    if _WORKBOOK_XML not in zin.namelist():
        return content

    workbook_xml = zin.read(_WORKBOOK_XML)
    fixed_workbook_xml = workbook_xml
    for bad, good in _WORKBOOK_XML_REPLACEMENTS.items():
        fixed_workbook_xml = fixed_workbook_xml.replace(bad, good)

    out = BytesIO()
    with zipfile.ZipFile(out, "w") as zout:
        for item in zin.infolist():
            if item.filename == _WORKBOOK_XML:
                zout.writestr(item, fixed_workbook_xml)
                continue
            if item.filename.startswith("xl/worksheets/") and item.filename.endswith(".xml"):
                sheet_xml = zin.read(item.filename)
                fixed_sheet_xml = sheet_xml
                for bad, good in _WORKSHEET_XML_REPLACEMENTS.items():
                    fixed_sheet_xml = fixed_sheet_xml.replace(bad, good)
                zout.writestr(item, fixed_sheet_xml)
                continue
            else:
                zout.writestr(item, zin.read(item.filename))
    return out.getvalue()


def _read_excel_bytes(content: bytes, *, header: int | None = 0) -> pd.DataFrame:
    safe_content = _sanitize_xlsx_bytes(content)
    df = pd.read_excel(BytesIO(safe_content), header=header)
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
