import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collect } from "../src/credentials.js";

/** @import {ProviderUsage} from "../src/types.js" */

const RESET_AT_SECONDS = 1780000000;

/** @type {Record<string, unknown>} */
const BODIES = {
  "https://api.anthropic.com/api/oauth/usage": {
    five_hour: {
      utilization: 42,
      resets_at: "2026-05-28T04:26:40.000Z",
      locked_reason: /** @type {string | null} */ (null),
    },
    seven_day: { utilization: 68, resets_at: "2026-05-31T00:00:00.000Z" },
  },
  "https://api.commandcode.ai/alpha/whoami": {
    user: { userName: "vince", email: "vince@example.com" },
    org: { id: "org_9" },
  },
  "https://api.commandcode.ai/alpha/billing/credits?orgId=org_9": {
    credits: { monthlyCredits: 10, purchasedCredits: 5, freeCredits: 1 },
    windowLimits: {
      fiveHour: { used: 1, cap: 4, exceeded: false, resetAt: RESET_AT_SECONDS },
      weekly: { used: 3, cap: 12, exceeded: false, resetAt: RESET_AT_SECONDS },
    },
  },
  "https://api.commandcode.ai/alpha/billing/subscriptions?orgId=org_9": {
    data: { planId: "go", status: "active" },
  },
  "https://opencode.ai/zen/go/v1/usage": {
    usage: {
      rolling: { status: "ok", percent: 42, resetsAt: "2026-09-27T00:00:00.000Z" },
      weekly: { status: "ok", percent: 17, resetsAt: "2026-10-01T00:00:00.000Z" },
      monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-10-01T00:00:00.000Z" },
    },
  },
};

const CODEX_DOWN =
  "codex: usage request failed because chatgpt.com is unreachable from this test";

/** @param {string} url */
function fetchImpl(url) {
  if (url.includes("chatgpt.com")) throw new Error(CODEX_DOWN);
  const body = BODIES[url];
  if (body === undefined) throw new Error(`unexpected request: ${url}`);
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// os.homedir() is answered from the HOME the process started with, so an
// in-process process.env.HOME rewrite leaves the already-cached module reading
// the real store. A child started with HOME pointing at an empty directory is
// the only way to make the module-load-time paths land somewhere credential-free.
const CHILD = `
const { collect } = await import(${JSON.stringify(new URL("../src/credentials.js", import.meta.url).href)});
const usages = await collect(() => { throw new Error("the empty-store test forbids network"); });
console.log(JSON.stringify(usages));
`;

/**
 * @param {string} home Home directory the child process starts with.
 * @returns {ProviderUsage[]}
 */
function collectUnderEmptyHome(home) {
  const child = Bun.spawnSync({
    cmd: [process.execPath, "-e", CHILD],
    env: { ...process.env, HOME: home },
  });
  if (child.exitCode !== 0) {
    throw new Error(`child collect failed: ${child.stderr.toString()}`);
  }
  return JSON.parse(child.stdout.toString());
}

describe("collect", () => {
  test("keeps the other three providers reporting when the codex request throws", async () => {
    const usages = await collect(fetchImpl);

    expect(usages.map((usage) => usage.id)).toEqual([
      "codex",
      "claude",
      "commandcode",
      "opencode-go",
    ]);

    const [codex, claude, commandcode, opencode] = usages;
    expect(codex.windows).toEqual([]);
    expect(codex.account).toBeNull();
    expect(codex.note).toBe(CODEX_DOWN);

    expect(claude.windows.map((window) => window.label)).toEqual(["5h", "weekly"]);
    expect(claude.windows.map((window) => window.percent)).toEqual([42, 68]);

    expect(commandcode.windows.map((window) => window.label)).toEqual(["5h", "weekly"]);
    expect(commandcode.windows.map((window) => window.percent)).toEqual([25, 25]);
    expect(commandcode.account).toBe("vince");

    expect(opencode.windows.map((window) => window.label)).toEqual([
      "rolling",
      "weekly",
      "monthly",
    ]);
    expect(opencode.windows.map((window) => window.percent)).toEqual([42, 17, 100]);
    expect(opencode.windows[2]?.status).toBe("rate-limited");
  });

  test("reports every provider as unavailable when the credential store is empty", () => {
    const home = mkdtempSync(join(tmpdir(), "omo-usage-home-"));
    try {
      const usages = collectUnderEmptyHome(home);

      expect(usages.map((usage) => usage.id)).toEqual([
        "codex",
        "claude",
        "commandcode",
        "opencode-go",
      ]);
      for (const usage of usages) {
        expect(usage.windows).toEqual([]);
        expect(usage.account).toBeNull();
        expect(usage.note).toBeString();
        expect(usage.note?.length ?? 0).toBeGreaterThan(0);
      }
      // The reason must name the absent store. A note about the blocked fetch
      // would mean a real credential was still on disk and this proved nothing.
      expect(usages[0]?.note).toContain(".omo/agent/auth.json");
      expect(usages[1]?.note).toMatch(/database/i);
      expect(usages[2]?.note).toContain(".omo/agent/auth.json");
      expect(usages[3]?.note).toContain(".omo/agent/auth.json");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
