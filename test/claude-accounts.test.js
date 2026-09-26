import { describe, expect, test } from "bun:test";

import {
  CLAUDE_BROKEN,
  CLAUDE_HOME,
  CLAUDE_PLACEHOLDER,
  CLAUDE_SENTINEL,
  CLAUDE_WORK,
  OMP,
  SENTINEL,
  claudeBody,
  claudeRows,
  collectWith,
} from "./harness.js";

describe("claude account slots", () => {
  test("reports every real slot in stored order and skips the managed sentinel", () => {
    const { usages, claudeSent } = collectWith(
      {
        "anthropic-subscription": {
          type: "oauth",
          ...SENTINEL,
          accounts: [CLAUDE_WORK, CLAUDE_SENTINEL, CLAUDE_HOME],
        },
      },
      {
        "fixture-claude-work-token": { label: "claude-work", body: claudeBody(21, 62) },
        "fixture-claude-home-token": { label: "claude-home", body: claudeBody(4, 9) },
      },
    );

    expect(usages.map((usage) => usage.id)).toEqual([
      "codex",
      "claude",
      "claude",
      "commandcode",
      "opencode-go",
    ]);
    const rows = claudeRows(usages);
    expect(rows.map((row) => row.account)).toEqual(["claude-work", "claude-home"]);
    expect(rows.map((row) => row.windows.map((window) => window.percent))).toEqual([
      [21, 62],
      [4, 9],
    ]);
    // A sentinel slot holds no OAuth token at all, so it never reaches Anthropic.
    expect(claudeSent).toEqual(["claude-work", "claude-home"]);
  });

  test("reads the OMP credential only while no real slot is stored", () => {
    for (const accounts of [[], [CLAUDE_SENTINEL]]) {
      const { usages, claudeSent } = collectWith(
        { "anthropic-subscription": { type: "oauth", ...SENTINEL, accounts } },
        { "fixture-omp-token": { label: "omp", body: claudeBody(33, 55) } },
        OMP,
      );

      const rows = claudeRows(usages);
      expect(rows.length).toBe(1);
      expect(rows[0]?.account).toBeNull();
      expect(rows[0]?.windows.map((window) => window.percent)).toEqual([33, 55]);
      expect(claudeSent).toEqual(["omp"]);
    }
  });

  test("keeps a failed slot's name while a sibling still reports and spends no fallback", () => {
    const { usages, claudeSent } = collectWith(
      {
        "anthropic-subscription": {
          type: "oauth",
          ...SENTINEL,
          accounts: [CLAUDE_BROKEN, CLAUDE_PLACEHOLDER, CLAUDE_WORK],
        },
      },
      {
        "fixture-claude-work-token": { label: "claude-work", body: claudeBody(11, 22) },
        "fixture-claude-broken-token": {
          label: "claude-broken",
          error: "claude: usage request failed with status 401",
        },
        "fixture-omp-token": { label: "omp", body: claudeBody(99, 99) },
      },
      OMP,
    );

    const rows = claudeRows(usages);
    expect(rows.map((row) => row.account)).toEqual([
      "claude-broken",
      "claude-placeholder",
      "claude-work",
    ]);
    expect(rows.map((row) => row.windows.length)).toEqual([0, 0, 2]);
    expect(rows[0]?.note).toBe("claude: usage request failed with status 401");
    // The placeholder row fails locally, so Anthropic never sees it, and the
    // stored OMP credential adds no row while a real slot exists.
    expect(rows[1]?.note).toBe("claude: missing access token");
    expect(rows[2]?.windows.map((window) => window.percent)).toEqual([11, 22]);
    expect(claudeSent).toEqual(["claude-broken", "claude-work"]);
  });
});
