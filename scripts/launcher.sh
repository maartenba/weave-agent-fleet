#!/usr/bin/env sh
# weave-fleet — launcher script for Weave Agent Fleet
# Installed to ~/.weave/fleet/bin/weave-fleet
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_BIN="$INSTALL_DIR/bin/node"
SERVER_JS="$INSTALL_DIR/app/server.js"
VERSION_FILE="$INSTALL_DIR/VERSION"

# Ensure bundled Node.js binary exists
if [ ! -x "$NODE_BIN" ]; then
  echo "Error: bundled Node.js binary not found at $NODE_BIN" >&2
  echo "Your installation may be corrupt. Re-install with:" >&2
  echo "  curl -fsSL https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.sh | sh" >&2
  exit 1
fi

# Ensure server.js exists
if [ ! -f "$SERVER_JS" ]; then
  echo "Error: server.js not found at $SERVER_JS" >&2
  echo "Your installation may be corrupt. Re-install with:" >&2
  echo "  curl -fsSL https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.sh | sh" >&2
  exit 1
fi

# Parse subcommands
case "${1:-}" in
  version|--version|-v)
    if [ -f "$VERSION_FILE" ]; then
      cat "$VERSION_FILE"
    else
      echo "unknown"
    fi
    exit 0
    ;;
  update)
    echo "Updating Weave Fleet..."
    if command -v curl >/dev/null 2>&1; then
      exec sh -c "curl -fsSL https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.sh | sh"
    elif command -v wget >/dev/null 2>&1; then
      exec sh -c "wget -qO- https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.sh | sh"
    else
      echo "Error: curl or wget is required to update." >&2
      exit 1
    fi
    ;;
  uninstall)
    echo "Removing Weave Fleet from $INSTALL_DIR..."
    rm -rf "$INSTALL_DIR"
    echo "Done. You may need to remove the PATH entry from your shell config manually:"
    echo "  Remove: export PATH=\"\$HOME/.weave/fleet/bin:\$PATH\""
    exit 0
    ;;
  help|--help|-h)
    VERSION="unknown"
    [ -f "$VERSION_FILE" ] && VERSION="$(cat "$VERSION_FILE")"
    echo "Weave Fleet v${VERSION}"
    echo ""
    echo "Usage: weave-fleet [command]"
    echo ""
    echo "Commands:"
    echo "  (none)       Start the Weave Fleet server"
    echo "  version      Print the installed version"
    echo "  update       Update to the latest version"
    echo "  uninstall    Remove Weave Fleet"
    echo "  help         Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  PORT             Server port (default: 3000)"
    echo "  HOSTNAME         Server hostname (default: 0.0.0.0)"
    echo "  WEAVE_DB_PATH    Database file path (default: ~/.weave/fleet.db)"
    exit 0
    ;;
esac

# Check that opencode CLI is available
if ! command -v opencode >/dev/null 2>&1; then
  echo "Error: 'opencode' CLI not found on PATH." >&2
  echo "" >&2
  echo "Weave Fleet requires OpenCode to manage AI agent sessions." >&2
  echo "Install it with:" >&2
  echo "  curl -fsSL https://opencode.ai/install | bash" >&2
  exit 1
fi

# Set environment for production
export NODE_ENV=production
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

# Ensure data directory exists
mkdir -p "${HOME}/.weave"

VERSION="unknown"
[ -f "$VERSION_FILE" ] && VERSION="$(cat "$VERSION_FILE")"

echo "Weave Fleet v${VERSION} starting on http://localhost:${PORT}"

# Forward signals to the Node.js process
trap 'kill $NODE_PID 2>/dev/null; wait $NODE_PID 2>/dev/null; exit' INT TERM HUP

# Start the server
"$NODE_BIN" "$SERVER_JS" &
NODE_PID=$!
wait $NODE_PID
