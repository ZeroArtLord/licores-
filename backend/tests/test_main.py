from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

import main


client = TestClient(main.app)


def test_inventario_requires_files_or_token():
    response = client.post("/inventario")
    assert response.status_code == 400
    assert response.json()["detail"] == "Archivos o token requerido"


def test_guardar_conversiones_sanitiza_valores():
    payload = {
        "categorias": {"RON": 14, "BAD": 0, "TEXT": "abc"},
        "productos": {"VODKA X": 12, "BAD2": -1},
    }
    save_response = client.post("/conversiones/guardar", json=payload)
    assert save_response.status_code == 200

    get_response = client.get("/conversiones")
    body = get_response.json()
    assert body["categorias"] == {"RON": 14.0}
    assert body["productos"] == {"VODKA X": 12.0}


def test_cleanup_cache_dir_removes_old_dirs(tmp_path, monkeypatch):
    old_dir = tmp_path / "old_token"
    new_dir = tmp_path / "new_token"
    old_dir.mkdir()
    new_dir.mkdir()

    old_file = old_dir / "saint.xlsx"
    new_file = new_dir / "saint.xlsx"
    old_file.write_bytes(b"x")
    new_file.write_bytes(b"x")

    old_timestamp = (datetime.now(timezone.utc) - timedelta(hours=48)).timestamp()
    new_timestamp = datetime.now(timezone.utc).timestamp()

    old_file.touch()
    new_file.touch()
    old_dir.touch()
    new_dir.touch()

    import os

    os.utime(old_dir, (old_timestamp, old_timestamp))
    os.utime(new_dir, (new_timestamp, new_timestamp))

    monkeypatch.setattr(main, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(main, "CACHE_TTL_HOURS", 24)

    main._cleanup_cache_dir()

    assert not old_dir.exists()
    assert new_dir.exists()
