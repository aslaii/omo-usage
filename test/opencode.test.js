import { describe, expect, test } from "bun:test";
import { fetch as fetchUsage, id, label } from "../src/providers/opencode.js";

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

const USAGE_BODY = {
  usage: {
    rolling: { status: "ok", percent: 42, resetsAt: "2026-09-27T00:00:00.000Z" },
    weekly: { status: "ok", percent: 17, resetsAt: "2026-10-01T00:00:00.000Z" },
    monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-10-01T00:00:00.000Z" },
  },
};

/** @param {{status?: number, body: unknown}} response */
function fakeFetch(response) {
  /** @type {{url: string, headers: Record<string, string> | undefined}[]} */
  const calls = [];
  /** @param {RequestInfo | URL} url @param {RequestInit} [init] */
  const impl = async (url, init) => {
    const headers = init?.headers ? Object.fromEntries(new Headers(init.headers)) : undefined;
    calls.push({ url: String(url), headers });
    const { status = 200, body } = response;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  impl.calls = calls;
  return impl;
}

describe("opencode-go", () => {
  test("identifies itself", () => {
    expect(id).toBe("opencode-go");
    expect(label()).toBe("OpenCode Zen Go");
  });

  test("maps the three provider windows", async () => {
    const fetchImpl = fakeFetch({ body: USAGE_BODY });
    const usage = await fetchUsage({ token: "zen-key" }, fetchImpl);
    expect(usage.id).toBe("opencode-go");
    expect(usage.account).toBeNull();
    expect(usage.windows).toEqual([
      { label: "rolling", percent: 42, resetsAt: "2026-09-27T00:00:00.000Z", status: "ok" },
      { label: "weekly", percent: 17, resetsAt: "2026-10-01T00:00:00.000Z", status: "ok" },
      {
        label: "monthly",
        percent: 100,
        resetsAt: "2026-10-01T00:00:00.000Z",
        status: "rate-limited",
      },
    ]);
  });

  test("calls the go usage endpoint with a browser user agent", async () => {
    const fetchImpl = fakeFetch({ body: USAGE_BODY });
    await fetchUsage({ token: "zen-key" }, fetchImpl);
    expect(fetchImpl.calls).toHaveLength(1);
    const [call] = fetchImpl.calls;
    expect(call.url).toBe(USAGE_URL);
    expect(call.headers?.authorization).toBe("Bearer zen-key");
    expect(call.headers?.accept).toBe("application/json");
    expect(call.headers?.["user-agent"]).toContain("Mozilla/5.0");
  });

  test("throws when the response is not successful", async () => {
    const fetchImpl = fakeFetch({ status: 403, body: { error: "forbidden" } });
    await expect(fetchUsage({ token: "zen-key" }, fetchImpl)).rejects.toThrow(/403/);
  });

  test("throws when the token is missing", async () => {
    const fetchImpl = fakeFetch({ body: USAGE_BODY });
    await expect(fetchUsage({ token: "" }, fetchImpl)).rejects.toThrow(/missing API token/);
  });
});
