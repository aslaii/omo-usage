# OmO Usage

An OmO extension that prints live usage and quota for Codex, Claude, Command Code, and OpenCode Go, with optional Moshi sync.

## Install

```sh
omo install git:github.com/aslaii/omo-usage
```

Reload or restart OmO, then run `/omo-usage`. The GitHub installation includes Moshi sync. The existing npm release remains available with `omo install npm:omo-usage`; this feature has not yet been published there. Pi users can use the same GitHub source with `pi install`.

The command is `omo install npm:omo-usage`, not `omo install:aslaiiomousage`. npm hosts the package; the same package can be installed from GitHub without npm publication.

## Usage

Run `/omo-usage` in the TUI. It prints one block per stored account, with available quota and reset times when reported. A provider that cannot be read appears as unavailable. Percentages show quota left, not quota spent.

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

## Moshi

Pair the host with [moshi-hook](https://getmoshi.app/docs/install-moshi-hook) first. This extension reads that existing pairing; it does not pair the host or copy provider credentials.

```text
/omo-usage moshi sync
/omo-usage moshi on
/omo-usage moshi status
/omo-usage moshi off
```

`sync` uploads once. `on` uploads immediately and enables background sync every five minutes after the preceding attempt finishes. Background sync is off by default and lasts for the current session. `off` and session shutdown cancel pending work and remove the timer. Concurrent manual and background calls share one attempt. Each attempt has a 15-second deadline.

From a repository checkout or package directory, without a TUI:

```sh
bun run probe --moshi
```

The ordinary `/omo-usage` command and `bun run probe` remain local and work without Moshi pairing.

| Local provider | Moshi coverage |
| --- | --- |
| Codex | One snapshot per usable GPT account, using its own provider identity |
| Claude | One snapshot per usable named Claude slot; the legacy OMP fallback is separate |
| OpenCode Go | The saved key, under Moshi's native OpenCode category |
| Command Code | Local table only; Moshi has no native usage category |

The result reports omitted providers and windows. Unknown percentages, invalid resets, unavailable accounts, missing or duplicate identities, and credit-pool expiries are not fabricated into quota values. A known percentage with no reset date is still sent. Moshi receives percentages **used**; the local table displays quota **left**.

Moshi sync sends account identifiers, slot labels, provider categories, the host name, quota windows, and capture/reset timestamps to the paired host's Moshi usage endpoint. OAuth tokens and provider API keys stay in their original stores. The existing Moshi host secret is used only for authentication.

On macOS, an existing Keychain pairing is read from `app.getmoshi.hook`. File-backed pairings read `host-secret` from Moshi's `secrets.json`, not the pairing token. `MOSHI_CONFIG_DIR`, `MOSHI_STATE_DIR`, and `MOSHI_API_BASE` retain their native meanings; `MOSHI_HOOK_CONFIG_DIR` controls gateway settings, not the pairing root.

Once this sync works, Moshi's separate built-in collector can be disabled to prevent competing account snapshots:

```sh
moshi-hook set usage-collection off
brew services restart moshi-hook
```

That setting affects Moshi's own usage collector, not inbox hooks. Enable this extension's background sync when you want continued updates. Turning sync off stops updates; it does not delete previously uploaded cards. Snapshot expiry and removal are controlled by Moshi. An HTTP acceptance confirms upload, not which device or license bucket displays it.

## Development

Requires Bun 1.4 or newer. Zero runtime dependencies.

```
bun install
bun run typecheck
bun test
```

## Design

Each provider is an adapter that throws on failure. The collector isolates each provider, so one broken provider never blanks the rest. The renderer stays plain ASCII. The optional Moshi exporter reuses those collected rows and keeps unsupported data explicit.

## License

MIT. Repository: https://github.com/aslaii/omo-usage. Issues: https://github.com/aslaii/omo-usage/issues.
