import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODULE = new URL("../src/moshi.js", import.meta.url).href;
export const HOST_ID = "fixture-host-id";
export const DISPLAY = "fixture-host-name";
export const SECRET = "fixture-host-secret-value";
export const TOKEN = "fixture-pairing-token-value";
export const KEYCHAIN_ARGS = "find-generic-password -s app.getmoshi.hook -a host-secret -w";
export const CANCELLED = "moshi: the login keychain read was cancelled";

/**
 * Pairing is read in a child process with its own HOME, PATH, platform, and
 * Moshi environment, so the real config dir, state dir, and login keychain are
 * never in reach and module-load order cannot decide what the reader sees.
 */
const CHILD = `
import { readFile } from "node:fs/promises";

const platform = process.env.MOSHI_PAIRING_FIXTURE_PLATFORM;
if (platform) Object.defineProperty(process, "platform", { value: platform });

const { readMoshiPairing } = await import(${JSON.stringify(MODULE)});
const controller = new AbortController();
const abort = process.env.MOSHI_PAIRING_FIXTURE_ABORT;
if (abort === "before") controller.abort();
const pending = readMoshiPairing(controller.signal);
if (abort === "during") {
  await readFile(process.env.MOSHI_PAIRING_FIXTURE_FIFO, "utf8");
  controller.abort();
}
try {
  const pairing = await pending;
  console.log(JSON.stringify({ ok: true, pairing }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
}
`;

/** @type {string[]} */
const roots = [];

/**
 * Each test file registers this itself: a hook declared in an imported module
 * is not bound to the file that created the fixture.
 */
export function cleanupFixtures() {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

/**
 * Every fixture installs a `security` shim, so a keychain call is recorded
 * instead of reaching the login keychain, and a file-store read proves the shim
 * was never called. A stalled shim announces itself on a fifo and then execs into
 * the hang, so the killed helper is also the last writer on the reader pipe.
 * @param {{ secret?: string, code?: number, stall?: boolean }} [options]
 */
export function fixture({ secret = SECRET, code = 0, stall = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "omo-usage-moshi-"));
  roots.push(root);
  const home = join(root, "home");
  const config = join(home, ".config", "moshi");
  const state = join(home, "Library", "Application Support", "moshi");
  const bin = join(root, "bin");
  for (const dir of [config, state, bin]) mkdirSync(dir, { recursive: true });
  const fifo = join(root, "security-started");
  const blocked = join(root, "security-blocked");
  if (stall && Bun.spawnSync({ cmd: ["mkfifo", fifo, blocked] }).exitCode !== 0) {
    throw new Error("fixture could not create its rendezvous fifo");
  }
  const shim = join(bin, "security");
  writeFileSync(
    shim,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" > "$MOSHI_PAIRING_FIXTURE_MARKER"`,
      stall ? `printf 'started\\n' > "$MOSHI_PAIRING_FIXTURE_FIFO"\nexec cat "$MOSHI_PAIRING_FIXTURE_BLOCK"\n` : "",
      code === 0 ? `printf '%s\\n' "${secret}"\n` : "",
      `printf 'done\\n' > "$MOSHI_PAIRING_FIXTURE_DONE"`,
      `exit ${code}`,
      "",
    ].join("\n"),
  );
  chmodSync(shim, 0o755);
  return { root, home, config, state, bin, marker: join(root, "args"), done: join(root, "done"), fifo, blocked };
}

/**
 * @param {ReturnType<typeof fixture>} fix
 * @param {Record<string, string>} [env]
 */
export function runPairing(fix, env = {}) {
  const child = Bun.spawnSync({
    cmd: [process.execPath, "-e", CHILD],
    env: {
      ...process.env,
      HOME: fix.home,
      PATH: `${fix.bin}:${process.env.PATH ?? ""}`,
      MOSHI_PAIRING_FIXTURE_MARKER: fix.marker,
      MOSHI_PAIRING_FIXTURE_DONE: fix.done,
      MOSHI_PAIRING_FIXTURE_FIFO: fix.fifo,
      MOSHI_PAIRING_FIXTURE_BLOCK: fix.blocked,
      MOSHI_PAIRING_FIXTURE_ABORT: "",
      MOSHI_PAIRING_FIXTURE_PLATFORM: "",
      MOSHI_API_BASE: "",
      MOSHI_CONFIG_DIR: "",
      MOSHI_HOOK_CONFIG_DIR: "",
      MOSHI_STATE_DIR: "",
      XDG_CONFIG_HOME: "",
      XDG_STATE_HOME: "",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (child.exitCode !== 0) throw new Error(`pairing child failed: ${child.stderr.toString()}`);
  return JSON.parse(child.stdout.toString());
}

/**
 * @param {string} dir
 * @param {string} hostId
 * @param {Record<string, unknown>} [extra]
 */
export function host(dir, hostId = HOST_ID, extra = {}) {
  writeFileSync(join(dir, "host.json"), JSON.stringify({ hostId, displayName: DISPLAY, ...extra }));
}

/** @param {ReturnType<typeof fixture>} fix */
export function keychainCalls(fix) {
  return existsSync(fix.marker) ? readFileSync(fix.marker, "utf8").trim() : null;
}

/** @param {ReturnType<typeof fixture>} fix */
export function helperFinished(fix) {
  return existsSync(fix.done);
}

/** @param {ReturnType<typeof fixture>} fix */
export function listing(fix) {
  return [
    ...readdirSync(fix.config, { recursive: true }),
    ...readdirSync(fix.state, { recursive: true }),
  ].sort();
}
