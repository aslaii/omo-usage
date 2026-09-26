import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

/** @import {ProviderUsage} from "../src/types.js" */

const IMPORT = `const { collect } = await import(${JSON.stringify(new URL("../src/credentials.js", import.meta.url).href)});`;

export const FLAT_ACCESS = "fixture-flat-token";
export const WORK = { name: "work", source: "login", access: "fixture-work-token", accountId: "acct-work" };
export const PERSONAL = { name: "personal", source: "login", access: "fixture-personal-token" };
export const BROKEN = { name: "broken", source: "login", access: "fixture-broken-token" };
export const BROKEN_TWO = { name: "broken-2", source: "login", access: "fixture-broken2-token" };
export const EMPTY = { name: "empty", source: "login" };
export const NAMELESS = { source: "login", access: "fixture-nameless-token" };

export const SENTINEL = {
  access: "claude-sdk-oauth-managed",
  refresh: "claude-sdk-oauth-managed",
  expires: 4102444800000,
};

/**
 * A stored Claude slot as the account command writes it: the token fields derive
 * from the name, so a row is answered by exactly its own slot's credential.
 * @param {string} name
 * @returns {Record<string, unknown>}
 */
function claudeSlot(name) {
  return {
    name,
    source: "login",
    access: `fixture-${name}-token`,
    refresh: `fixture-${name}-refresh`,
    expires: 1790000000000,
  };
}

export const CLAUDE_WORK = claudeSlot("claude-work");
export const CLAUDE_HOME = claudeSlot("claude-home");
export const CLAUDE_BROKEN = claudeSlot("claude-broken");
export const CLAUDE_PLACEHOLDER = { ...claudeSlot("claude-placeholder"), access: SENTINEL.access };
export const CLAUDE_SENTINEL = { ...claudeSlot("login-1"), ...SENTINEL };
export const OMP = { access: "fixture-omp-token" };

/**
 * @param {string} email
 * @param {string} plan
 * @param {number} percent
 * @returns {Record<string, unknown>}
 */
export function codexBody(email, plan, percent) {
  return {
    email,
    plan_type: plan,
    rate_limit: {
      limit_reached: false,
      primary_window: { used_percent: percent, reset_at: 1780000000 },
    },
  };
}

/**
 * @param {number} fiveHour
 * @param {number} weekly
 * @returns {Record<string, unknown>}
 */
export function claudeBody(fiveHour, weekly) {
  return {
    five_hour: { utilization: fiveHour, resets_at: "2026-09-26T22:00:00.000Z" },
    seven_day: { utilization: weekly, resets_at: "2026-10-01T00:00:00.000Z" },
  };
}

/**
 * The fake fetch answers from the bearer token, so a row proves it spent its own
 * slot's credential and any other token throws. The recorded alias, not the
 * token, is what reaches the printed result.
 * @param {Record<string, { label: string, body?: unknown, error?: string }>} plan
 * @returns {string}
 */
function childScript(plan) {
  return `
${IMPORT}
const plan = ${JSON.stringify(plan)};
const seen = [];
const claudeSent = [];
const usages = await collect((url, init) => {
  const bearer = (init.headers.authorization ?? "").replace("Bearer ", "");
  const slot = plan[bearer];
  if (!slot) throw new Error("request carried a token that is in no stored slot");
  if (url.includes("chatgpt.com")) {
    seen.push({ slot: slot.label, accountId: init.headers["chatgpt-account-id"] ?? null });
  } else {
    claudeSent.push(slot.label);
  }
  if (slot.error) throw new Error(slot.error);
  return Promise.resolve(new Response(JSON.stringify(slot.body), { status: 200 }));
});
console.log(JSON.stringify({ usages, seen, claudeSent }));
`;
}

/**
 * @param {Record<string, unknown>} store auth.json contents for the fixture home
 * @param {Record<string, { label: string, body?: unknown, error?: string }>} plan
 * @param {{ access: string } | null} [ompCredential] anthropic oauth row the legacy OMP db holds
 * @returns {{ usages: ProviderUsage[], seen: { slot: string, accountId: string | null }[], claudeSent: string[] }}
 */
export function collectWith(store, plan, ompCredential = null) {
  const home = mkdtempSync(join(tmpdir(), "omo-usage-multi-"));
  try {
    const dir = join(home, ".omo", "agent");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "auth.json"), JSON.stringify(store));
    if (ompCredential) {
      const dbDir = join(home, ".omp", "agent");
      mkdirSync(dbDir, { recursive: true });
      const db = new Database(join(dbDir, "agent.db"));
      try {
        db.query(
          "create table auth_credentials (provider text, credential_type text, data text)",
        ).run();
        db.query("insert into auth_credentials values (?, ?, ?)").run(
          "anthropic",
          "oauth",
          JSON.stringify(ompCredential),
        );
      } finally {
        db.close();
      }
    }
    const child = Bun.spawnSync({
      cmd: [process.execPath, "-e", childScript(plan)],
      env: { ...process.env, HOME: home },
    });
    if (child.exitCode !== 0) {
      throw new Error(`child collect failed: ${child.stderr.toString()}`);
    }
    return JSON.parse(child.stdout.toString());
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** @param {ProviderUsage[]} usages */
export function codexRows(usages) {
  return usages.filter((usage) => usage.id === "codex");
}

/** @param {ProviderUsage[]} usages */
export function claudeRows(usages) {
  return usages.filter((usage) => usage.id === "claude");
}
