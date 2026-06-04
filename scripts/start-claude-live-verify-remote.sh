#!/usr/bin/env bash
set -euo pipefail

# Start a Claude Code Remote Control session for the ARS Web Studio live verify run.
# This script only opens the visible remote session. It does NOT execute /live-verify.
# After it starts, connect from Claude mobile or https://claude.ai/code and type:
#   /live-verify

cd "$(dirname "$0")/.."

cat <<'MSG'
Starting Claude Code Remote Control for ARS Web Studio.

Phone/browser monitor:
  https://claude.ai/code

When connected, type this in the remote Claude Code session:
  /live-verify

Important:
- Permission mode is set to bypassPermissions from the start.
- If Claude hard usage/rate limit is reached, stop and resume after reset.
- This script intentionally does NOT run the test automatically.
MSG

MSYS2_ARG_CONV_EXCL='*' claude remote-control \
  --name ars-web-studio-live-verify \
  --permission-mode bypassPermissions \
  --spawn=session
