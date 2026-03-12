"""Normalizacion automatica con fuzzy matching."""
from __future__ import annotations

import re
from typing import Iterable

import pandas as pd
from rapidfuzz import fuzz


_RE_TAMANOS = re.compile(
    r"\b(\d+[.,]\d+)\b|\b(\d+)\s?(ml|cc|lt|l)\b", re.IGNORECASE
)
_RE_PALABRAS = re.compile(r"\b(BOT|G|E|ML|CC)\b", re.IGNORECASE)
_RE_PUNCT = re.compile(r"[().,]")
_RE_SPACES = re.compile(r"\s+")


def _limpiar(texto: str) -> str:
    if texto is None:
        return ""
    t = str(texto).upper()
    t = _RE_PUNCT.sub(" ", t)
    t = _RE_TAMANOS.sub(" ", t)
    t = _RE_PALABRAS.sub(" ", t)
    t = _RE_SPACES.sub(" ", t).strip()
    return t


def normalizar_productos(lista_productos: Iterable[str]) -> pd.DataFrame:
    """
    Devuelve un DataFrame con columnas:
    - producto_original
    - producto_normalizado
    """
    originales = [str(x) for x in lista_productos if x is not None]
    if not originales:
        return pd.DataFrame(columns=["producto_original", "producto_normalizado"])

    df = pd.DataFrame({"producto_original": originales})
    df["base"] = df["producto_original"].map(_limpiar)

    # Agrupacion greedy por similitud >= 90
    grupos: dict[int, str] = {}
    normalizados: list[str] = []
    for _, row in df.iterrows():
        base = row["base"]
        elegido = None
        for gid, representante in grupos.items():
            if fuzz.token_sort_ratio(base, representante) >= 90:
                elegido = representante
                break
        if elegido is None:
            grupos[len(grupos)] = base
            elegido = base
        normalizados.append(elegido)

    df["producto_normalizado"] = normalizados
    return df[["producto_original", "producto_normalizado"]]
