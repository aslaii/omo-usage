# Contributing

## Setup

Requires Bun 1.4 or newer.

```
git clone https://github.com/aslaii/omo-usage.git
cd omo-usage
bun install
bun test
```

## Change rules

- Plain ESM JavaScript with JSDoc types. No build step, no transpile.
- Zero runtime dependencies. Adding one needs a written reason in the PR body.
- Keep every file under 250 pure lines of code. Split along a real boundary when it grows past that.
- Provider ids are fixed: `codex`, `claude`, `commandcode`, `opencode-go`.
- Every provider returns a `ProviderUsage` from `src/types.js`. A failed fetch returns a `ProviderUsage` with `error` set, not a thrown error.
- No comments that restate the code, no empty `catch`, no abstraction with one implementation, no barrel files.
- Touch one concern per PR.

## What a test must prove

A test runs offline. It must fail if the code under test is wrong.

- Mock the network or filesystem at the boundary. Never hit a live provider endpoint.
- Assert on the normalized `ProviderUsage` shape, not on internal call order.
- Cover the failure path. A provider with no credentials, a non-200 response, and a malformed payload each need a case.
- No fixed sleeps, no polling loops. Wait on the promise or the mocked signal.
- No assertion on prose, prompt wording, or documentation text.

## Pull requests

Run these before opening:

```
bun run typecheck
bun test
```

Both must exit 0. Describe the behavior change and the test that proves it.
