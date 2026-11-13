#!/usr/bin/env bash
# Refuses a release while it still depends on unreleased Mnema Talk: the
# README's version placeholder must be filled in and package.json must take
# the SDK from the npm registry at an exact version, not from a file, a URL
# or the old mnema-talk-sdk tarball. CI runs it for tags.
set -euo pipefail
fail=0
if grep -q 'MNEMA_MIN_VERSION' README.md; then
  echo "README.md still has the MNEMA_MIN_VERSION placeholder: fill in the first Mnema Talk release with the bot platform" >&2
  fail=1
fi
if ! grep -Eq '"@mnema-xyz/bot-sdk": "[0-9]+\.[0-9]+\.[0-9]+"' package.json || grep -q '"mnema-talk-sdk"' package.json; then
  echo "package.json must take @mnema-xyz/bot-sdk from the npm registry at an exact version, not from vendor/ or a URL (README, \"The SDK dependency\")" >&2
  fail=1
fi
exit "$fail"
