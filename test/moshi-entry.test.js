import { describe, expect, test } from "bun:test";
import { runEmptyProbe, runEntry } from "./moshi-entry-harness.js";

describe("Moshi command entrypoint", () => {
  test("keeps the ordinary table independent of pairing and activation inert", () => {
    const result = runEntry([""], false);
    expect(result.activationRequests).toBe(0);
    expect(result.activationTimers).toBe(0);
    expect(result.shutdownRegistered).toBe(true);
    expect(result.posts).toEqual([]);
    expect(result.notifications).toHaveLength(2);
    expect(result.notifications[1].message).toContain("Codex (ChatGPT) (work)");
    expect(result.notifications[1].message).toContain("Claude (default)");
    expect(result.notifications[1].message).toContain("Command Code: unavailable");
    expect(result.notifications[1].message).toContain("OpenCode Zen Go");
  });

  test("collects each account once and uploads one native batch after progress", () => {
    const result = runEntry(["moshi sync"]);
    expect(result.requests.filter((url) => url.includes("chatgpt.com"))).toHaveLength(2);
    expect(result.requests.filter((url) => url.includes("api.anthropic.com"))).toHaveLength(1);
    expect(result.requests.filter((url) => url.includes("opencode.ai"))).toHaveLength(1);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].snapshots.map((row) => row.accountId)).toEqual([
      "codex:fixture-account-work", "codex:fixture-account-home",
      "claude-code:omo:default", "opencode-go:default",
    ]);
    expect(result.notifications).toHaveLength(2);
    expect(result.notifications[1].message).toContain("commandcode:");
    expect(JSON.stringify(result)).not.toContain("fixture-host-secret");
    expect(JSON.stringify(result)).not.toContain("fixture-work-token");
  });

  test("coalesces simultaneous manual sync calls into one upload", () => {
    const result = runEntry(["moshi sync", "moshi sync"], true, true);
    expect(result.posts).toHaveLength(1);
    expect(result.requests.filter((url) => url.includes("chatgpt.com"))).toHaveLength(2);
  });

  test("the attempt deadline aborts a stalled provider and prevents upload", () => {
    const result = runEntry(["moshi sync"], true, false, true);
    expect(result.deadlineAborted).toBe(true);
    expect(result.posts).toEqual([]);
    expect(result.notifications.at(-1)?.type).toBe("error");
  });

  test("starts and stops an opt-in loop and keeps status local", () => {
    const result = runEntry(["moshi status", "moshi on", "moshi status", "moshi off", "moshi status"]);
    expect(result.activationRequests).toBe(0);
    expect(result.posts).toHaveLength(1);
    expect(result.notifications.at(-1)?.message).toContain("off");
    expect(result.notifications.at(-1)?.message).toContain("Request in flight: no");
  });

  test("reports missing pairing without reading provider endpoints", () => {
    const result = runEntry(["moshi sync"], false);
    expect(result.requests).toEqual([]);
    expect(result.posts).toEqual([]);
    expect(result.notifications.at(-1)?.type).toBe("error");
  });

  test("rejects unknown arguments without network work", () => {
    const result = runEntry(["moshi invalid"]);
    expect(result.requests).toEqual([]);
    expect(result.notifications.at(-1)?.type).toBe("error");
  });
});

describe("standalone probe", () => {
  test("the ordinary probe works with an empty credential store", () => {
    const result = runEmptyProbe([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Codex (ChatGPT): unavailable");
  });

  test("Moshi mode fails explicitly when the host is not paired", () => {
    const result = runEmptyProbe(["--moshi"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not paired");
  });
});
