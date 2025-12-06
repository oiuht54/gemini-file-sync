@echo off
title AI Studio Local Bridge Server
color 0B

:: ------------------------------------------------
:: 1. Переходим в директорию, где лежит этот файл
:: ------------------------------------------------
cd /d "%~dp0"

:: ------------------------------------------------
:: 2. Проверяем структуру папок
:: ------------------------------------------------
if not exist "server\src\index.js" (
    color 0C
    echo.
    echo [ERROR] Critical file 'server\src\index.js' not found.
    echo Please make sure this .bat file is in the PROJECT ROOT.
    echo.
    pause
    exit /b
)

:: Переходим в папку сервера
cd server

:: ------------------------------------------------
:: 3. Проверяем наличие Node.js
:: ------------------------------------------------
node -v >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b
)

:: ------------------------------------------------
:: 4. Проверяем и устанавливаем зависимости
:: ------------------------------------------------
if not exist "node_modules\" (
    echo [SETUP] First run detected. Installing dependencies...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo [ERROR] npm install failed. Check internet connection.
        pause
        exit /b
    )
    cls
)

:: ------------------------------------------------
:: 5. Запуск Сервера
:: ------------------------------------------------
cls
echo ========================================================
echo    AI STUDIO LOCAL BRIDGE 
echo    (Do not close this window while working)
echo ========================================================
echo.

node src/index.js

:: ------------------------------------------------
:: 6. Обработка падения
:: ------------------------------------------------
color 0C
echo.
echo ========================================================
echo [CRASH] Server stopped unexpectedly.
echo Read the error message above.
echo ========================================================
pause