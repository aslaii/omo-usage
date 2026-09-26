import { describe, expect, test } from "bun:test";
import { fetch as fetchUsage, id, label } from "../src/providers/commandcode.js";

const WHOAMI_URL = "https://api.commandcode.ai/alpha/whoami";

const WHOAMI_BODY = {
  success: true,
  user: { id: "u_1", name: "Vince L", email: "vince@example.com", userName: "vince" },
  org: { id: "org_9", login: "acme" },
};

const CREDITS_BODY = {
  credits: { monthlyCredits: 40, purchasedCredits: 5, freeCredits: 0 },
  windowLimits: {
    limited: true,
    fiveHour: { used: 30, cap: 120, exceeded: false, resetAt: 1800000000 },
    weekly: { used: 90, cap: 0, exceeded: true, resetAt: 0 },
  },
};

const SUBSCRIPTIONS_BODY = {
  success: true,
  data: {
    planId: "cc-pro-10",
    status: "active",
    currentPeriodStart: 1750000000,
    currentPeriodEnd: 1760000000,
  },
};

/** @param {Record<string, {status?: number, body: unknown}>} responses */
function fakeFetch(responses) {
  /** @type {string[]} */
  const calls = [];
  /** @param {RequestInfo | URL} url */
  const impl = async (url) => {
    calls.push(String(url));
    if (!(String(url) in responses)) {
      throw new Error(`unexpected request: ${url}`);
    }
    const { status = 200, body } = responses[String(url)];
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  impl.calls = calls;
  return impl;
}

/**
 * @param {{user: {userName: string, email: string}, org: {id: string, login: string} | null}} whoami
 * @returns {Record<string, {status?: number, body: unknown}>}
 */
function orgResponses(whoami) {
  const scope = whoami.org ? "?orgId=org_9" : "";
  return {
    [WHOAMI_URL]: { body: whoami },
    [`https://api.commandcode.ai/alpha/billing/credits${scope}`]: { body: CREDITS_BODY },
    [`https://api.commandcode.ai/alpha/billing/subscriptions${scope}`]: { body: SUBSCRIPTIONS_BODY },
  };
}

describe("commandcode", () => {
  test("identifies itself", () => {
    expect(id).toBe("commandcode");
    expect(label()).toBe("Command Code");
  });

  test("maps account, windows, and note", async () => {
    const fetchImpl = fakeFetch(orgResponses(WHOAMI_BODY));
    const usage = await fetchUsage({ token: "cc-key" }, fetchImpl);
    expect(usage.id).toBe("commandcode");
    expect(usage.account).toBe("vince");
    expect(usage.windows).toEqual([
      {
        label: "5h",
        percent: 25,
        resetsAt: "2027-01-15T08:00:00.000Z",
        status: "ok",
      },
      { label: "weekly", percent: null, resetsAt: null, status: "rate-limited" },
    ]);
    expect(usage.note).toBe("cc-pro-10 active, 45 credits left");
  });

  test("reports unused rolling caps before their first reset", async () => {
    const responses = orgResponses(WHOAMI_BODY);
    responses["https://api.commandcode.ai/alpha/billing/credits?orgId=org_9"] = {
      body: {
        ...CREDITS_BODY,
        windowLimits: {
          ...CREDITS_BODY.windowLimits,
          fiveHour: { used: 0, cap: 14, exceeded: false, resetAt: 0 },
          weekly: { used: 0, cap: 35, exceeded: false, resetAt: 0 },
        },
      },
    };

    const usage = await fetchUsage({ token: "cc-key" }, fakeFetch(responses));

    expect(usage.windows.map((window) => window.percent)).toEqual([0, 0]);
  });

  test.each([[0, 100], [7, 90]])("reports GOAT monthly quota from %p included credits", async (remaining, consumed) => {
    const responses = orgResponses({ ...WHOAMI_BODY, org: null });
    responses["https://api.commandcode.ai/alpha/billing/credits"] = {
      body: {
        ...CREDITS_BODY,
        credits: { monthlyCredits: remaining, purchasedCredits: 0.09, freeCredits: 0 },
        windowLimits: {
          ...CREDITS_BODY.windowLimits,
          fiveHour: { used: 0, cap: 14, exceeded: false, resetAt: 0 },
          weekly: { used: 0, cap: 35, exceeded: false, resetAt: 0 },
        },
      },
    };
    responses["https://api.commandcode.ai/alpha/billing/subscriptions"] = {
      body: {
        ...SUBSCRIPTIONS_BODY,
        data: {
          ...SUBSCRIPTIONS_BODY.data,
          planId: "individual-goat",
          currentPeriodEnd: "2026-10-11T06:46:52.000Z",
        },
      },
    };

    const usage = await fetchUsage({ token: "cc-key" }, fakeFetch(responses));

    expect(usage.windows.find((window) => window.label === "monthly included")).toEqual({
      label: "monthly included",
      percent: consumed,
      resetsAt: "2026-10-11T06:46:52.000Z",
      status: "ok",
    });
    expect(usage.windows.slice(0, 2).map((window) => window.percent)).toEqual([0, 0]);
  });

  test("falls back to the account email when no user name exists", async () => {
    const whoami = { ...WHOAMI_BODY, user: { ...WHOAMI_BODY.user, userName: "" } };
    const fetchImpl = fakeFetch(orgResponses(whoami));
    const usage = await fetchUsage({ token: "cc-key" }, fetchImpl);
    expect(usage.account).toBe("vince@example.com");
  });

  test("requests whoami before any billing call", async () => {
    const fetchImpl = fakeFetch(orgResponses(WHOAMI_BODY));
    await fetchUsage({ token: "cc-key" }, fetchImpl);
    expect(fetchImpl.calls[0]).toBe(WHOAMI_URL);
    const billingCalls = fetchImpl.calls.filter((url) => url.includes("/alpha/billing/"));
    expect(billingCalls.length).toBe(2);
    for (const url of billingCalls) {
      expect(fetchImpl.calls.indexOf(url)).toBeGreaterThan(0);
      expect(url).toContain("orgId=org_9");
    }
  });

  test("omits the orgId query param when the account has no org", async () => {
    const fetchImpl = fakeFetch(orgResponses({ ...WHOAMI_BODY, org: null }));
    await fetchUsage({ token: "cc-key" }, fetchImpl);
    expect(fetchImpl.calls).toEqual([
      WHOAMI_URL,
      "https://api.commandcode.ai/alpha/billing/credits",
      "https://api.commandcode.ai/alpha/billing/subscriptions",
    ]);
  });

  test("throws when a request is not successful", async () => {
    const responses = orgResponses(WHOAMI_BODY);
    responses[WHOAMI_URL] = { status: 401, body: { success: false } };
    const fetchImpl = fakeFetch(responses);
    await expect(fetchUsage({ token: "cc-key" }, fetchImpl)).rejects.toThrow(/401/);
  });

  test("throws when the token is missing", async () => {
    const fetchImpl = fakeFetch({});
    await expect(fetchUsage({ token: "" }, fetchImpl)).rejects.toThrow(/missing API token/);
  });
});
