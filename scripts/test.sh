#!/usr/bin/env bash
# scripts/test.sh: Unit tests execution for the platform applications.
set -euo pipefail

echo "[INFO] Running backend tests..."
node apps/src/backend/test.js
echo "[INFO] All tests completed successfully."
