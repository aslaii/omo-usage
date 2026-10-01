import { describe, expect, spyOn, test } from "bun:test";
import { fetch } from "../src/providers/codex.js";
import {
  CLAUDE_HOME,
  CLAUDE_WORK,
  NAMELESS,
  OMP,
  SENTINEL,
  WORK,
  claudeBody,
  claudeRows,
  codexBody,
  collectWith,
} from "./harness.js";

/** @import {FetchLike} from "../src/types.js" */

const ACCOUNT_NAMESPACE = "https://api.openai.com/auth";

/** @param {Record<string, unknown>} claims @returns {string} */
function jwt(claims) {
  const encode = (/** @type {unknown} */ value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(claims)}.`;
}

/**
 * @param {Record<string, unknown>} body
 * @returns {FetchLike}
 */
function answering(body) {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

/** @param {Record<string, unknown>} body */
function withIdentity(body) {
  return {
    email: "dev@example.test",
    plan_type: "pro",
    rate_limit: {
      limit_reached: false,
      primary_window: { used_percent: 11, reset_at: 1780000000 },
    },
    ...body,
  };
}

describe("codex account identity", () => {
  test("prefers the account the response names over the token's own claim", async () => {
    const usage = await fetch(
      {
        token: jwt({ [ACCOUNT_NAMESPACE]: { chatgpt_account_id: "acct-from-token" } }),
        accountId: "acct-stored",
      },
      answering(withIdentity({ account_id: "acct-from-response" })),
    );

    expect(usage.accountId).toBe("acct-from-response");
    expect(usage.account).toBe("dev@example.test");
  });

  test("falls back to that token's own claim when the response names no account", async () => {
    const usage = await fetch(
      { token: jwt({ [ACCOUNT_NAMESPACE]: { chatgpt_account_id: "acct-from-token" } }) },
      answering(withIdentity({})),
    );

    expect(usage.accountId).toBe("acct-from-token");
  });

  test("never borrows a sibling's flat stored id", async () => {
    const usage = await fetch(
      { token: "not-a-jwt", accountId: "acct-flat-sibling" },
      answering(withIdentity({})),
    );

    expect(usage.accountId).toBeUndefined();
    expect(usage.windows.map((window) => window.percent)).toEqual([11]);
    expect(usage.note).toBe("pro");
  });

  test("keeps the row usable when the token carries no readable identity", async () => {
    const sensitive = "fixture-sensitive-token-material";
    const token = `header.${Buffer.from(sensitive).toString("base64url")}.signature`;
    /** @type {unknown[][]} */
    const warnings = [];
    const warning = spyOn(console, "error").mockImplementation((...args) => {
      warnings.push(args);
    });
    let usage;
    try {
      usage = await fetch({ token }, answering(withIdentity({})));
    } finally {
      warning.mockRestore();
    }

    expect(usage.accountId).toBeUndefined();
    expect(usage.windows).toEqual([
      {
        label: "weekly",
        percent: 11,
        resetsAt: new Date(1780000000 * 1000).toISOString(),
        status: "ok",
      },
    ]);
    expect(warnings.length).toBe(1);
    expect(JSON.stringify(warnings)).not.toContain(sensitive);
    expect(JSON.stringify(warnings)).not.toContain(token);
  });
});

describe("collector identities", () => {
  test("names every unique Claude slot and keeps codex on its own response", () => {
    const { usages } = collectWith(
      {
        "chatgpt-subscription": { type: "oauth", access: WORK.access, accounts: [WORK] },
        "anthropic-subscription": {
          type: "oauth",
          ...SENTINEL,
          accounts: [CLAUDE_WORK, CLAUDE_HOME],
        },
      },
      {
        "fixture-work-token": {
          label: "work",
          body: codexBody("work@example.test", "pro", 12),
        },
        "fixture-claude-work-token": { label: "claude-work", body: claudeBody(21, 62) },
        "fixture-claude-home-token": { label: "claude-home", body: claudeBody(4, 9) },
      },
    );

    expect(claudeRows(usages).map((row) => row.accountId)).toEqual([
      "omo:claude-work",
      "omo:claude-home",
    ]);
    // The stored slot id steers the header only; identity comes from the body.
    expect(usages[0].accountId).toBeUndefined();
    expect(usages.map((usage) => usage.id)).toEqual([
      "codex",
      "claude",
      "claude",
      "commandcode",
      "opencode-go",
    ]);
  });

  test("marks the legacy fallback omp:default and OpenCode Go default", () => {
    const { usages } = collectWith(
      { "anthropic-subscription": { type: "oauth", ...SENTINEL, accounts: [] } },
      { "fixture-omp-token": { label: "omp", body: claudeBody(33, 55) } },
      OMP,
    );

    expect(claudeRows(usages).map((row) => row.accountId)).toEqual(["omp:default"]);
    expect(usages.filter((usage) => usage.id === "opencode-go")[0].accountId).toBe(
      "default",
    );
    expect(usages.filter((usage) => usage.id === "commandcode")[0].accountId).toBeUndefined();
  });

  test("withholds identity from a nameless slot without borrowing the fallback", () => {
    const { usages, claudeSent } = collectWith(
      { "anthropic-subscription": { type: "oauth", ...SENTINEL, accounts: [NAMELESS] } },
      { "fixture-nameless-token": { label: "nameless", body: claudeBody(8, 12) } },
      OMP,
    );

    const rows = claudeRows(usages);
    expect(rows.map((row) => row.accountId)).toEqual([undefined]);
    expect(rows[0].account).toBe("unnamed");
    expect(rows[0].windows.map((window) => window.percent)).toEqual([8, 12]);
    expect(claudeSent).toEqual(["nameless"]);
  });

  test("withholds identity from two slots that share one name", () => {
    const twin = { ...CLAUDE_WORK, access: "fixture-claude-twin-token" };
    const { usages } = collectWith(
      { "anthropic-subscription": { type: "oauth", ...SENTINEL, accounts: [CLAUDE_WORK, twin] } },
      {
        "fixture-claude-work-token": { label: "claude-work", body: claudeBody(21, 62) },
        "fixture-claude-twin-token": { label: "claude-twin", body: claudeBody(30, 70) },
      },
      OMP,
    );

    expect(claudeRows(usages).map((row) => row.accountId)).toEqual([undefined, undefined]);
    expect(claudeRows(usages).map((row) => row.windows.length)).toEqual([2, 2]);
  });
});
