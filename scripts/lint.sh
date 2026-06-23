#!/usr/bin/env bash
# scripts/lint.sh: Syntax and linting check for the platform applications.
set -euo pipefail

echo "[INFO] Starting lint checks..."
# Check backend javascript syntax
node --check apps/src/backend/server.js
echo "[INFO] Lint checks passed successfully."
