#!/usr/bin/env bash
# Refuses a release while it still depends on unreleased Mnema Talk: the
# README's version placeholder must be filled in and package.json must take
# the SDK from a Mnema Talk release, not from vendor/. CI runs it for tags.
set -euo pipefail
fail=0
if grep -q 'MNEMA_MIN_VERSION' README.md; then
  echo "README.md still has the MNEMA_MIN_VERSION placeholder: fill in the first Mnema Talk release with the bot platform" >&2
  fail=1
fi
if grep -q '"mnema-talk-sdk": "file:vendor/' package.json; then
  echo "package.json still takes mnema-talk-sdk from vendor/: point it at the release tarball (README, \"The SDK dependency\")" >&2
  fail=1
fi
exit "$fail"
