#!/usr/bin/env bash

# ----------------------------------------------------------------------
# Development restart helper for Project CHARLIE
#
# This script is intended for DEVELOPMENT AND DEBUGGING ONLY.
#
# Purpose:
# - Restart the Charlie runtime on a Raspberry Pi during development
# - Optionally enable the Node.js inspector for remote debugging
# - Be callable manually or via WebStorm (SSH External Tool)
#
# Design notes:
# - The Pi is treated as a runtime/debug target, not a dev workstation
# - No IDE backend or file editing happens on the Pi
# - This script is safe to run repeatedly and is intentionally simple
#
# Usage examples:
#   scripts/dev/restart.sh --mode win11
#   scripts/dev/restart.sh --mode rpi4 --interactive
#   scripts/dev/restart.sh --mode hw --no-inspect
#   scripts/dev/restart.sh --mode hw -- --extra-app-arg value
#
# Everything after `--` is forwarded directly to:
#   src/app/appRunner.js
#
# This script is version-controlled and part of the documented
# development workflow. It is NOT used in production or systemd.
# ----------------------------------------------------------------------

set -euo pipefail

cd /opt/charlie/charlie

MODE="rpi4"
INSPECT="1"

# Parse our script flags, pass everything else through to node
PASS_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --no-inspect)
      INSPECT="0"
      shift
      ;;
    --inspect-port)
      INSPECT_PORT="${2:-9229}"
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

# Kill any running Charlie instance (dev only)
pkill -f 'src/app/appRunner\.js' || true

NODE_ARGS=()
if [[ "${INSPECT}" == "1" ]]; then
  INSPECT_PORT="${INSPECT_PORT:-9229}"
  NODE_ARGS+=( "--inspect=127.0.0.1:${INSPECT_PORT}" )
fi

echo "Starting Charlie: mode=${MODE}, inspect=${INSPECT}, extra_args='${PASS_ARGS[*]-}'"

exec yarn node "${NODE_ARGS[@]}" src/app/appRunner.js --mode "${MODE}" "${PASS_ARGS[@]}"
