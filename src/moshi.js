import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Placed below the imports on purpose: tsc 7 mis-parses a JSDoc @import that
// directly precedes a relative-path import statement.
/** @import {FetchLike, MoshiBatch, MoshiPairing, MoshiSnapshot, MoshiWindow, ProviderUsage, Window} from "./types.js" */

const API_BASE = "https://api.getmoshi.app/api/v1";
const KEYCHAIN_SERVICE = "app.getmoshi.hook";
const SECRET_KEY = "host-secret";
const SECRET_FILE = "secrets.json";
const CANCELLED = "moshi: the login keychain read was cancelled";
// A locked or prompting keychain must not outlive the caller's deadline.
const KEYCHAIN_TIMEOUT_MS = 5000;

/** @type {Record<string, { agent: MoshiSnapshot["agent"], prefix: string, fixed?: string } | undefined>} */
const TARGETS = {
  codex: { agent: "codex", prefix: "codex:" },
  claude: { agent: "claude-code", prefix: "claude-code:" },
  "opencode-go": { agent: "opencode", prefix: "opencode-go:", fixed: "default" },
};

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A parse failure can quote the file's own bytes, so neither the body nor the
 * raw error reaches a notice.
 * @param {string} path
 * @param {string} what
 * @returns {Promise<Record<string, unknown> | null>} Null when the file is absent.
 */
async function readJsonFile(path, what) {
  let raw = "";
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = isObject(error) ? error.code : undefined;
    if (code === "ENOENT") return null;
    throw new Error(`moshi: cannot read ${what}`);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`moshi: ${what} is not valid JSON`);
  }
  if (!isObject(parsed)) throw new Error(`moshi: ${what} is not a JSON object`);
  return parsed;
}

/**
 * The native pairing root. MOSHI_STATE_DIR names that same root, so a state-only
 * override has to move host.json with it instead of leaving the real host, and
 * its keychain, in reach.
 * @returns {string}
 */
function configDir() {
  const override = process.env.MOSHI_CONFIG_DIR || process.env.MOSHI_STATE_DIR;
  if (override) return override;
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, "moshi");
  return join(homedir(), ".config", "moshi");
}

/** @returns {string} */
function stateDir() {
  if (process.env.MOSHI_STATE_DIR) return process.env.MOSHI_STATE_DIR;
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "moshi");
  }
  if (process.env.XDG_STATE_HOME) return join(process.env.XDG_STATE_HOME, "moshi");
  return join(homedir(), ".local", "state", "moshi");
}

/**
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
async function keychainSecret(signal) {
  let proc;
  try {
    // The daemon itself spawns a bare `security`, so PATH is the only seam a
    // test needs in order to keep the login keychain untouched.
    proc = Bun.spawn(
      ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", SECRET_KEY, "-w"],
      { signal, timeout: KEYCHAIN_TIMEOUT_MS, stdout: "pipe", stderr: "ignore" },
    );
  } catch {
    // An already-aborted signal throws here instead of killing a process.
    throw new Error(CANCELLED);
  }
  const [code, printed] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  if (signal.aborted) throw new Error(CANCELLED);
  const secret = printed.trim();
  if (code !== 0 || !secret) throw new Error("moshi: the login keychain has no readable host-secret");
  return secret;
}

/**
 * @param {string[]} dirs Config dir first, then the state dir.
 * @returns {Promise<string>}
 */
async function fileSecret(dirs) {
  for (const dir of dirs) {
    const store = await readJsonFile(join(dir, SECRET_FILE), "the Moshi secret store");
    if (!store) continue;
    // pairing-token sits beside it and authorizes pairing, not uploads.
    const secret = text(store[SECRET_KEY]);
    if (!secret) throw new Error("moshi: the Moshi secret store holds no host-secret");
    return secret;
  }
  throw new Error("moshi: no Moshi secret store found; pair with `moshi-hook pair --store file`");
}

/**
 * @param {...(string | undefined)} stored
 * @returns {string}
 */
function resolveBaseUrl(...stored) {
  for (const candidate of [process.env.MOSHI_API_BASE, ...stored]) {
    if (candidate && /^https?:\/\/\S+$/.test(candidate)) return candidate.replace(/\/+$/, "");
  }
  return API_BASE;
}

/**
 * Reads an existing pairing and nothing else. Nothing is created, paired, or
 * refreshed, so an unpaired host reports why instead of configuring itself.
 * @param {AbortSignal} signal
 * @returns {Promise<MoshiPairing>}
 */
export async function readMoshiPairing(signal) {
  const config = configDir();
  const host = await readJsonFile(join(config, "host.json"), "the Moshi host pairing");
  if (!host) throw new Error("moshi: this host is not paired; run `moshi-hook pair`");
  const hostId = text(host.hostId);
  const displayName = text(host.displayName);
  if (!hostId || !displayName) throw new Error("moshi: host.json carries no hostId and displayName");
  const settings = await readJsonFile(join(config, "config.json"), "the Moshi hook config");
  // This host pairs into the login keychain on macOS and into a file store
  // everywhere else, so a missing config.json is not the same answer twice.
  const store = text(settings?.secretStore) ?? (process.platform === "darwin" ? "keychain" : "file");
  if (store !== "keychain" && store !== "file") {
    throw new Error("moshi: the Moshi secret store is neither keychain nor file");
  }
  return {
    baseUrl: resolveBaseUrl(text(settings?.baseUrl), text(host.baseUrl)),
    hostId,
    displayName,
    hostSecret: store === "file" ? await fileSecret([config, stateDir()]) : await keychainSecret(signal),
  };
}

/**
 * @param {Window} window
 * @returns {MoshiWindow | string} The mapped window, or the reason it cannot ship.
 */
function mapWindow(window) {
  // A credit pool expires rather than resets, so its timestamp is not a resetsAt.
  if (window.kind === "credit") return "credit pool expires rather than resets";
  const label = text(window.label);
  if (!label) return "window has no label";
  const percent = window.percent;
  if (percent === null) return "provider reports no cap for this window";
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    return "quota percent is missing or outside 0-100";
  }
  if (window.resetsAt === null || window.resetsAt === undefined) {
    return { label, usedPercentage: percent };
  }
  if (typeof window.resetsAt !== "string" || Number.isNaN(Date.parse(window.resetsAt))) {
    return "reset timestamp is malformed";
  }
  return { label, usedPercentage: percent, resetsAt: window.resetsAt };
}

/**
 * Every omission is a self-contained reason built from the provider id alone:
 * no account label, percent, timestamp, or secret is placed in a reason.
 * @param {ProviderUsage[]} rows
 * @param {string} hostName
 * @param {string} capturedAt
 * @returns {MoshiBatch}
 */
export function mapMoshi(rows, hostName, capturedAt) {
  /** @type {MoshiSnapshot[]} */
  const snapshots = [];
  /** @type {string[]} */
  const omissions = [];
  /** @type {Set<string>} */
  const published = new Set();
  for (const row of rows) {
    const target = TARGETS[row.id];
    if (!target) {
      omissions.push(`${row.id}: omitted (Moshi has no native category; unsupported locally by choice)`);
      continue;
    }
    const local = target.fixed ?? text(row.accountId);
    if (!local) {
      omissions.push(`${row.id}: omitted (no account identity)`);
      continue;
    }
    /** @type {MoshiWindow[]} */
    const windows = [];
    /** @type {string[]} */
    const reasons = [];
    for (const [index, window] of row.windows.entries()) {
      const mapped = mapWindow(window);
      if (typeof mapped === "string") {
        reasons.push(`${row.id}: window ${index + 1} omitted (${mapped})`);
      } else {
        windows.push(mapped);
      }
    }
    if (windows.length === 0) {
      reasons.push(
        `${row.id}: omitted (${row.windows.length === 0 ? "provider unavailable" : "no exportable windows"})`,
      );
      omissions.push(...reasons);
      continue;
    }
    const accountId = `${target.prefix}${local}`;
    if (published.has(accountId)) {
      omissions.push(`${row.id}: omitted (duplicate account identity)`);
      continue;
    }
    published.add(accountId);
    omissions.push(...reasons);
    snapshots.push({
      accountId,
      accountLabel: row.account ?? row.id,
      agent: target.agent,
      hostName,
      capturedAt,
      windows,
    });
  }
  return { snapshots, omissions };
}

/**
 * The secret stays in the Authorization header and the response body never
 * reaches a message, so a server echo cannot leak it into a notice.
 * @param {MoshiPairing} pairing
 * @param {MoshiSnapshot[]} snapshots
 * @param {FetchLike} fetchImpl
 * @param {AbortSignal} signal
 * @returns {Promise<number>} The accepted count, which must equal what was sent.
 */
export async function postMoshiUsage(pairing, snapshots, fetchImpl = globalThis.fetch, signal) {
  if (snapshots.length === 0) throw new Error("moshi: refusing to post an empty snapshot batch");
  const response = await fetchImpl(`${pairing.baseUrl}/hosts/${encodeURIComponent(pairing.hostId)}/usage`, {
    method: "POST",
    headers: { authorization: `Bearer ${pairing.hostSecret}`, "content-type": "application/json" },
    body: JSON.stringify({ snapshots }),
    signal,
  });
  if (!response.ok) throw new Error(`moshi: usage upload rejected with status ${response.status}`);
  const body = await response.json().then(
    (parsed) => parsed,
    () => null,
  );
  if (!isObject(body) || body.success !== true) throw new Error("moshi: usage upload was not accepted");
  const count = body.count;
  // A count is echoed back by the server, so only a real count may be named.
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    throw new Error("moshi: usage upload reported an unusable acceptance count");
  }
  if (count !== snapshots.length) {
    throw new Error(`moshi: usage upload accepted ${count} of ${snapshots.length} snapshots`);
  }
  return snapshots.length;
}
