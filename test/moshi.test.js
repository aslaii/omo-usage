import { afterEach, describe, expect, test } from "bun:test";

import { mapMoshi, postMoshiUsage } from "../src/moshi.js";

/** @import {MoshiPairing, ProviderUsage, Window} from "../src/types.js" */

const HOST = "fixture-host-name";
const CAPTURED_AT = "2026-10-01T12:00:00.000Z";
const PAIRING = {
  baseUrl: "https://api.fixture.test/api/v1",
  hostId: "fixture-host-id",
  displayName: HOST,
  hostSecret: "fixture-host-secret",
};
const LIVE = new AbortController().signal;

/** @param {Partial<ProviderUsage> & { id: ProviderUsage["id"] }} fields @returns {ProviderUsage} */
function row(fields) {
  return { account: null, windows: [], ...fields };
}

/** @param {Partial<Window>} fields @returns {Window} */
function win(fields) {
  return { label: "5h", percent: 10, resetsAt: null, status: "ok", ...fields };
}

const RESET = "2026-10-08T00:00:00.000Z";
const FIVE = [
  row({
    id: "codex",
    account: "fixture-work",
    accountId: "uuid-work",
    windows: [win({ label: "weekly", percent: 42.5, resetsAt: RESET })],
  }),
  row({
    id: "codex",
    account: "fixture-home",
    accountId: "uuid-home",
    windows: [win({ label: "weekly", percent: 0 })],
  }),
  row({
    id: "claude",
    account: "default",
    accountId: "omo:default",
    windows: [
      win({ label: "5h", percent: 12, resetsAt: "2026-10-01T17:00:00.000Z" }),
      win({ label: "credits", percent: 30, resetsAt: "2026-11-01T00:00:00.000Z", kind: "credit" }),
    ],
  }),
  row({
    id: "commandcode",
    account: "fixture-goat",
    windows: [win({ percent: 55, resetsAt: "2026-10-02T00:00:00.000Z" })],
  }),
  row({ id: "opencode-go", windows: [win({ label: "rolling", percent: 100 })] }),
];

/** @type {(() => void)[]} */
const stoppers = [];
afterEach(() => {
  for (const stop of stoppers.splice(0)) stop();
});

/** @param {() => Response | Promise<Response>} handler */
function loopback(handler) {
  /** @type {{ method: string, path: string, auth: string | null, type: string | null, body: unknown }[]} */
  const requests = [];
  /** @type {(() => void)[]} */
  const waiters = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        auth: request.headers.get("authorization"),
        type: request.headers.get("content-type"),
        body: await request.json(),
      });
      for (const waiter of waiters.splice(0)) waiter();
      return handler();
    },
  });
  stoppers.push(() => server.stop(true));
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    requests,
    arrived: () =>
      new Promise((resolve) => {
        waiters.push(() => resolve(undefined));
      }),
  };
}

/** @param {unknown} body @param {number} [status] */
function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** @param {string} baseUrl @returns {MoshiPairing} */
function paired(baseUrl) {
  return { ...PAIRING, baseUrl };
}

describe("mapMoshi", () => {
  test("maps five collected rows into four native snapshots with full identities", () => {
    const batch = mapMoshi(FIVE, HOST, CAPTURED_AT);
    expect(batch.snapshots.map((snapshot) => snapshot.accountId)).toEqual([
      "codex:uuid-work",
      "codex:uuid-home",
      "claude-code:omo:default",
      "opencode-go:default",
    ]);
    expect(batch.snapshots.map((snapshot) => snapshot.agent)).toEqual([
      "codex",
      "codex",
      "claude-code",
      "opencode",
    ]);
    expect(batch.snapshots.map((snapshot) => snapshot.capturedAt)).toEqual(Array(4).fill(CAPTURED_AT));
    expect(batch.snapshots.map((snapshot) => snapshot.hostName)).toEqual(Array(4).fill(HOST));
  });

  test("keeps the consumed percent verbatim and ships a valid quota with no reset", () => {
    const { snapshots } = mapMoshi(FIVE, HOST, CAPTURED_AT);
    expect(snapshots[0].windows).toEqual([
      { label: "weekly", usedPercentage: 42.5, resetsAt: RESET },
    ]);
    expect(snapshots[1].windows).toEqual([{ label: "weekly", usedPercentage: 0 }]);
    expect(snapshots[2].windows).toEqual([
      { label: "5h", usedPercentage: 12, resetsAt: "2026-10-01T17:00:00.000Z" },
    ]);
    expect(snapshots[3].windows).toEqual([{ label: "rolling", usedPercentage: 100 }]);
  });

  test("omits Command Code and credit expiries with explicit reasons", () => {
    const batch = mapMoshi(FIVE, HOST, CAPTURED_AT);
    expect(batch.omissions).toEqual([
      "claude: window 2 omitted (credit pool expires rather than resets)",
      "commandcode: omitted (Moshi has no native category; unsupported locally by choice)",
    ]);
    expect(batch.snapshots.map((snapshot) => snapshot.accountId)).not.toContain("commandcode:default");
  });

  test("reports an unavailable row and a row whose only window has no cap", () => {
    const batch = mapMoshi(
      [
        row({ id: "codex", accountId: "uuid-a", note: "codex: no credential available" }),
        row({ id: "claude", accountId: "omo:default", windows: [win({ percent: null })] }),
      ],
      HOST,
      CAPTURED_AT,
    );
    expect(batch.snapshots).toEqual([]);
    expect(batch.omissions).toEqual([
      "codex: omitted (provider unavailable)",
      "claude: window 1 omitted (provider reports no cap for this window)",
      "claude: omitted (no exportable windows)",
    ]);
  });

  test("omits unlabeled, out-of-range, and malformed-reset windows but keeps the account", () => {
    const batch = mapMoshi(
      [
        row({
          id: "codex",
          accountId: "uuid-a",
          windows: [
            win({ label: "   " }),
            win({ label: "over", percent: 140 }),
            win({ label: "bad reset", resetsAt: "not-a-date" }),
            win({ label: "kept", percent: 7, resetsAt: RESET }),
          ],
        }),
      ],
      HOST,
      CAPTURED_AT,
    );
    expect(batch.snapshots).toHaveLength(1);
    expect(batch.snapshots[0].windows).toEqual([
      { label: "kept", usedPercentage: 7, resetsAt: RESET },
    ]);
    expect(batch.omissions).toEqual([
      "codex: window 1 omitted (window has no label)",
      "codex: window 2 omitted (quota percent is missing or outside 0-100)",
      "codex: window 3 omitted (reset timestamp is malformed)",
    ]);
  });

  test("omits a missing or colliding identity and labels a null account with its provider id", () => {
    const batch = mapMoshi(
      [
        row({ id: "codex", account: "first", accountId: "uuid-a", windows: [win({})] }),
        row({ id: "codex", account: "second", accountId: "uuid-a", windows: [win({})] }),
        row({ id: "claude", accountId: "omo:default", windows: [win({})] }),
        row({ id: "codex", account: "no identity", windows: [win({})] }),
      ],
      HOST,
      CAPTURED_AT,
    );
    expect(batch.snapshots.map((snapshot) => snapshot.accountId)).toEqual([
      "codex:uuid-a",
      "claude-code:omo:default",
    ]);
    expect(batch.snapshots.map((snapshot) => snapshot.accountLabel)).toEqual(["first", "claude"]);
    expect(batch.omissions).toEqual([
      "codex: omitted (duplicate account identity)",
      "codex: omitted (no account identity)",
    ]);
  });
});

describe("postMoshiUsage", () => {
  test("posts one batch to the host usage path with the paired bearer secret", async () => {
    const { snapshots } = mapMoshi(FIVE, HOST, CAPTURED_AT);
    const server = loopback(() => reply({ success: true, count: snapshots.length }));
    const accepted = await postMoshiUsage(paired(server.baseUrl), snapshots, fetch, LIVE);
    expect(accepted).toBe(4);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].method).toBe("POST");
    expect(server.requests[0].path).toBe(`/hosts/${PAIRING.hostId}/usage`);
    expect(server.requests[0].auth).toBe(`Bearer ${PAIRING.hostSecret}`);
    expect(server.requests[0].type).toBe("application/json");
    expect(server.requests[0].body).toEqual({ snapshots });
  });

  test("refuses an empty batch without touching the network", async () => {
    const server = loopback(() => reply({ success: true, count: 0 }));
    await expect(postMoshiUsage(paired(server.baseUrl), [], fetch, LIVE)).rejects.toThrow(
      "empty snapshot batch",
    );
    expect(server.requests).toEqual([]);
  });

  test("rejects a bad status, a refused body, and a count that is not the submitted count", async () => {
    const snapshots = mapMoshi(FIVE, HOST, CAPTURED_AT).snapshots;
    /** @type {[() => Response, string][]} */
    const cases = [
      [() => reply({ success: true, count: 4 }, 422), "rejected with status 422"],
      [() => reply({ success: false, count: 4 }), "was not accepted"],
      [() => new Response("<html>gateway</html>", { status: 200 }), "was not accepted"],
      [() => reply([1, 2, 3]), "was not accepted"],
      [() => reply({ success: true }), "unusable acceptance count"],
      [() => reply({ success: true, count: 1.5 }), "unusable acceptance count"],
      [() => reply({ success: true, count: -1 }), "unusable acceptance count"],
      [() => reply({ success: true, count: 3 }), "accepted 3 of 4"],
    ];
    for (const [handler, expected] of cases) {
      const server = loopback(handler);
      await expect(postMoshiUsage(paired(server.baseUrl), snapshots, fetch, LIVE)).rejects.toThrow(
        expected,
      );
      expect(server.requests).toHaveLength(1);
    }
  });

  test("never echoes a server-supplied count value", async () => {
    const snapshots = mapMoshi(FIVE, HOST, CAPTURED_AT).snapshots;
    const server = loopback(() => reply({ success: true, count: `Bearer ${PAIRING.hostSecret}` }));
    const failure = await postMoshiUsage(paired(server.baseUrl), snapshots, fetch, LIVE).catch(
      (error) => error,
    );
    expect(failure.message).toBe("moshi: usage upload reported an unusable acceptance count");
    expect(failure.message).not.toContain(PAIRING.hostSecret);
  });

  test("aborts an in-flight upload when the caller signal aborts", async () => {
    const snapshots = mapMoshi(FIVE, HOST, CAPTURED_AT).snapshots;
    /** @type {Promise<Response>} */
    const stalled = new Promise(() => {});
    const server = loopback(() => stalled);
    const controller = new AbortController();
    const pending = postMoshiUsage(paired(server.baseUrl), snapshots, fetch, controller.signal);
    await server.arrived();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(server.requests).toHaveLength(1);
  });
});
