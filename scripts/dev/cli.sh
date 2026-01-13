#!/usr/bin/env bash
# ----------------------------------------------------------------------
# Development CLI helper for Project CHARLIE
#
# This script starts the Charlie application in CLI mode using the same
# entrypoint as the daemon (appRunner.js).
#
# Purpose:
# - Start the CLI against a running Charlie daemon
# - Reuse the same argument parsing and config logic
# - Optionally enable Node.js inspector for CLI debugging
#
# Usage examples:
#   scripts/dev/cli.sh
#   scripts/dev/cli.sh --host 127.0.0.1 --port 8787
#   scripts/dev/cli.sh --no-inspect
#   scripts/dev/cli.sh -- --log-level debug
#
# Everything after `--` is forwarded directly to appRunner.js
# ----------------------------------------------------------------------

set -euo pipefail

cd /opt/charlie/charlie

HOST="127.0.0.1"
PORT="8787"
INSPECT="1"
INSPECT_PORT="9230"

PASS_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="${2:-127.0.0.1}"
      shift 2
      ;;
    --port)
      PORT="${2:-8787}"
      shift 2
      ;;
    --no-inspect)
      INSPECT="0"
      shift
      ;;
    --inspect-port)
      INSPECT_PORT="${2:-9230}"
      shift 2
      ;;
    --)
      shift
      PASS_ARGS+=("$@")
      break
      ;;
    *)
      PASS_ARGS+=("$1")
      shift
      ;;
  esac
done

NODE_ARGS=()
if [[ "${INSPECT}" == "1" ]]; then
  NODE_ARGS+=( "--inspect=127.0.0.1:${INSPECT_PORT}" )
fi

echo "Starting Charlie CLI (host=${HOST}, port=${PORT}, inspect=${INSPECT})"

exec yarn node "${NODE_ARGS[@]}" src/app/appRunner.js \
  --cmd cli \
  --host "${HOST}" \
  --port "${PORT}" \
  "${PASS_ARGS[@]}"
