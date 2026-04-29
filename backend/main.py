from __future__ import annotations

import os
from pathlib import Path
import json
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import Body, FastAPI, File, UploadFile, Query, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.utils.excel_readers import (
    read_barra_upload,
    read_caja_upload,
    read_saint_upload,
)

from app.utils.auto_normalizacion import normalizar_productos
from app.utils.normalizacion import normalizar_producto
from rapidfuzz import fuzz, process
from uuid import uuid4


app = FastAPI(title="Inventario Licores")

_cors_origins_env = os.getenv("CORS_ORIGINS", "").strip()
if _cors_origins_env:
    CORS_ORIGINS = [origin.strip() for origin in _cors_origins_env.split(",") if origin.strip()]
else:
    CORS_ORIGINS = ["http://localhost", "http://localhost:5500", "http://127.0.0.1:5500"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=os.getenv("CORS_ALLOW_CREDENTIALS", "1") == "1",
    allow_methods=["*"],
    allow_headers=["*"],
)


def _normalize_producto(value: str) -> str:
    return normalizar_producto(value)


def _clean_qty(value) -> float:
    if value is None:
        return 0.0
    text = str(value).strip()
    if text == "":
        return 0.0
    # Replace OCR O/o with 0 in numeric context
    text = text.replace("O", "0").replace("o", "0")
    text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return 0.0


DATA_INPUT_DIR = Path("data/input")
DATA_INPUT_DIR.mkdir(parents=True, exist_ok=True)
EQUIV_PATH = DATA_INPUT_DIR / "equivalencias.csv"
IGNORE_PATH = DATA_INPUT_DIR / "ignorar.csv"
CATEGORIAS_PATH = DATA_INPUT_DIR / "categorias.json"
REGISTRADOS_PATH = DATA_INPUT_DIR / "registrados.json"
HISTORIAL_PATH = DATA_INPUT_DIR / "historial_nuevos.json"
CONVERSIONES_PATH = DATA_INPUT_DIR / "conversiones.json"
CACHE_DIR = Path("data/cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_TTL_HOURS = int(os.getenv("CACHE_TTL_HOURS", "24"))


def _cleanup_cache_dir() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(CACHE_TTL_HOURS, 1))
    for entry in CACHE_DIR.iterdir():
        if not entry.is_dir():
            continue
        try:
            modified = datetime.fromtimestamp(entry.stat().st_mtime, tz=timezone.utc)
        except OSError:
            continue
        if modified >= cutoff:
            continue
        for item in entry.glob("*"):
            try:
                if item.is_file():
                    item.unlink(missing_ok=True)
            except OSError:
                pass
        try:
            entry.rmdir()
        except OSError:
            pass


def _cargar_equivalencias() -> dict[str, str]:
    if not EQUIV_PATH.exists():
        return {}
    df = pd.read_csv(EQUIV_PATH)
    if not {"producto_original", "producto_normalizado"}.issubset(df.columns):
        return {}
    return dict(
        zip(
            df["producto_original"].astype("string"),
            df["producto_normalizado"].astype("string"),
        )
    )


def _guardar_equivalencias(nuevas: dict[str, str]) -> None:
    if not nuevas:
        return
    existentes = _cargar_equivalencias()
    existentes.update(nuevas)
    out = pd.DataFrame(
        {
            "producto_original": list(existentes.keys()),
            "producto_normalizado": list(existentes.values()),
        }
    )
    out.to_csv(EQUIV_PATH, index=False, encoding="utf-8")


def _cargar_ignorar() -> set[str]:
    if not IGNORE_PATH.exists():
        return set()
    df = pd.read_csv(IGNORE_PATH)
    if "producto" not in df.columns:
        return set()
    return set(df["producto"].astype("string").dropna())


def _guardar_ignorar(nuevos: set[str]) -> None:
    if not nuevos:
        return
    existentes = _cargar_ignorar()
    existentes.update(nuevos)
    out = pd.DataFrame({"producto": sorted(existentes)})
    out.to_csv(IGNORE_PATH, index=False, encoding="utf-8")


def _cargar_catalogo() -> list[str]:
    ref_path = Path("data/Tabla de Inventario de Productos.xlsx")
    if not ref_path.exists():
        return []
    df = pd.read_excel(ref_path)
    col = None
    for c in df.columns:
        if str(c).strip().lower() in ["productos", "producto", "descripcion", "nombre"]:
            col = c
            break
    if col is None:
        col = df.columns[0]
    nombres = df[col].dropna().astype(str).map(lambda x: x.strip()).tolist()
    return [normalizar_producto(x) for x in nombres]


def _en_catalogo(nombre: str, catalogo: list[str], catalogo_set: set[str]) -> bool:
    if not nombre:
        return False
    n = normalizar_producto(nombre)
    if n in catalogo_set:
        return True
    if not catalogo:
        return False
    match = process.extractOne(n, catalogo, scorer=fuzz.token_sort_ratio, score_cutoff=90)
    return match is not None


def _quitar_ignorar(remover: set[str]) -> None:
    if not IGNORE_PATH.exists() or not remover:
        return
    df = pd.read_csv(IGNORE_PATH)
    if "producto" not in df.columns:
        return
    df = df[~df["producto"].astype("string").isin(remover)]
    df.to_csv(IGNORE_PATH, index=False, encoding="utf-8")


def _cargar_categorias() -> dict[str, list[str]]:
    if not CATEGORIAS_PATH.exists():
        return {}
    try:
        data = json.loads(CATEGORIAS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    cleaned: dict[str, list[str]] = {}
    for k, v in data.items():
        if not k or not isinstance(v, list):
            continue
        cleaned[str(k)] = [str(x) for x in v if x]
    return cleaned


def _guardar_categorias(data: dict[str, list[str]]) -> None:
    if CATEGORIAS_PATH.exists():
        backup = CATEGORIAS_PATH.with_name(
            f"backup_categorias_{pd.Timestamp.now():%Y%m%d_%H%M%S}.json"
        )
        backup.write_text(CATEGORIAS_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    # Deduplicate and normalize
    cleaned: dict[str, list[str]] = {}
    for cat, items in data.items():
        if not cat:
            continue
        seen = set()
        dedup = []
        for item in items or []:
            key = str(item).strip()
            if not key:
                continue
            if key in seen:
                continue
            dedup.append(key)
            seen.add(key)
        cleaned[str(cat)] = dedup
    CATEGORIAS_PATH.write_text(
        json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _cargar_registrados(seed: set[str]) -> set[str]:
    if not REGISTRADOS_PATH.exists():
        registrados = {normalizar_producto(x) for x in seed if x}
        REGISTRADOS_PATH.write_text(
            json.dumps(sorted(registrados), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return registrados
    try:
        data = json.loads(REGISTRADOS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = []
    if not isinstance(data, list):
        data = []
    registrados = {normalizar_producto(x) for x in data if x}
    if not registrados and seed:
        registrados = {normalizar_producto(x) for x in seed if x}
        REGISTRADOS_PATH.write_text(
            json.dumps(sorted(registrados), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    return registrados


def _guardar_registrados(registrados: set[str]) -> None:
    REGISTRADOS_PATH.write_text(
        json.dumps(sorted(registrados), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _cargar_historial() -> dict[str, dict]:
    if not HISTORIAL_PATH.exists():
        return {}
    try:
        data = json.loads(HISTORIAL_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def _guardar_historial(data: dict[str, dict]) -> None:
    HISTORIAL_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _cargar_conversiones() -> dict:
    if not CONVERSIONES_PATH.exists():
        return {"categorias": {}, "productos": {}}
    try:
        data = json.loads(CONVERSIONES_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"categorias": {}, "productos": {}}
    if not isinstance(data, dict):
        return {"categorias": {}, "productos": {}}
    data.setdefault("categorias", {})
    data.setdefault("productos", {})
    return data


def _guardar_conversiones(data: dict) -> None:
    if CONVERSIONES_PATH.exists():
        backup = CONVERSIONES_PATH.with_name(
            f"backup_conversiones_{pd.Timestamp.now():%Y%m%d_%H%M%S}.json"
        )
        backup.write_text(
            CONVERSIONES_PATH.read_text(encoding="utf-8"), encoding="utf-8"
        )
    # Sanitizar
    cleaned = {"categorias": {}, "productos": {}}
    for k, v in (data.get("categorias") or {}).items():
        try:
            num = float(v)
        except (TypeError, ValueError):
            continue
        if num <= 0:
            continue
        cleaned["categorias"][str(k)] = num
    for k, v in (data.get("productos") or {}).items():
        try:
            num = float(v)
        except (TypeError, ValueError):
            continue
        if num <= 0:
            continue
        cleaned["productos"][str(k)] = num
    CONVERSIONES_PATH.write_text(
        json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8"
    )


@app.post("/normalizacion/guardar")
async def guardar_normalizacion(payload: dict = Body(...)):
    equivalencias = payload.get("equivalencias", [])
    ignorar = payload.get("ignorar", [])

    eq_map = {}
    for item in equivalencias:
        original = item.get("producto_original")
        normalizado = item.get("producto_normalizado")
        if original and normalizado:
            eq_map[str(original)] = str(normalizado)

    ign_set = {str(x) for x in ignorar if x}

    _guardar_equivalencias(eq_map)
    _guardar_ignorar(ign_set)
    return {"ok": True, "equivalencias": len(eq_map), "ignorar": len(ign_set)}


@app.post("/normalizacion/designorar")
async def designorar(payload: dict = Body(...)):
    items = payload.get("productos", [])
    remover = {str(x) for x in items if x}
    _quitar_ignorar(remover)
    return {"ok": True, "removidos": len(remover)}


@app.get("/catalogo")
async def catalogo():
    ref_path = Path("data/Tabla de Inventario de Productos.xlsx")
    if not ref_path.exists():
        raise HTTPException(status_code=404, detail="Catalogo no encontrado")
    df = pd.read_excel(ref_path)
    col = None
    for c in df.columns:
        if str(c).strip().lower() in ["productos", "producto", "descripcion", "nombre"]:
            col = c
            break
    if col is None:
        col = df.columns[0]
    nombres = (
        df[col].dropna().astype(str).map(lambda x: x.strip()).tolist()
    )
    norm = sorted({normalizar_producto(x) for x in nombres})
    return {"total": len(nombres), "unique": len(norm), "items": norm}


@app.get("/categorias")
async def obtener_categorias():
    return {"categorias": _cargar_categorias()}


@app.post("/categorias/guardar")
async def guardar_categorias(payload: dict = Body(...)):
    categorias = payload.get("categorias", {})
    if not isinstance(categorias, dict):
        raise HTTPException(status_code=400, detail="Formato de categorias invalido")
    cleaned: dict[str, list[str]] = {}
    for cat, items in categorias.items():
        if not cat:
            continue
        if not isinstance(items, list):
            continue
        cleaned[str(cat)] = [str(x) for x in items if x]
    _guardar_categorias(cleaned)
    return {"ok": True, "total": len(cleaned)}


@app.get("/conversiones")
async def obtener_conversiones():
    return _cargar_conversiones()


@app.post("/conversiones/guardar")
async def guardar_conversiones(payload: dict = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Formato invalido")
    _guardar_conversiones(payload)
    return {"ok": True}


@app.post("/inventario")
@app.post("/api/inventario")
async def calcular_inventario(
    saint: UploadFile | None = File(None),
    caja: UploadFile | None = File(None),
    barra: UploadFile | None = File(None),
    detalle: bool = Query(False),
    token: str | None = Form(None),
):
    _cleanup_cache_dir()

    saint_bytes = None
    caja_bytes = None
    barra_bytes = None

    if saint is not None and caja is not None and barra is not None:
        saint_bytes = await saint.read()
        caja_bytes = await caja.read()
        barra_bytes = await barra.read()
        token = token or uuid4().hex
        cache_path = CACHE_DIR / token
        cache_path.mkdir(parents=True, exist_ok=True)
        (cache_path / "saint.xlsx").write_bytes(saint_bytes)
        (cache_path / "caja.xlsx").write_bytes(caja_bytes)
        (cache_path / "barra.xlsx").write_bytes(barra_bytes)
    elif token:
        cache_path = CACHE_DIR / token
        try:
            saint_bytes = (cache_path / "saint.xlsx").read_bytes()
            caja_bytes = (cache_path / "caja.xlsx").read_bytes()
            barra_bytes = (cache_path / "barra.xlsx").read_bytes()
        except FileNotFoundError:
            raise HTTPException(status_code=400, detail="Cache no encontrado")
    else:
        raise HTTPException(status_code=400, detail="Archivos o token requerido")

    saint_std = read_saint_upload(saint_bytes)
    caja_std = read_caja_upload(caja_bytes)
    barra_std = read_barra_upload(barra_bytes)

    for df in (saint_std, caja_std, barra_std):
        df["producto"] = df["producto"].astype("string").map(_normalize_producto)
        df["cantidad"] = df["cantidad"].map(_clean_qty)

    # Copias para vista original (antes de aplicar equivalencias/ignorar)
    saint_orig = saint_std.copy()
    caja_orig = caja_std.copy()
    barra_orig = barra_std.copy()

    # Normalizacion automatica con fuzzy matching sobre el conjunto completo
    productos = pd.concat(
        [
            saint_std["producto"],
            caja_std["producto"],
            barra_std["producto"],
        ],
        ignore_index=True,
    ).dropna()
    mapping_df = normalizar_productos(productos.unique())

    manual_map = _cargar_equivalencias()
    # Guardar el mapa solo si se solicita (evita recargas del Live Server)
    if os.getenv("SAVE_MAPA_NORMALIZACION") == "1":
        mapping_df.to_csv(
            "data/output/mapa_normalizacion.csv", index=False, encoding="utf-8"
        )
    mapping = dict(
        zip(mapping_df["producto_original"], mapping_df["producto_normalizado"])
    )
    # Prioridad a equivalencias manuales
    mapping.update(manual_map)

    for df in (saint_std, caja_std, barra_std):
        df["producto"] = df["producto"].map(lambda x: mapping.get(x, x))

    ignorar = _cargar_ignorar()
    if ignorar:
        for df in (saint_std, caja_std, barra_std):
            df.drop(df[df["producto"].isin(ignorar)].index, inplace=True)

    dep = (
        saint_std.groupby("producto", as_index=False)["cantidad"]
        .sum()
        .rename(columns={"cantidad": "deposito"})
    )
    caja_df = (
        caja_std.groupby("producto", as_index=False)["cantidad"]
        .sum()
        .rename(columns={"cantidad": "caja"})
    )
    barra_df = (
        barra_std.groupby("producto", as_index=False)["cantidad"]
        .sum()
        .rename(columns={"cantidad": "barra"})
    )

    merged = dep.merge(caja_df, on="producto", how="outer").merge(
        barra_df, on="producto", how="outer"
    )
    merged = merged.fillna(0)

    # Redondeo para evitar decimales raros del Excel
    merged["deposito"] = merged["deposito"].round(3)
    merged["caja"] = merged["caja"].round(3)
    merged["barra"] = merged["barra"].round(3)
    merged["barra"] = merged["barra"].clip(lower=0)
    merged["deposito"] = merged["deposito"].clip(lower=0)
    merged["caja"] = merged["caja"].clip(lower=0)

    catalogo = _cargar_catalogo()
    catalogo_set = set(catalogo)
    registrados = _cargar_registrados(catalogo_set)

    if not detalle:
        vistos = {
            normalizar_producto(x)
            for x in merged["producto"].dropna().astype(str).tolist()
            if x
        }
        if vistos - registrados:
            registrados.update(vistos)
            _guardar_registrados(registrados)
        resultado = {
            row["producto"]: {
                "deposito": float(row["deposito"]),
                "caja": float(row["caja"]),
                "barra": float(row["barra"]),
            }
            for _, row in merged.iterrows()
        }
        return resultado

    # Vista original (sin aplicar equivalencias/ignorar)
    dep_o = (
        saint_orig.groupby("producto", as_index=False)["cantidad"]
        .sum()
        .rename(columns={"cantidad": "deposito"})
    )
    caja_o = (
        caja_orig.groupby("producto", as_index=False)["cantidad"]
        .sum()
        .rename(columns={"cantidad": "caja"})
    )
    barra_o = (
        barra_orig.groupby("producto", as_index=False)["cantidad"]
        .sum()
        .rename(columns={"cantidad": "barra"})
    )
    original_merged = dep_o.merge(caja_o, on="producto", how="outer").merge(
        barra_o, on="producto", how="outer"
    )
    original_merged = original_merged.fillna(0)
    original_merged["deposito"] = original_merged["deposito"].round(3)
    original_merged["caja"] = original_merged["caja"].round(3)
    original_merged["barra"] = original_merged["barra"].round(3)
    original_merged["barra"] = original_merged["barra"].clip(lower=0)
    original_merged["deposito"] = original_merged["deposito"].clip(lower=0)
    original_merged["caja"] = original_merged["caja"].clip(lower=0)

    # Mapa de grupos: normalizado -> [originales...]
    grupos: dict[str, list[str]] = {}
    for original, normal in mapping.items():
        grupos.setdefault(normal, []).append(original)
    grupos = {k: v for k, v in grupos.items() if len(v) > 1}

    registrados_before = set(registrados)

    original_list = []
    nuevos = []
    vistos = set()
    for _, row in original_merged.iterrows():
        prod = row["producto"]
        normal = mapping.get(prod, prod)
        norm_key = normalizar_producto(normal)
        norm_raw = normalizar_producto(prod)
        vistos.add(norm_raw)
        en_catalogo = _en_catalogo(normal, catalogo, catalogo_set)
        en_catalogo_raw = normalizar_producto(prod) in catalogo_set
        es_nuevo = (
            (norm_raw not in registrados_before)
            and (not en_catalogo_raw)
            and (prod not in ignorar)
        )
        original_list.append(
            {
                "producto": prod,
                "normalizado": normal,
                "deposito": float(row["deposito"]),
                "caja": float(row["caja"]),
                "barra": float(row["barra"]),
                "ignorado": prod in ignorar,
                "catalogo": en_catalogo,
                "nuevo": es_nuevo,
            }
        )
        if es_nuevo:
            nuevos.append({"producto": prod, "normalizado": normal})

    final_list = [
        {
            "producto": row["producto"],
            "deposito": float(row["deposito"]),
            "caja": float(row["caja"]),
            "barra": float(row["barra"]),
        }
        for _, row in merged.iterrows()
    ]

    # Deduplicate nuevos by normalizado
    seen = set()
    nuevos_dedup = []
    for item in nuevos:
        key = normalizar_producto(item["normalizado"])
        if key in seen:
            continue
        seen.add(key)
        nuevos_dedup.append(item)

    # Actualizar historial de nuevos detectados
    historial = _cargar_historial()
    now = pd.Timestamp.now().isoformat()
    for item in nuevos_dedup:
        key = normalizar_producto(item["normalizado"])
        entry = historial.get(key) or {}
        historial[key] = {
            "producto": item.get("producto", ""),
            "normalizado": item.get("normalizado", ""),
            "first_seen": entry.get("first_seen") or now,
            "last_seen": now,
            "count": int(entry.get("count", 0)) + 1,
        }
    if nuevos_dedup:
        _guardar_historial(historial)

    historial_list = list(historial.values())
    historial_list.sort(key=lambda x: x.get("last_seen", ""), reverse=True)

    # Registrar productos vistos para no repetir alertas en futuros calculos
    before_len = len(registrados)
    registrados.update(vistos)
    if len(registrados) != before_len:
        _guardar_registrados(registrados)

    return {
        "original": original_list,
        "final": final_list,
        "grupos": grupos,
        "token": token,
        "nuevos": nuevos_dedup,
        "historial_nuevos": historial_list,
    }


@app.get("/")
async def root():
    return RedirectResponse(url="/ui/")


# Servir el frontend desde el backend para evitar recargas del Live Server
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/ui", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
