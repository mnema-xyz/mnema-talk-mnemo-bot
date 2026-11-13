# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/msch128/mnema-talk-mnemo-bot/security/advisories/new),
not in a public issue. Include what an attacker can do, the steps to
reproduce it, and the version or commit. You will get an answer within a
few days.

A vulnerability in Mnema Talk itself or in its SDK belongs to
[Mnema Talk's security policy](https://github.com/msch128/mnema-talk/security/policy).

## Supported versions

Only the latest release gets fixes.

## What Mnemo is designed to withstand

- **Prompt injection.** A member, a web page, a Wikipedia article or a search
  result can contain text that tries to give Mnemo instructions. Tool results
  go to the model as data. The system prompt always says that such content
  is not to be followed. Above all, Mnemo has nothing dangerous to be talked
  into: its only action is posting an answer in the conversation it was asked
  in. It has no tool that writes, deletes, moderates or sends anything
  elsewhere, and its bot account holds only *View channels*, *Send messages*
  and *Add reactions* in the channels the Owner ticked.
- **Abuse of tools.** Every tool's input is validated against a narrow schema
  (lengths, ranges, enums). No tool builds a host name, a path or a command
  from model output: the services are fixed (Open-Meteo, Wikipedia with a
  validated language code, Brave or Tavily). The calculator is a parser, not
  `eval`.
- **Running up costs.** Per-member and per-channel rate limits, a daily token
  or cost budget, a tool-call limit, a bound on model calls per question, and
  timeouts. Regenerate is limited to the person who asked.
- **Leaking secrets.** Tokens and keys come only from the environment or
  `*_FILE`. The config file refuses them. Logs redact fields that look like
  secrets and never contain message text. The model never sees the tokens.
- **Leaking conversations.** Mnemo sends the provider only the question and
  the bounded context of its own thread (see the README's *Privacy*), and
  never reads a channel's history.

## What is out of scope

- What the AI provider does with the data it receives: that is the
  provider's terms. A local model through `openai-compatible` avoids it.
- Wrong or misleading answers. Models make mistakes; the Details button shows
  which answers came from a tool and which from the model alone.
- An operator who gives the bot account more permissions than the manifest
  asks for.
