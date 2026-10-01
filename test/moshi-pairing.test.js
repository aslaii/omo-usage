import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DISPLAY,
  HOST_ID,
  KEYCHAIN_ARGS,
  SECRET,
  TOKEN,
  cleanupFixtures,
  fixture,
  host,
  keychainCalls,
  listing,
  runPairing,
} from "./moshi-harness.js";

afterEach(cleanupFixtures);

describe("readMoshiPairing", () => {
  test("reads an existing keychain pairing from the default config path", () => {
    const fix = fixture();
    host(fix.config);
    expect(runPairing(fix)).toEqual({
      ok: true,
      pairing: {
        baseUrl: "https://api.getmoshi.app/api/v1",
        hostId: HOST_ID,
        displayName: DISPLAY,
        hostSecret: SECRET,
      },
    });
    expect(keychainCalls(fix)).toBe(KEYCHAIN_ARGS);
  });


  test("reads a file-store pairing, never the pairing token, and writes nothing", () => {
    const fix = fixture();
    host(fix.config);
    writeFileSync(join(fix.config, "config.json"), JSON.stringify({ secretStore: "file" }));
    writeFileSync(
      join(fix.config, "secrets.json"),
      JSON.stringify({ "host-secret": SECRET, "pairing-token": TOKEN }),
    );
    const before = listing(fix);
    const result = runPairing(fix);
    expect(result.pairing.hostSecret).toBe(SECRET);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(keychainCalls(fix)).toBeNull();
    expect(listing(fix)).toEqual(before);
  });


  test("defaults to a file store off macOS when config.json is absent", () => {
    const fix = fixture();
    host(fix.config, "host-from-file");
    writeFileSync(join(fix.config, "secrets.json"), JSON.stringify({ "host-secret": SECRET }));
    const result = runPairing(fix, { MOSHI_PAIRING_FIXTURE_PLATFORM: "linux" });
    expect(result.pairing.hostSecret).toBe(SECRET);
    expect(result.pairing.hostId).toBe("host-from-file");
    expect(keychainCalls(fix)).toBeNull();
  });


  test("carries the whole pairing root on a state-only override", () => {
    const fix = fixture();
    const alt = join(fix.root, "alt-state");
    mkdirSync(alt, { recursive: true });
    host(fix.config, "host-from-home");
    host(alt, "host-from-state");
    writeFileSync(join(alt, "config.json"), JSON.stringify({ secretStore: "file" }));
    writeFileSync(join(alt, "secrets.json"), JSON.stringify({ "host-secret": SECRET }));
    const result = runPairing(fix, { MOSHI_STATE_DIR: alt });
    expect(result.pairing.hostId).toBe("host-from-state");
    expect(result.pairing.hostSecret).toBe(SECRET);
  });


  test("never falls back to the home config dir on a state-only override", () => {
    const fix = fixture();
    const alt = join(fix.root, "alt-state");
    mkdirSync(alt, { recursive: true });
    host(fix.config);
    writeFileSync(join(fix.config, "config.json"), JSON.stringify({ secretStore: "file" }));
    writeFileSync(join(fix.config, "secrets.json"), JSON.stringify({ "host-secret": SECRET }));
    expect(runPairing(fix, { MOSHI_STATE_DIR: alt })).toEqual({
      ok: false,
      message: "moshi: this host is not paired; run `moshi-hook pair`",
    });
  });


  test("prefers MOSHI_CONFIG_DIR over MOSHI_STATE_DIR and never uses MOSHI_HOOK_CONFIG_DIR", () => {
    const fix = fixture();
    const override = join(fix.root, "override");
    const stateDir = join(fix.root, "state");
    const hook = join(fix.root, "hook");
    for (const dir of [override, stateDir, hook]) mkdirSync(dir, { recursive: true });
    host(fix.config, "host-from-home");
    host(override, "host-from-override");
    host(stateDir, "host-from-state");
    host(hook, "host-from-hook");
    const result = runPairing(fix, {
      MOSHI_CONFIG_DIR: override,
      MOSHI_STATE_DIR: stateDir,
      MOSHI_HOOK_CONFIG_DIR: hook,
    });
    expect(result.pairing.hostId).toBe("host-from-override");
  });


  test("keeps MOSHI_API_BASE over a stored base URL and drops a trailing slash", () => {
    const fix = fixture();
    host(fix.config, HOST_ID, { baseUrl: "https://stored.fixture.test/api/v1/" });
    expect(
      runPairing(fix, { MOSHI_API_BASE: "https://env.fixture.test/api/v1" }).pairing.baseUrl,
    ).toBe("https://env.fixture.test/api/v1");
    expect(runPairing(fix).pairing.baseUrl).toBe("https://stored.fixture.test/api/v1");
  });


  test("reports an unpaired host without creating any file", () => {
    const fix = fixture();
    const before = listing(fix);
    expect(runPairing(fix)).toEqual({
      ok: false,
      message: "moshi: this host is not paired; run `moshi-hook pair`",
    });
    expect(listing(fix)).toEqual(before);
  });


  test("sanitizes a malformed host.json instead of echoing its bytes", () => {
    const fix = fixture();
    writeFileSync(join(fix.config, "host.json"), `{ "hostId": "${SECRET}" `);
    expect(runPairing(fix)).toEqual({
      ok: false,
      message: "moshi: the Moshi host pairing is not valid JSON",
    });
  });


  test("rejects a host.json that is not a JSON object", () => {
    for (const body of ["[]", "123", "null"]) {
      const fix = fixture();
      writeFileSync(join(fix.config, "host.json"), body);
      expect(runPairing(fix)).toEqual({
        ok: false,
        message: "moshi: the Moshi host pairing is not a JSON object",
      });
    }
  });


  test("fails when the file store holds only a pairing token", () => {
    const fix = fixture();
    host(fix.config);
    writeFileSync(join(fix.config, "config.json"), JSON.stringify({ secretStore: "file" }));
    writeFileSync(join(fix.config, "secrets.json"), JSON.stringify({ "pairing-token": TOKEN }));
    const result = runPairing(fix);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("moshi: the Moshi secret store holds no host-secret");
    expect(result.message).not.toContain(TOKEN);
  });


  test("fails when the login keychain holds no host-secret", () => {
    const fix = fixture({ code: 44 });
    host(fix.config);
    expect(runPairing(fix)).toEqual({
      ok: false,
      message: "moshi: the login keychain has no readable host-secret",
    });
    expect(keychainCalls(fix)).toBe(KEYCHAIN_ARGS);
  });


  test("refuses an unknown secret store without echoing the config", () => {
    const fix = fixture();
    host(fix.config);
    writeFileSync(
      join(fix.config, "config.json"),
      JSON.stringify({ secretStore: `vault-${SECRET}` }),
    );
    expect(runPairing(fix)).toEqual({
      ok: false,
      message: "moshi: the Moshi secret store is neither keychain nor file",
    });
  });

});
