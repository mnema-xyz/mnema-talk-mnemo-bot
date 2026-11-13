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
talk to it. Keep a pull request to one subject. Add a line under
*Unreleased* in [CHANGELOG.md](CHANGELOG.md).

By contributing you agree that your contribution is licensed under the
[AGPL-3.0](LICENSE).
