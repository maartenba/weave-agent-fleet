@echo off
setlocal enabledelayedexpansion

rem weave-fleet — launcher script for Weave Agent Fleet (Windows)
rem Installed to %LOCALAPPDATA%\weave\fleet\bin\weave-fleet.cmd

set "SCRIPT_DIR=%~dp0"
rem Remove trailing backslash
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

rem Resolve install directory (parent of bin/)
for %%I in ("%SCRIPT_DIR%\..") do set "INSTALL_DIR=%%~fI"

set "NODE_BIN=%INSTALL_DIR%\bin\node.exe"
set "SERVER_JS=%INSTALL_DIR%\app\server.js"
set "VERSION_FILE=%INSTALL_DIR%\VERSION"

rem Ensure bundled Node.js binary exists
if not exist "%NODE_BIN%" (
    echo Error: bundled Node.js binary not found at %NODE_BIN% >&2
    echo Your installation may be corrupt. Re-install with: >&2
    echo   irm https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.ps1 ^| iex >&2
    exit /b 1
)

rem Ensure server.js exists
if not exist "%SERVER_JS%" (
    echo Error: server.js not found at %SERVER_JS% >&2
    echo Your installation may be corrupt. Re-install with: >&2
    echo   irm https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.ps1 ^| iex >&2
    exit /b 1
)

rem Parse subcommands
if "%~1"=="" goto :start_server
if /i "%~1"=="version" goto :show_version
if /i "%~1"=="--version" goto :show_version
if /i "%~1"=="-v" goto :show_version
if /i "%~1"=="update" goto :do_update
if /i "%~1"=="uninstall" goto :do_uninstall
if /i "%~1"=="help" goto :show_help
if /i "%~1"=="--help" goto :show_help
if /i "%~1"=="-h" goto :show_help

echo Unknown command: %~1
echo Run "weave-fleet help" for usage.
exit /b 1

:show_version
if exist "%VERSION_FILE%" (
    type "%VERSION_FILE%"
) else (
    echo unknown
)
exit /b 0

:do_update
echo Updating Weave Fleet...
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.ps1 | iex"
exit /b %ERRORLEVEL%

:do_uninstall
echo Removing Weave Fleet from %INSTALL_DIR%...
rd /s /q "%INSTALL_DIR%" 2>nul
echo Done.
echo.
echo You may need to remove the PATH entry manually:
echo   1. Open Settings ^> System ^> About ^> Advanced system settings
echo   2. Click "Environment Variables"
echo   3. Under "User variables", edit "Path"
echo   4. Remove the entry: %INSTALL_DIR%\bin
exit /b 0

:show_help
set "VERSION=unknown"
if exist "%VERSION_FILE%" (
    set /p VERSION=<"%VERSION_FILE%"
)
echo Weave Fleet v!VERSION!
echo.
echo Usage: weave-fleet [command]
echo.
echo Commands:
echo   (none)       Start the Weave Fleet server
echo   version      Print the installed version
echo   update       Update to the latest version
echo   uninstall    Remove Weave Fleet
echo   help         Show this help message
echo.
echo Environment variables:
echo   PORT             Server port (default: 3000)
echo   HOSTNAME         Server hostname (default: 0.0.0.0)
echo   WEAVE_DB_PATH    Database file path (default: %%USERPROFILE%%\.weave\fleet.db)
echo   OPENCODE_BIN     Full path to opencode binary (if not on PATH)
exit /b 0

:start_server

rem Check that opencode CLI is available
rem OPENCODE_BIN allows specifying the full path to the opencode binary,
rem useful on Windows where 'where' may not find winget-installed binaries.
if defined OPENCODE_BIN (
    if exist "%OPENCODE_BIN%" goto :opencode_found
    echo Warning: OPENCODE_BIN set to "%OPENCODE_BIN%" but file does not exist. >&2
    echo Falling back to PATH lookup... >&2
)
where opencode >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: 'opencode' CLI not found on PATH. >&2
    echo. >&2
    echo Weave Fleet requires OpenCode to manage AI agent sessions. >&2
    echo Install it from: https://opencode.ai >&2
    echo. >&2
    echo If opencode is installed but not found, set OPENCODE_BIN to the full path: >&2
    echo   set OPENCODE_BIN=C:\path\to\opencode.exe >&2
    exit /b 1
)
:opencode_found

rem Set environment for production
set "NODE_ENV=production"
if not defined PORT set "PORT=3000"
if not defined HOSTNAME set "HOSTNAME=0.0.0.0"

rem Ensure data directory exists
if not exist "%USERPROFILE%\.weave" mkdir "%USERPROFILE%\.weave"

set "VERSION=unknown"
if exist "%VERSION_FILE%" (
    set /p VERSION=<"%VERSION_FILE%"
)

echo Weave Fleet v!VERSION! starting on http://localhost:!PORT!

rem Start the server
rem On Windows, Ctrl+C is handled natively by the console — Node.js receives SIGINT directly
"%NODE_BIN%" "%SERVER_JS%"
