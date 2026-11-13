# Changelog

All notable changes to Mnemo. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org).

## [Unreleased]

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
