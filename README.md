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

For Command Code, `5h` and `weekly` show headroom in rolling limits, while `monthly included` shows the plan credits left. Purchased credits are spent first and bypass the rolling limits. The rolling lines can therefore read `100% left` while the included monthly allowance reads `0% left`; the balance in the header includes purchased credits.

Without a TUI, `bun run probe` prints the same table to stdout using the same code path.

## Accounts

OmO lets you add several accounts of the same kind with `/gpt-account add` and `/claude-account add`. Each addition is stored as a slot in the agent store, and `/omo-usage` prints one row per slot instead of collapsing them. Rows appear in the order the slots are stored, so the same accounts show up in the same place on every run.

For Claude, each non-managed slot gets a row, including an unavailable row if its token is missing. OmO also keeps a managed placeholder that carries no usable token; the extension skips it and never sends it to the Anthropic API. When no non-managed slot is stored, the read falls back to the legacy credential in OMP's SQLite store.

A failed slot stays a failed row, not a blank block. Its row prints the provider label plus the slot's name (or `unnamed` if it has none), followed by the reason it could not be read. Account labels come from whatever the provider or store exposes; the extension only relays them and stores none of its own.

## Providers

| Provider     | Endpoints                                                                                                        |
|--------------|------------------------------------------------------------------------------------------------------------------|
| codex        | `https://chatgpt.com/backend-api/wham/usage`                                                                      |
| claude       | `https://api.anthropic.com/api/oauth/usage`                                                                       |
| commandcode  | `https://api.commandcode.ai/alpha/whoami`, `/alpha/billing/credits`, `/alpha/billing/subscriptions`                |
| opencode-go  | `https://opencode.ai/zen/go/v1/usage`                                                                             |

Credentials come from the agent's own stores. The extension never writes, refreshes, or rotates any credential.

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
