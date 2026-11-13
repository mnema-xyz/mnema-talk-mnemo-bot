# Changelog

All notable changes to Mnemo. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.1.1] - 2026-11-13

### Changed

- Cheaper answers on Anthropic: Mnemo now uses prompt caching, so the tool
  descriptions and the system prompt, which every call repeats, are billed
  at a tenth of the input price after the first call within 5 minutes. It
  is on by default and needs no setting. Answers are unchanged.
- To make that possible the system prompt no longer contains the time or the
  asker's name; both arrive as a short note in front of the question. If you
  use a custom persona (`MNEMO_SYSTEM_PROMPT`), keep it free of dates and
  IDs, or it cannot be cached.
- The daily cost budget (`MNEMO_DAILY_COST_BUDGET_USD`) now prices cached
  tokens correctly: reads at 0.1 times and writes at 1.25 times the input
  price. The token budget still counts every token. Today's counters in
  `budget.json` carry over.
- With `MNEMO_LOG_LEVEL=debug`, each Anthropic call logs `anthropic_cache`
  with its cache read and write token counts, to check that caching works.
- The OpenAI providers behave as before.

## [0.1.0] - 2026-11-13

First release. Requires Mnema Talk 3.1.0 or newer and takes the SDK from
that release.

### Added

- Mnemo answers mentions in a thread under the question, keeps the
  thread's context (bounded), and answers `/ask`, publicly or privately.
- Buttons under answers: Regenerate (for the asker), Details (tools,
  model, tokens, what was sent) and Follow up (a modal, under `/ask`
  answers).
- Providers: Anthropic (default `claude-haiku-5-5`), OpenAI, and any
  OpenAI-compatible server (Ollama, OpenRouter, LM Studio, vLLM), plus a
  fake provider for dry runs and tests.
- Tools: weather and forecast (Open-Meteo), calculator (own parser, no
  `eval`), date and time with time zones, unit conversion, Wikipedia, and
  optional web search (Brave or Tavily).
- Guards: per-member and per-channel rate limits, a daily token or cost
  budget that survives restarts, tool-call and model-call limits, timeouts.
- Configuration from environment variables and an optional JSON file with a
  schema, checked at start; secrets only from the environment or `*_FILE`.
- Manifest with avatar, add link script, Dockerfile (non-root, pinned base
  image), Compose example, health endpoint, JSON logs, graceful shutdown.
- The `openai` provider uses OpenAI's Responses API (nothing stored between
  calls); OpenAI-compatible servers use Chat Completions.
- A hard daily budget: every model call reserves its worst case and settles
  it with the reported usage; failed calls count at their worst case.
- Rate-limit refusals once per member and window for mentions, and privately
  for `/ask` and the buttons.
- A fatal gateway close ends Mnemo with exit code 1, so Docker restarts it.
- Mnemo follows only the threads it starts.
- No answer notifies anyone (`allowed_mentions` with an empty `parse` list).
- An integration test against a real Mnema Talk, and a release check for tags.

[Unreleased]: https://github.com/mnema-xyz/mnema-talk-mnemo-bot/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/mnema-xyz/mnema-talk-mnemo-bot/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mnema-xyz/mnema-talk-mnemo-bot/releases/tag/v0.1.0
