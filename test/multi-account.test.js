import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BROKEN,
  BROKEN_TWO,
  CLAUDE_HOME,
  CLAUDE_WORK,
  EMPTY,
  FLAT_ACCESS,
  NAMELESS,
  PERSONAL,
  SENTINEL,
  WORK,
  claudeBody,
  codexBody,
  codexRows,
  collectWith,
} from "./harness.js";

describe("multi-account collect", () => {
  test("emits one row per stored slot, each spending its own token", () => {
    const { usages, seen } = collectWith(
      {
        "chatgpt-subscription": {
          type: "oauth",
          access: FLAT_ACCESS,
          accountId: "acct-flat",
          accounts: [WORK, PERSONAL],
        },
      },
      {
        "fixture-work-token": { label: "work", body: codexBody("work@example.com", "pro", 12) },
        "fixture-personal-token": {
          label: "personal",
          body: codexBody("personal@example.com", "plus", 88),
        },
      },
    );

    expect(usages.map((usage) => usage.id)).toEqual([
      "codex",
      "codex",
      "claude",
      "commandcode",
      "opencode-go",
    ]);
    const rows = codexRows(usages);
    expect(rows.map((row) => row.account)).toEqual(["work", "personal"]);
    expect(rows.map((row) => row.windows[0]?.percent)).toEqual([12, 88]);
    // The pool outranks the flat projection, and the slot with no accountId of
    // its own must not inherit the top-level id that belongs to its sibling.
    expect(seen).toEqual([
      { slot: "work", accountId: "acct-work" },
      { slot: "personal", accountId: null },
    ]);
  });

  test("keeps a failed slot's name while its siblings still report", () => {
    const { usages, seen } = collectWith(
      {
        "chatgpt-subscription": {
          type: "oauth",
          access: FLAT_ACCESS,
          accountId: "acct-flat",
          accounts: [WORK, BROKEN, EMPTY, NAMELESS],
        },
      },
      {
        "fixture-work-token": { label: "work", body: codexBody("work@example.com", "pro", 5) },
        "fixture-nameless-token": {
          label: "nameless",
          body: codexBody("noname@example.com", "plus", 40),
        },
        "fixture-broken-token": {
          label: "broken",
          error: "codex: slot broken rejected its token",
        },
      },
    );

    const rows = codexRows(usages);
    expect(rows.map((row) => row.account)).toEqual(["work", "broken", "empty", "unnamed"]);
    expect(rows.map((row) => row.windows.length)).toEqual([1, 0, 0, 1]);
    expect(rows[0]?.windows[0]?.percent).toBe(5);
    expect(rows[1]?.note).toBe("codex: slot broken rejected its token");
    expect(rows[2]?.note).toBe("codex: missing access token");
    expect(rows[3]?.windows[0]?.percent).toBe(40);
    // The rejected slot still spent its own token and borrowed no header; the
    // slot with no access never reached the network at all.
    expect(seen).toEqual([
      { slot: "work", accountId: "acct-work" },
      { slot: "broken", accountId: null },
      { slot: "nameless", accountId: null },
    ]);
  });

  test("keeps two failing slots distinguishable when the whole pool rejects", () => {
    const { usages, seen } = collectWith(
      {
        "chatgpt-subscription": { type: "oauth", access: FLAT_ACCESS, accounts: [BROKEN, BROKEN_TWO] },
      },
      {
        "fixture-broken-token": { label: "broken", error: "codex: slot broken rejected its token" },
        "fixture-broken2-token": {
          label: "broken-2",
          error: "codex: slot broken-2 rejected its token",
        },
      },
    );

    const rows = codexRows(usages);
    expect(rows.map((row) => row.account)).toEqual(["broken", "broken-2"]);
    expect(rows.map((row) => row.windows)).toEqual([[], []]);
    expect(rows.map((row) => row.note)).toEqual([
      "codex: slot broken rejected its token",
      "codex: slot broken-2 rejected its token",
    ]);
    expect(seen.map((entry) => entry.slot)).toEqual(["broken", "broken-2"]);
  });

  test("falls back to the single flat credential when no pool is stored", () => {
    /** @type {Record<string, unknown>[]} */
    const credentials = [
      { type: "oauth", access: FLAT_ACCESS, accountId: "acct-flat", email: "flat@example.com" },
      {
        type: "oauth",
        access: FLAT_ACCESS,
        accountId: "acct-flat",
        email: "flat@example.com",
        accounts: [],
      },
    ];

    for (const credential of credentials) {
      const { usages, seen } = collectWith(
        { "chatgpt-subscription": credential },
        { [FLAT_ACCESS]: { label: "flat", body: codexBody("flat@example.com", "pro", 30) } },
      );

      expect(usages.map((usage) => usage.id)).toEqual([
        "codex",
        "claude",
        "commandcode",
        "opencode-go",
      ]);
      const [row] = codexRows(usages);
      expect(row?.account).toBe("flat@example.com");
      expect(row?.windows.map((window) => window.percent)).toEqual([30]);
      expect(seen).toEqual([{ slot: "flat", accountId: "acct-flat" }]);
    }
  });

  test("renders two GPT and two Claude slots through the registered command", () => {
    const home = mkdtempSync(join(tmpdir(), "omo-usage-handler-"));
    try {
      const dir = join(home, ".omo", "agent");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "auth.json"), JSON.stringify({
        "chatgpt-subscription": { access: FLAT_ACCESS, accounts: [WORK, PERSONAL] },
        "anthropic-subscription": {
          ...SENTINEL,
          accounts: [CLAUDE_WORK, CLAUDE_HOME],
        },
      }));
      const responses = {
        [WORK.access]: { name: "work", host: "chatgpt.com", body: codexBody("work@example.test", "pro", 12) },
        [PERSONAL.access]: {
          name: "personal", host: "chatgpt.com", body: codexBody("personal@example.test", "plus", 88),
        },
        [String(CLAUDE_WORK.access)]: { name: "claude-work", host: "api.anthropic.com", body: claudeBody(21, 62) },
        [String(CLAUDE_HOME.access)]: { name: "claude-home", host: "api.anthropic.com", body: claudeBody(4, 9) },
      };
      const script = `
const activate = (await import(${JSON.stringify(new URL("../index.js", import.meta.url).href)})).default;
const responses = ${JSON.stringify(responses)};
const calls = [];
globalThis.fetch = async (url, init) => {
  const token = init.headers.authorization.replace("Bearer ", "");
  const entry = responses[token];
  if (!entry || !url.includes(entry.host)) throw new Error("unexpected credential or endpoint");
  calls.push(entry.name);
  return new Response(JSON.stringify(entry.body), { status: 200 });
};
let handler;
activate({ registerCommand(name, command) {
  if (name !== "omo-usage") throw new Error("wrong command");
  handler = command.handler;
} });
const notifications = [];
await handler("", { ui: { notify(message) { notifications.push(message); } } });
console.log(JSON.stringify({ output: notifications.at(-1), calls }));
`;
      const child = Bun.spawnSync({
        cmd: [process.execPath, "-e", script],
        env: { ...process.env, HOME: home },
      });
      if (child.exitCode !== 0) throw new Error(child.stderr.toString());
      const { output, calls } = JSON.parse(child.stdout.toString());
      if (process.env.OMO_USAGE_CAPTURE_FIXTURE === "1") console.log(output);
      expect(calls.sort()).toEqual(["work", "personal", "claude-work", "claude-home"].sort());
      /** @type {string[]} */
      const blocks = output.split("\n\n");
      expect(blocks.slice(0, 4).map((block) => block.split("\n")[0])).toEqual([
        "Codex (ChatGPT) (work)  pro",
        "Codex (ChatGPT) (personal)  plus",
        "Claude (claude-work)",
        "Claude (claude-home)",
      ]);
      expect(blocks[0]).toContain("88% left");
      expect(blocks[1]).toContain("12% left");
      expect(blocks[2]).toContain("79% left");
      expect(blocks[3]).toContain("96% left");
      expect(blocks[4]).toStartWith("Command Code: unavailable");
      expect(blocks[5]).toStartWith("OpenCode Zen Go: unavailable");
      expect(output).not.toContain("fixture-");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
