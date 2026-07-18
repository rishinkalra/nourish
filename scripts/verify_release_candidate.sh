#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="local"

if [[ "${1:-}" == "--help" ]]; then
  echo "Usage: scripts/verify_release_candidate.sh [--staging]"
  exit 0
fi

if [[ "${1:-}" == "--staging" ]]; then
  MODE="staging"
  shift
fi

if [[ $# -ne 0 ]]; then
  echo "Usage: scripts/verify_release_candidate.sh [--staging]" >&2
  exit 2
fi

NODE_BIN="${NOURISH_NODE_BIN:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Release verification requires Node.js 24 or later. Set NOURISH_NODE_BIN if it is not on PATH." >&2
  exit 1
fi

for command_name in ruby swift xcodebuild; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Release verification requires $command_name on PATH." >&2
    exit 1
  fi
done

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nourish-release.XXXXXX")"
trap 'rm -rf "$TEMP_ROOT"' EXIT

echo "[1/6] Validating the secret-free deployment template"
ruby -e 'require "yaml"; value = YAML.safe_load(File.read(ARGV.fetch(0)), aliases: true); abort("Invalid DigitalOcean app specification") unless value.is_a?(Hash)' "$ROOT_DIR/.do/app.staging.yaml"

if [[ "$MODE" == "staging" ]]; then
  echo "[staging] Validating the rendered DigitalOcean configuration"
  (
    cd "$ROOT_DIR/backend"
    "$NODE_BIN" src/digitalocean-preflight-cli.mjs
  )
fi

echo "[2/6] Running the complete backend suite"
(
  cd "$ROOT_DIR/backend"
  "$NODE_BIN" --test
)

echo "[3/6] Running shared Swift checks"
swift run --package-path "$ROOT_DIR/ios" --scratch-path "$TEMP_ROOT/swift" NourishCoreChecks

echo "[4/6] Building the iOS Debug application"
xcodebuild \
  -project "$ROOT_DIR/ios/NourishApp/NourishApp.xcodeproj" \
  -scheme NourishApp \
  -configuration Debug \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath "$TEMP_ROOT/xcode-debug" \
  CODE_SIGNING_ALLOWED=NO \
  build

echo "[5/6] Building the iOS Release application"
xcodebuild \
  -project "$ROOT_DIR/ios/NourishApp/NourishApp.xcodeproj" \
  -scheme NourishApp \
  -configuration Release \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath "$TEMP_ROOT/xcode-release" \
  CODE_SIGNING_ALLOWED=NO \
  build

echo "[6/6] Running all native application and UI tests"
SIMULATOR_DESTINATION="${NOURISH_SIMULATOR_DESTINATION:-platform=iOS Simulator,name=iPhone 17 Pro,OS=latest}"
xcodebuild \
  -project "$ROOT_DIR/ios/NourishApp/NourishApp.xcodeproj" \
  -scheme NourishApp \
  -destination "$SIMULATOR_DESTINATION" \
  -derivedDataPath "$TEMP_ROOT/xcode-tests" \
  CODE_SIGNING_ALLOWED=NO \
  test \
  -only-testing:NourishAppTests \
  -only-testing:NourishAppUITests

echo "Nourish $MODE release verification passed."
