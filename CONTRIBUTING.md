# Contributing to Mnemo

Thank you for helping. Mnemo is a blueprint people copy, so **readable beats
clever**: small files, plain names, a comment where the reason is not obvious.

## Setup

Node.js 24 or newer, then:

```sh
npm ci
npm run check     # lint, typecheck, unit tests
```

Node runs the TypeScript sources directly (type stripping), so there is no
build step. That is why the code uses only syntax that can be erased: no
`enum`, no `namespace`, no parameter properties, and imports end in `.ts`.
`tsc` only checks the types.

## Rules

- **Tests come with the change.** Unit tests never touch the network or a
  real AI provider. Use `fakeProvider` and `recordedFetch`
  (`test/helpers.ts`), and put recorded responses in `test/fixtures/`.
  Test behaviour (what a member or the model sees), not internals.
- **No new runtime dependency** without a reason that would go into the
  README's *Dependencies* table. Prefer Node's standard library.
- **Never commit a secret**: no API keys, tokens, private addresses or
  personal data, also not in fixtures or examples. Use `example.org` and
  placeholders. CI runs on every push; run `gitleaks dir .` locally if you
  have it.
- **Privacy**: anything new that is sent to the AI provider or a tool's
  service must be listed in the README's *Privacy* section.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`), in English.
- After changing the avatar or the commands, run `npm run manifest`. After
  changing settings, run `npm run config-schema` and update the README's
  configuration table. CI checks that both generated files are current.

## Integration test

Changes to `src/bot/` should pass the integration test against a real
Mnema Talk (Docker needed):

```sh
MNEMA_SRC=../mnema-talk scripts/integration.sh
```

## Pull requests

Describe what changes for the people who run Mnemo and for the members who
talk to it. Keep a pull request to one subject. Give it a conventional
commit title (`feat:`, `fix:`, `docs:`, `chore:` ...): the title becomes the
commit on `main`, and the changelog and the next version are made from those
commits, so write it for the people who read the changelog.

By contributing you agree that your contribution is licensed under the
[AGPL-3.0](LICENSE).

## Releases

Releases are automatic. After each merge to `main`, release-please opens or
updates a release pull request that bumps the version and writes
[CHANGELOG.md](CHANGELOG.md) from the conventional commits (`feat:` and `fix:`
make a release; before 1.0 both bump the patch number, and a `!` or a
`BREAKING CHANGE:` bumps the minor number). Merging that pull request creates
the tag `vX.Y.Z` and the GitHub release, and the same workflow then builds the
image for linux/amd64 and linux/arm64 and pushes it to
`ghcr.io/mnema-xyz/mnemo` as `X.Y.Z`, `X.Y` and `latest`, with provenance
and SBOM attestations. Before it builds, the workflow runs
`scripts/release-check.sh`, which fails while the README still has the
`MNEMA_MIN_VERSION` placeholder or `package.json` still takes the SDK from
`vendor/`: a release must not depend on unreleased Mnema Talk. To build the
image of an existing tag again, run the *release* workflow by hand with that tag.
