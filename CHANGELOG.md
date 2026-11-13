# Changelog

All notable changes to Mnemo. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.1.1] - 2026-11-13
### Changed

- Anthropic prompt caching: the system prompt (and the tools before it) is
  cached, and the conversation tail is cached across the rounds of a tool
  loop. The system prompt is now identical for every request; the current
  time and the asker's name arrive as a short note before the question.
  Answers are unchanged. The OpenAI providers send the same text as before.
- The daily cost budget prices cache reads at 0.1 times and cache writes at
  1.25 times the input price; the token budget still counts every token.
  Today's counters in `budget.json` carry over.
- `MNEMO_LOG_LEVEL=debug` logs `anthropic_cache` with the cache read and
  write token counts of each call.

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
