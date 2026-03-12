"""Normalizacion de nombres de productos usando equivalencias."""
from __future__ import annotations

import re

# Claves y valores en MAYUSCULAS.
EQUIVALENCIAS = {
    "VODKA GORDON": "VODKA GORDONS",
    "VODKA GORDONS": "VODKA GORDONS",
    "GORDONS VODKA": "VODKA GORDONS",
}

_RE_PUNCT = re.compile(r"[().]")
_RE_ESPACIOS = re.compile(r"\s+")
_RE_DECIMAL_SPACE = re.compile(r"\b(\d)\s+(\d{2})\b")


def normalizar_producto(nombre: str) -> str:
    if nombre is None:
        return ""
    texto = str(nombre).strip().upper()
    texto = _RE_PUNCT.sub(" ", texto)
    texto = texto.replace(",", ".")
    # Convert "0 75" -> "0.75"
    texto = _RE_DECIMAL_SPACE.sub(r"\1.\2", texto)
    texto = texto.replace(" LITRO", " LT")
    texto = texto.replace(" LITROS", " LT")
    texto = texto.replace(" LTS", " LT")
    texto = texto.replace(" LTR", " LT")
    texto = texto.replace("0.75L", "0.75")
    texto = texto.replace("0.70L", "0.70")
    texto = texto.replace("1L", "1")
    texto = texto.replace(" 0.70 LT", " 0.70")
    texto = texto.replace(" 0.75 LT", " 0.75")
    texto = texto.replace(" 1.00 LT", " 1")
    texto = texto.replace(" LT", "")
    texto = _RE_ESPACIOS.sub(" ", texto).strip()
    return EQUIVALENCIAS.get(texto, texto)
