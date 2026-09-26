# AGENTS.md

Repository contract for coding agents. Read this before editing.

## Shape

- Plain ESM JavaScript. Types come from JSDoc, checked by `tsc --noEmit`.
- Zero runtime dependencies. The only devDependencies are `@types/bun`, `@types/node`, and `typescript`.
- No build step. Published files are `index.js` and `src`. There is no transpile, bundle, or dist.
- Target runtime is Bun 1.4 or newer.

## Size cap

Every file stays under 250 pure lines of code. Blank lines, comments, and import lines do not count. If a change pushes a file past the cap, split the file along a real boundary.

## AI-slop rules

- No comments that restate the code. Name the reason, not the syntax.
- No empty `catch`. Log it or propagate it.
- No abstraction with one implementation. Two call sites minimum, or write it inline.
- No barrel files. Import the module you need from the module that owns it.

## Provider contract

Provider ids are exactly `codex`, `claude`, `commandcode`, `opencode-go`. No others.

Each provider module exports `id`, `label()`, and `fetch(creds, fetchImpl)`, and returns a `ProviderUsage`:

- `id` is one of the four ids above.
- `account` is the account label the provider exposes, or `null` when it exposes none.
- `windows` is an array of `Window`.
- `note` carries a plan name or status line when there is one.

A provider adapter THROWS when the credential is missing or the endpoint answers non-2xx. The caller catches per provider and renders that row as unavailable, so one broken provider never blanks the rest. Adapters do not catch their own fetch failures.

Types live in `src/types.js`:

```js
/** @import { ProviderUsage } from "../types.js" */
```

## Before opening a PR

```
bun install
bun run typecheck
bun test
```

All three must exit 0.
