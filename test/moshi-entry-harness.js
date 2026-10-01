import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = new URL("../index.js", import.meta.url).href;
const PROBE = new URL("../probe.mjs", import.meta.url).pathname;
const API = "https://moshi.fixture.test/api/v1";

/** @import {MoshiSnapshot} from "../src/types.js" */

/**
 * @typedef {object} EntryResult
 * @property {{message: string, type?: string}[]} notifications
 * @property {string[]} requests
 * @property {{snapshots: MoshiSnapshot[]}[]} posts
 * @property {number} activationRequests
 * @property {number} activationTimers
 * @property {boolean} deadlineAborted
 * @property {boolean} shutdownRegistered
 */

/**
 * @param {string[]} commands
 * @param {boolean} [paired]
 * @param {boolean} [parallel]
 * @param {boolean} [expire]
 * @returns {EntryResult}
 */
export function runEntry(commands, paired = true, parallel = false, expire = false) {
  const home = mkdtempSync(join(tmpdir(), "omo-usage-moshi-entry-"));
  const auth = join(home, ".omo", "agent");
  const pairing = join(home, ".config", "moshi");
  mkdirSync(auth, { recursive: true });
  mkdirSync(pairing, { recursive: true });
  writeFileSync(join(auth, "auth.json"), JSON.stringify({
    "chatgpt-subscription": {
      accounts: [
        { name: "work", access: "fixture-work-token" },
        { name: "home", access: "fixture-home-token" },
      ],
    },
    "anthropic-subscription": {
      accounts: [{ name: "default", access: "fixture-claude-token" }],
    },
    "opencode-go": { key: "fixture-opencode-key" },
  }));
  if (paired) {
    writeFileSync(join(pairing, "host.json"), JSON.stringify({
      hostId: "fixture-host", displayName: "fixture-machine",
    }));
    writeFileSync(join(pairing, "config.json"), JSON.stringify({ secretStore: "file" }));
    writeFileSync(join(pairing, "secrets.json"), JSON.stringify({ "host-secret": "fixture-host-secret" }));
  }
  const script = `
const notifications = [];
const requests = [];
const posts = [];
let timerStarts = 0;
let deadlineAborted = false;
const deadlines = new Map();
const nativeSet = globalThis.setTimeout;
const nativeClear = globalThis.clearTimeout;
globalThis.setTimeout = (callback, delay, ...args) => {
  timerStarts += 1;
  if (${expire} && delay === 15000) {
    const handle = nativeSet(() => {}, 0);
    nativeClear(handle);
    deadlines.set(handle, () => callback(...args));
    return handle;
  }
  return nativeSet(callback, delay, ...args);
};
globalThis.clearTimeout = (handle) => { deadlines.delete(handle); nativeClear(handle); };
globalThis.fetch = async (url, init) => {
  init.signal?.throwIfAborted();
  requests.push(url);
  if (url.startsWith(${JSON.stringify(API)})) {
    const payload = JSON.parse(init.body);
    posts.push(payload);
    if (init.headers.authorization !== "Bearer fixture-host-secret") throw new Error("wrong host secret");
    return Response.json({ success: true, count: payload.snapshots.length });
  }
  if (notifications.length === 0) throw new Error("provider request preceded progress feedback");
  if (url.includes("chatgpt.com")) {
    if (${expire}) {
      const stalled = new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          deadlineAborted = true;
          reject(init.signal.reason);
        }, { once: true });
      });
      queueMicrotask(() => { for (const callback of deadlines.values()) callback(); });
      return stalled;
    }
    const token = init.headers.authorization;
    const account = token.includes("work") ? "fixture-account-work" : "fixture-account-home";
    return Response.json({ account_id: account, email: "fixture@example.test", plan_type: "fixture",
      rate_limit: { limit_reached: false, primary_window: { used_percent: 12, reset_at: 1780000000 } } });
  }
  if (url.includes("api.anthropic.com")) return Response.json({
    five_hour: { utilization: 21, resets_at: "2026-10-01T17:00:00.000Z" },
    seven_day: { utilization: 62, resets_at: "2026-10-08T00:00:00.000Z" },
  });
  if (url.includes("opencode.ai")) return Response.json({ usage: {
    rolling: { percent: 3, status: "ok", resetsAt: null },
    weekly: { percent: 11, status: "ok", resetsAt: null },
    monthly: { percent: 41, status: "ok", resetsAt: null },
  } });
  throw new Error("unstubbed endpoint: " + url);
};
const activate = (await import(${JSON.stringify(ENTRY)})).default;
const callbacks = new Map();
let handler;
activate({ on(name, callback) { callbacks.set(name, callback); },
  registerCommand(name, command) { if (name !== "omo-usage") throw new Error("wrong command"); handler = command.handler; } });
const activationRequests = requests.length;
const activationTimers = timerStarts;
const context = { ui: { notify(message, type) { notifications.push({ message, type }); } } };
const commands = ${JSON.stringify(commands)};
try {
  if (${parallel}) await Promise.all(commands.map(command => handler(command, context)));
  else for (const command of commands) await handler(command, context);
} finally {
  await callbacks.get("session_shutdown")();
}
console.log(JSON.stringify({ notifications, requests, posts, activationRequests, activationTimers, deadlineAborted,
  shutdownRegistered: callbacks.has("session_shutdown") }));
`;
  try {
    const child = Bun.spawnSync({
      cmd: [process.execPath, "-e", script],
      timeout: 5000,
      env: {
        ...process.env, HOME: home, MOSHI_CONFIG_DIR: pairing, MOSHI_STATE_DIR: "",
        MOSHI_HOOK_CONFIG_DIR: "", MOSHI_API_BASE: API, XDG_CONFIG_HOME: "", XDG_STATE_HOME: "",
      },
    });
    if (child.exitCode !== 0) throw new Error(child.stderr.toString());
    return JSON.parse(child.stdout.toString());
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** @param {string[]} args */
export function runEmptyProbe(args) {
  const home = mkdtempSync(join(tmpdir(), "omo-usage-moshi-probe-"));
  try {
    const child = Bun.spawnSync({
      cmd: [process.execPath, PROBE, ...args],
      env: {
        ...process.env, HOME: home, MOSHI_CONFIG_DIR: join(home, "moshi"), MOSHI_STATE_DIR: "",
        MOSHI_HOOK_CONFIG_DIR: "", MOSHI_API_BASE: "", XDG_CONFIG_HOME: "", XDG_STATE_HOME: "",
      },
    });
    return { code: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
