import { describe, expect, test } from "bun:test";
import { fetch, id, label } from "../src/providers/codex.js";

const RESET_AT_SECONDS = 1780000000;
const RESET_AT_ISO = new Date(RESET_AT_SECONDS * 1000).toISOString();

function usageBody() {
  return {
    user_id: "user_abc",
    account_id: "acct_xyz",
    email: "dev@example.com",
    plan_type: "pro",
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 37,
        limit_window_seconds: 604800,
        reset_after_seconds: 1200,
        reset_at: RESET_AT_SECONDS,
      },
      secondary_window: {
        used_percent: 4,
        limit_window_seconds: 18000,
        reset_after_seconds: 600,
        reset_at: RESET_AT_SECONDS + 3600,
      },
    },
    model_usage: null,
    credits: { balance: 12.5 },
    rate_limit_reset_credits: { available_count: 2 },
  };
}

/** @param {unknown} body */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** @param {Response} response */
function fakeFetch(response) {
  /** @type {{ url: string, init: any }[]} */
  const calls = [];
  const impl = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, init });
    return response;
  };
  impl.calls = calls;
  return impl;
}

describe("codex", () => {
  test("exposes the provider id and label", () => {
    expect(id).toBe("codex");
    expect(label()).toBe("Codex (ChatGPT)");
  });

  test("maps the primary window to a single weekly window", async () => {
    const fetchImpl = fakeFetch(jsonResponse(usageBody()));
    const usage = await fetch({ token: "tok" }, fetchImpl);

    expect(usage.id).toBe("codex");
    expect(usage.account).toBe("dev@example.com");
    expect(usage.note).toBe("pro · 2 reset credits");
    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0]).toEqual({
      label: "weekly",
      percent: 37,
      resetsAt: RESET_AT_ISO,
      status: "ok",
    });
  });

  test("reports a single reset credit in the singular and omits the count at zero", async () => {
    const oneBody = usageBody();
    oneBody.rate_limit_reset_credits = { available_count: 1 };
    const one = await fetch({ token: "tok" }, fakeFetch(jsonResponse(oneBody)));
    expect(one.note).toBe("pro · 1 reset credit");

    const noneBody = usageBody();
    noneBody.rate_limit_reset_credits = { available_count: 0 };
    const none = await fetch({ token: "tok" }, fakeFetch(jsonResponse(noneBody)));
    expect(none.note).toBe("pro");
  });

  test("sends bearer auth, accept and the codex user agent", async () => {
    const fetchImpl = fakeFetch(jsonResponse(usageBody()));
    await fetch({ token: "tok" }, fetchImpl);

    const [{ url, init }] = fetchImpl.calls;
    expect(url).toBe("https://chatgpt.com/backend-api/wham/usage");
    expect(init.headers.authorization).toBe("Bearer tok");
    expect(init.headers.accept).toBe("application/json");
    expect(init.headers["user-agent"]).toBe("codex_cli_rs/0.50.0 (Mac OS 15.3.1; arm64)");
    expect(init.headers["chatgpt-account-id"]).toBeUndefined();
  });

  test("sends the account header only when the credential carries an account id", async () => {
    const fetchImpl = fakeFetch(jsonResponse(usageBody()));
    await fetch({ token: "tok", accountId: "acct_xyz" }, fetchImpl);

    expect(fetchImpl.calls[0].init.headers["chatgpt-account-id"]).toBe("acct_xyz");
  });

  test("reports rate-limited when the endpoint says the limit is reached", async () => {
    const body = usageBody();
    body.rate_limit.limit_reached = true;
    const usage = await fetch({ token: "tok" }, fakeFetch(jsonResponse(body)));

    expect(usage.windows[0].status).toBe("rate-limited");
  });

  test("converts the UNIX-seconds reset_at to an ISO timestamp", async () => {
    const usage = await fetch({ token: "tok" }, fakeFetch(jsonResponse(usageBody())));

    expect(usage.windows[0].resetsAt).toBe("2026-05-28T20:26:40.000Z");
  });

  test("throws on a non-2xx response", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ error: "unauthorized" }, 401));

    await expect(fetch({ token: "tok" }, fetchImpl)).rejects.toThrow(/401/);
  });

  test("throws when the token is missing", async () => {
    const fetchImpl = fakeFetch(jsonResponse(usageBody()));

    await expect(fetch({ token: "" }, fetchImpl)).rejects.toThrow(/missing access token/);
    expect(fetchImpl.calls).toHaveLength(0);
  });
});
