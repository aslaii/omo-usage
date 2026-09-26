# OmO Usage

An OmO extension that prints live usage and quota for Codex, Claude, Command Code, and OpenCode Go.

## Install

```sh
omo install npm:omo-usage
```

Restart OmO, then run `/omo-usage`. To install directly from GitHub instead, use `omo install git:github.com/aslaii/omo-usage`. Pi users can run `pi install npm:omo-usage`.

The command is `omo install npm:omo-usage`, not `omo install:aslaiiomousage`. npm hosts the package; the same package can be installed from GitHub without npm publication.

## Usage

Run `/omo-usage` in the TUI. It prints one block per provider, with available quota and reset times when reported. A provider that cannot be read appears as unavailable. Percentages show quota left, not quota spent.

Without a TUI, `bun run probe` prints the same table to stdout using the same code path.

## Providers

| Provider     | Endpoints                                                                                                        |
|--------------|------------------------------------------------------------------------------------------------------------------|
| codex        | `https://chatgpt.com/backend-api/wham/usage`                                                                      |
| claude       | `https://api.anthropic.com/api/oauth/usage`                                                                       |
| commandcode  | `https://api.commandcode.ai/alpha/whoami`, `/alpha/billing/credits`, `/alpha/billing/subscriptions`                |
| opencode-go  | `https://opencode.ai/zen/go/v1/usage`                                                                             |

Credentials come from the agent's own stores. The extension never writes, refreshes, or rotates any credential. Claude's usable token lives in the OMP SQLite credential store, not in OmO's `auth.json`, which holds a placeholder the Anthropic API rejects.

## Development

Requires Bun 1.4 or newer. Zero runtime dependencies.

```
bun install
bun run typecheck
bun test
```

## Design

Each provider is an adapter that throws on failure. The collector isolates each provider, so one broken provider never blanks the rest. The renderer stays plain ASCII. That is the whole design.

## License

MIT. Repository: https://github.com/aslaii/omo-usage. Issues: https://github.com/aslaii/omo-usage/issues.
