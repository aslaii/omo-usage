import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import * as claude from "./providers/claude.js";
import * as codex from "./providers/codex.js";
import * as commandcode from "./providers/commandcode.js";
import * as opencode from "./providers/opencode.js";

// Placed below the imports on purpose: tsc 7 mis-parses a JSDoc @import that
// directly precedes a relative-path import statement.
/** @import {FetchLike, ProviderUsage} from "./types.js" */

/**
 * @typedef {{ token: string, accountId?: string }} Creds
 */

const AUTH_PATH = join(homedir(), ".omo", "agent", "auth.json");
const OMP_DB_PATH = join(homedir(), ".omp", "agent", "agent.db");

/**
 * @param {Record<string, any>} auth
 * @param {string[]} keys Tried in order; the first key carrying a token wins.
 * @param {(entry: Record<string, any>) => string | undefined} pick
 * @returns {Creds | null}
 */
function fromAuth(auth, keys, pick) {
  for (const key of keys) {
    const entry = auth[key];
    if (!entry || typeof entry !== "object") continue;
    const token = pick(entry);
    if (!token) continue;
    return entry.accountId ? { token, accountId: entry.accountId } : { token };
  }
  return null;
}

const SENTINEL_TOKEN = "claude-sdk-oauth-managed";

/**
 * The top-level anthropic-subscription fields are sentinel-invariant, so its only
 * OAuth material is the stored accounts; that store is empty until a slash command
 * adds one, and the legacy sk-ant-oat01 token lives in omp's SQLite credential
 * store instead.
 * @returns {Creds}
 */
function claudeCreds() {
  const db = new Database(OMP_DB_PATH, { readonly: true });
  try {
    /** @type {{ data?: string } | undefined} */
    const row = db
      .query(
        "select data from auth_credentials where provider = ? and credential_type = ? limit 1",
      )
      .get("anthropic", "oauth");
    if (!row || typeof row.data !== "string") {
      throw new Error("claude: agent.db holds no anthropic oauth credential");
    }
    const data = JSON.parse(row.data);
    if (typeof data.access !== "string" || !data.access) {
      throw new Error("claude: stored oauth credential carries no access token");
    }
    return data.accountId ? { token: data.access, accountId: data.accountId } : { token: data.access };
  } finally {
    db.close();
  }
}

/**
 * One provider failing must never blank the other three, so every adapter call
 * settles on its own and its rejection becomes the reason the renderer prints.
 * The credential producer is deferred into the same try so a throwing reader
 * stays one isolated row.
 * @param {{ id: string, fetch: (creds: Creds, fetchImpl: FetchLike) => Promise<ProviderUsage> }} provider
 * @param {() => Creds | null} produce
 * @param {FetchLike} fetchImpl
 * @returns {Promise<ProviderUsage>}
 */
async function run(provider, produce, fetchImpl) {
  try {
    const creds = produce();
    if (!creds) throw new Error(`${provider.id}: no credential available`);
    return await provider.fetch(creds, fetchImpl);
  } catch (error) {
    return {
      id: /** @type {ProviderUsage["id"]} */ (provider.id),
      account: null,
      windows: [],
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * A stored slot's row keeps its slot name in both the healthy and the unavailable
 * case, so a failed slot stays distinguishable from the account it could not read.
 * @param {{ id: string, fetch: (creds: Creds, fetchImpl: FetchLike) => Promise<ProviderUsage> }} provider
 * @param {{ name: string | null, produce: () => Creds | null }} slot
 * @param {FetchLike} fetchImpl
 * @returns {Promise<ProviderUsage>}
 */
async function runSlot(provider, slot, fetchImpl) {
  const usage = await run(provider, slot.produce, fetchImpl);
  return slot.name === null ? usage : { ...usage, account: slot.name };
}

/**
 * @param {FetchLike} [fetchImpl]
 * @param {AbortSignal} [signal]
 * @returns {Promise<ProviderUsage[]>} One entry per stored account slot for
 * codex, then one per stored claude slot, then one each for commandcode and
 * opencode-go, in that order.
 */
export async function collect(fetchImpl = globalThis.fetch, signal = AbortSignal.timeout(10000)) {
  /** @type {Record<string, any>} */
  let auth = {};
  /** @type {Error | null} */
  let authError = null;
  try {
    auth = JSON.parse(await readFile(AUTH_PATH, "utf8"));
  } catch (error) {
    // An absent store means three providers have no credential, not a crash;
    // run() turns this into the reason each of those rows reports.
    authError = error instanceof Error ? error : new Error(String(error));
  }

  /**
   * @param {(auth: Record<string, any>) => Creds | null} read
   * @returns {() => Creds | null}
   */
  const fromStore = (read) => () => {
    if (authError) throw authError;
    return read(auth);
  };

  /** @type {FetchLike} */
  const boundedFetch = (url, init) => fetchImpl(url, { ...init, signal });

  const gptEntry = auth["chatgpt-subscription"];
  /** @type {any[]} */
  const gptPool = gptEntry && Array.isArray(gptEntry.accounts) ? gptEntry.accounts : [];
  /** @type {{ name: string | null, produce: () => Creds | null }[]} */
  let gptSlots;
  if (authError) {
    gptSlots = [{ name: null, produce: fromStore(() => null) }];
  } else if (gptPool.length === 0) {
    gptSlots = [{
      name: null,
      produce: fromStore((a) => fromAuth(a, ["chatgpt-subscription"], (e) => e.access)),
    }];
  } else {
    // The flat access projects one pool slot; another slot never inherits its accountId.
    gptSlots = gptPool
      .filter((slot) => slot && typeof slot === "object")
      .map((slot) => ({
        name: typeof slot.name === "string" && slot.name ? slot.name : "unnamed",
        produce: () => {
          const token = typeof slot.access === "string" ? slot.access : "";
          return slot.accountId ? { token, accountId: slot.accountId } : { token };
        },
      }));
  }

  const claudeEntry = auth["anthropic-subscription"];
  /** @type {any[]} */
  const claudePool = claudeEntry && Array.isArray(claudeEntry.accounts) ? claudeEntry.accounts : [];
  const realClaude = claudePool.filter(
    (slot) => slot && typeof slot === "object" &&
      !(slot.access === SENTINEL_TOKEN && slot.refresh === SENTINEL_TOKEN),
  );
  // OMP is a fallback only when no non-managed OmO slot exists.
  const claudeSlots = realClaude.length === 0
    ? [{ name: null, produce: claudeCreds }]
    : realClaude.map((slot) => ({
      name: typeof slot.name === "string" && slot.name ? slot.name : "unnamed",
      produce: () => ({
        token:
          typeof slot.access === "string" && slot.access !== SENTINEL_TOKEN ? slot.access : "",
      }),
    }));

  const [codexRows, claudeRows, commandcodeRow, opencodeRow] = await Promise.all([
    Promise.all(gptSlots.map((slot) => runSlot(codex, slot, boundedFetch))),
    Promise.all(claudeSlots.map((slot) => runSlot(claude, slot, boundedFetch))),
    // The CommandCode CLI writes `command-code` with an api_key entry while the
    // plugin writes `commandcode` with an OAuth session, so both spellings and
    // both token fields have to be accepted.
    run(
      commandcode,
      fromStore((a) => fromAuth(a, ["command-code", "commandcode"], (e) => e.key ?? e.access)),
      boundedFetch,
    ),
    run(opencode, fromStore((a) => fromAuth(a, ["opencode-go"], (e) => e.key)), boundedFetch),
  ]);

  return [...codexRows, ...claudeRows, commandcodeRow, opencodeRow];
}
