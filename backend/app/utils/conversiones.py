"""Conversiones de botellas a tragos/copa."""
from __future__ import annotations

import re
from typing import Optional


_RE_1L = re.compile(r"\b1(\.0)?\s?(l|lt)\b|\b1000\s?ml\b", re.IGNORECASE)
_RE_075L = re.compile(r"\b0[.,]75\s?l\b|\b750\s?ml\b", re.IGNORECASE)
_RE_070L = re.compile(r"\b0[.,]70\s?l\b|\b700\s?ml\b", re.IGNORECASE)


def _detectar_tamano(producto: str) -> Optional[str]:
    if _RE_1L.search(producto):
        return "1l"
    if _RE_075L.search(producto):
        return "0.75l"
    if _RE_070L.search(producto):
        return "0.70l"
    return None


def calcular_tragos(producto: str, botellas: float) -> float:
    """
    Calcula el total de tragos/copa segun el nombre del producto y la cantidad de botellas.
    """
    if producto is None:
        raise ValueError("producto es requerido")
    if botellas is None:
        raise ValueError("botellas es requerido")

    nombre = str(producto).strip().lower()

    # Casos especiales por producto
    if "vino" in nombre:
        return botellas * 6
    if "prosecco" in nombre:
        return botellas * 10
    if "baileys" in nombre:
        tamano = _detectar_tamano(nombre)
        if tamano == "0.75l":
            return botellas * 9
        if tamano == "1l":
            return botellas * 11
        # Si no se detecta tamanio, usar regla general al final

    tamano = _detectar_tamano(nombre)
    if tamano == "1l":
        return botellas * 18
    if tamano == "0.75l":
        return botellas * 14
    if tamano == "0.70l":
        return botellas * 12

    raise ValueError(f"No se pudo detectar el tamano de botella en: {producto}")
