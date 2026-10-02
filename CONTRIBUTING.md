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

## npm publishing

Add an npm token as the repository Actions secret `NPM_TOKEN`. It needs write access to `omo-usage` and permission to bypass two-factor authentication for unattended publishing. Use GitHub's secret settings or `gh secret set NPM_TOKEN --repo aslaii/omo-usage`; never commit the token. Update the secret when the token expires or is rotated.

The publish job runs only after the existing checks succeed on a push to `main`. GitHub-hosted runners use Node 24, and the token is passed only to the publish step as `NODE_AUTH_TOKEN`. The next version is the published npm version plus one patch. The runner updates `package.json` without creating a git tag or commit; keep manual version changes out of release PRs. Re-running a commit already published as `latest` skips the publish.

Before merging, inspect `npm pack --dry-run --json` and its nonempty file list. Public files must contain no credentials, real account identifiers, or captured live quota output. Do not publish manually alongside the queued workflow.
