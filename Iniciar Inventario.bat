@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python no esta instalado o no esta en el PATH.
  echo Instala Python 3.10+ y vuelve a intentar.
  pause
  exit /b 1
)

set "PYTHON=python"
if exist ".venv\Scripts\python.exe" set "PYTHON=.venv\Scripts\python.exe"
if exist "venv\Scripts\python.exe" set "PYTHON=venv\Scripts\python.exe"

if not exist ".venv\Scripts\python.exe" (
  echo Creando entorno virtual...
  python -m venv .venv
  set "PYTHON=.venv\Scripts\python.exe"
)

echo Instalando dependencias...
%PYTHON% -m pip install --upgrade pip >nul
%PYTHON% -m pip install -r backend\requirements.txt

start "" "http://127.0.0.1:8000/ui"
set "PYTHONPATH=%CD%\\backend"
start "Servidor Inventario" cmd /k "%PYTHON% -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"
