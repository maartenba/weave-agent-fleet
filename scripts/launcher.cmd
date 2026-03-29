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
set "CLI_JS=%INSTALL_DIR%\app\cli.js"
set "VERSION_FILE=%INSTALL_DIR%\VERSION"

rem Ensure bundled Node.js binary exists
if not exist "%NODE_BIN%" (
    echo Error: bundled Node.js binary not found at %NODE_BIN% >&2
    echo Your installation may be corrupt. Re-install with: >&2
    echo   irm https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.ps1 ^| iex >&2
    exit /b 1
)

rem Parse subcommands and flags.
rem :parse_flags loops back here after consuming a flag pair (e.g. --port N).
:parse_flags
if "%~1"=="" goto :start_server
if /i "%~1"=="version" goto :show_version
if /i "%~1"=="--version" goto :show_version
if /i "%~1"=="-v" goto :show_version
if /i "%~1"=="update" goto :do_update
if /i "%~1"=="uninstall" goto :do_uninstall
if /i "%~1"=="init" goto :do_cli
if /i "%~1"=="skill" goto :do_cli
if /i "%~1"=="help" goto :show_help
if /i "%~1"=="--help" goto :show_help
if /i "%~1"=="-h" goto :show_help
if /i "%~1"=="--port" goto :parse_port
if /i "%~1"=="--profile" goto :parse_profile

echo Unknown command: %~1
echo Run "weave-fleet help" for usage.
exit /b 1

:do_cli
rem Delegate CLI commands to the standalone cli.js script (no server required)
if not exist "%CLI_JS%" (
    echo Error: cli.js not found at %CLI_JS% >&2
    echo Your installation may be corrupt. Re-install with: >&2
    echo   irm https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.ps1 ^| iex >&2
    exit /b 1
)
"%NODE_BIN%" "%CLI_JS%" %*
exit /b %ERRORLEVEL%

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
if not exist "%INSTALL_DIR%" (
    echo Already removed.
    exit /b 0
)
echo.
echo You may need to remove the PATH entry manually:
echo   1. Open Settings ^> System ^> About ^> Advanced system settings
echo   2. Click "Environment Variables"
echo   3. Under "User variables", edit "Path"
echo   4. Remove the entry: %INSTALL_DIR%\bin
echo.
rem Delete the install directory and exit on the same logical line.
rem cmd.exe reads one line at a time by file offset — if rd deletes the running
rem script (weave-fleet.cmd lives inside INSTALL_DIR), cmd.exe cannot seek to
rem the next line and emits "The system cannot find the path specified."
rem Keeping rd and exit /b on one line ensures the entire line is already in
rem memory before rd executes, so no further file reads are needed.
rd /s /q "%INSTALL_DIR%" >nul 2>&1 & echo Done. & exit /b 0

:show_help
set "VERSION=unknown"
if exist "%VERSION_FILE%" (
    set /p VERSION=<"%VERSION_FILE%"
)
echo Weave Fleet v!VERSION!
echo.
echo Usage: weave-fleet [command] [--port ^<number^>] [--profile ^<name^>]
echo.
echo Commands:
echo   (none)       Start the Weave Fleet server
echo   init ^<dir^>   Initialize a project with skill configuration
echo   skill        Manage skills (list, install, remove)
echo   version      Print the installed version
echo   update       Update to the latest version
echo   uninstall    Remove Weave Fleet
echo   help         Show this help message
echo.
echo Options:
echo   --port ^<number^>    Server port (overrides PORT env var, default: 3000)
echo   --profile ^<name^>   Named profile for data isolation (default: 'default')
echo                       Profile name: lowercase alphanumeric + hyphens, max 32 chars
echo                       e.g. --profile dev, --profile staging
echo.
echo Environment variables:
echo   PORT                  Server port (default: 3000)
echo   WEAVE_PROFILE         Profile name (default: unset = 'default')
echo   WEAVE_HOSTNAME        Server bind address (default: 0.0.0.0)
echo   WEAVE_DB_PATH         Database file path (default: %%USERPROFILE%%\.weave\fleet.db)
echo   WEAVE_WORKSPACE_ROOT  Workspace root dir (default: %%USERPROFILE%%\.weave\workspaces)
echo   WEAVE_PORT_RANGE_START Override OpenCode port range base (escape hatch)
echo   OPENCODE_BIN          Full path to opencode binary (if not on PATH)
exit /b 0

:parse_port
if "%~2"=="" (
    echo Error: --port requires a port number. >&2
    echo Usage: weave-fleet [--port ^<number^>] >&2
    exit /b 1
)
rem Validate numeric: strictly match one or more decimal digits only.
rem This rejects negatives (-1), hex (0x1F90), expressions (1+2), etc.
echo %~2| findstr /r "^[0-9][0-9]*$" >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo Error: --port value must be a number, got '%~2'. >&2
    exit /b 1
)
set "PORT=%~2"
rem Shift two args and loop back to parse remaining flags
shift
shift
goto :parse_flags

:parse_profile
if "%~2"=="" (
    echo Error: --profile requires a profile name. >&2
    echo Usage: weave-fleet [--profile ^<name^>] >&2
    exit /b 1
)
rem Validate: lowercase alphanumeric + hyphens only, must start/end with alphanumeric
echo %~2| findstr /r "^[a-z0-9][a-z0-9-]*[a-z0-9]$ ^[a-z0-9]$" >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo Error: --profile name must contain only lowercase alphanumeric characters and hyphens, and must start and end with an alphanumeric character, got '%~2'. >&2
    exit /b 1
)
rem Validate length (max 32 chars) — count manually
set "_pname=%~2"
if "!_pname:~32,1!" neq "" (
    echo Error: --profile name must be 32 characters or fewer. >&2
    exit /b 1
)
set "WEAVE_PROFILE=%~2"
rem Shift two args and loop back to parse remaining flags
shift
shift
goto :parse_flags

:start_server

rem Ensure server.js exists (only needed for start_server path)
if not exist "%SERVER_JS%" (
    echo Error: server.js not found at %SERVER_JS% >&2
    echo Your installation may be corrupt. Re-install with: >&2
    echo   irm https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.ps1 ^| iex >&2
    exit /b 1
)

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
if defined WEAVE_HOSTNAME (
    set "HOSTNAME=%WEAVE_HOSTNAME%"
) else (
    set "HOSTNAME=0.0.0.0"
)

rem Ensure data directory exists
if not exist "%USERPROFILE%\.weave" mkdir "%USERPROFILE%\.weave"

rem If a named profile is active, create its directory and wire derived env vars
if defined WEAVE_PROFILE (
    if /i not "%WEAVE_PROFILE%"=="default" (
        set "WEAVE_PROFILE_DIR=%USERPROFILE%\.weave\profiles\!WEAVE_PROFILE!"
        if not exist "!WEAVE_PROFILE_DIR!" mkdir "!WEAVE_PROFILE_DIR!"
        if not defined WEAVE_DB_PATH set "WEAVE_DB_PATH=!WEAVE_PROFILE_DIR!\fleet.db"
        if not defined WEAVE_WORKSPACE_ROOT set "WEAVE_WORKSPACE_ROOT=!WEAVE_PROFILE_DIR!\workspaces"
    )
)

set "VERSION=unknown"
if exist "%VERSION_FILE%" (
    set /p VERSION=<"%VERSION_FILE%"
)

rem Build startup message — include profile name if non-default
if defined WEAVE_PROFILE (
    if /i not "!WEAVE_PROFILE!"=="default" (
        echo Weave Fleet v!VERSION! [profile: !WEAVE_PROFILE!] starting on http://localhost:!PORT!
        goto :launch_server
    )
)
echo Weave Fleet v!VERSION! starting on http://localhost:!PORT!

:launch_server

rem Start the server
rem On Windows, Ctrl+C is handled natively by the console — Node.js receives SIGINT directly
"%NODE_BIN%" "%SERVER_JS%"
