import { describe, expect, test } from "bun:test";
import { fetch, id, label } from "../src/providers/claude.js";

const FIVE_HOUR_RESET = "2026-05-28T04:26:40.000Z";
const SEVEN_DAY_RESET = "2026-05-31T00:00:00.000Z";

function usageBody() {
  return {
    five_hour: { utilization: 42, resets_at: FIVE_HOUR_RESET, locked_reason: /** @type {string|null} */ (null) },
    seven_day: { utilization: 68, resets_at: /** @type {string|null} */ (SEVEN_DAY_RESET) },
    limits: [],
    seven_day_breakdown: {},
    spend: {},
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

describe("claude", () => {
  test("exposes the provider id and label", () => {
    expect(id).toBe("claude");
    expect(label()).toBe("Claude");
  });

  test("maps five_hour and seven_day to 5h and weekly windows", async () => {
    const usage = await fetch({ token: "tok" }, fakeFetch(jsonResponse(usageBody())));

    expect(usage.id).toBe("claude");
    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]).toEqual({
      label: "5h",
      percent: 42,
      resetsAt: FIVE_HOUR_RESET,
      status: "ok",
    });
    expect(usage.windows[1]).toEqual({
      label: "weekly",
      percent: 68,
      resetsAt: SEVEN_DAY_RESET,
      status: "ok",
    });
  });

  test("reports a null account because the endpoint carries no email", async () => {
    const usage = await fetch({ token: "tok" }, fakeFetch(jsonResponse(usageBody())));

    expect(usage.account).toBeNull();
  });

  test("sends bearer auth, accept and the claude-cli user agent", async () => {
    const fetchImpl = fakeFetch(jsonResponse(usageBody()));
    await fetch({ token: "tok" }, fetchImpl);

    const [{ url, init }] = fetchImpl.calls;
    expect(url).toBe("https://api.anthropic.com/api/oauth/usage");
    expect(init.headers.authorization).toBe("Bearer tok");
    expect(init.headers.accept).toBe("application/json");
    expect(init.headers["user-agent"]).toBe("claude-cli/2.1.0");
  });

  test("marks the window rate-limited when locked_reason is set", async () => {
    const body = usageBody();
    body.five_hour.locked_reason = "weekly_limit_reached";
    const usage = await fetch({ token: "tok" }, fakeFetch(jsonResponse(body)));

    expect(usage.windows[0].status).toBe("rate-limited");
    expect(usage.windows[1].status).toBe("ok");
  });

  test("keeps a null resets_at when the endpoint omits it", async () => {
    const body = usageBody();
    body.seven_day.resets_at = null;
    const usage = await fetch({ token: "tok" }, fakeFetch(jsonResponse(body)));

    expect(usage.windows[1].resetsAt).toBeNull();
  });

  test("throws on a non-2xx response", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ error: "token expired" }, 403));

    await expect(fetch({ token: "tok" }, fetchImpl)).rejects.toThrow(/403/);
  });

  test("throws when the token is missing", async () => {
    const fetchImpl = fakeFetch(jsonResponse(usageBody()));

    await expect(fetch({ token: "" }, fetchImpl)).rejects.toThrow(/missing access token/);
    expect(fetchImpl.calls).toHaveLength(0);
  });
});
