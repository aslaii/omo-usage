import { afterEach, describe, expect, test } from "bun:test";
import {
  CANCELLED,
  KEYCHAIN_ARGS,
  cleanupFixtures,
  fixture,
  host,
  helperFinished,
  keychainCalls,
  runPairing,
} from "./moshi-harness.js";

afterEach(cleanupFixtures);

describe("readMoshiPairing cancellation", () => {
  test("cancels an already-aborted keychain read without running the helper", () => {
    const fix = fixture();
    host(fix.config);
    expect(runPairing(fix, { MOSHI_PAIRING_FIXTURE_ABORT: "before" })).toEqual({
      ok: false,
      message: CANCELLED,
    });
    expect(keychainCalls(fix)).toBeNull();
    expect(helperFinished(fix)).toBe(false);
  });


  test("cancels an in-flight keychain read and kills the helper", () => {
    const fix = fixture({ stall: true });
    host(fix.config);
    expect(runPairing(fix, { MOSHI_PAIRING_FIXTURE_ABORT: "during" })).toEqual({
      ok: false,
      message: CANCELLED,
    });
    expect(keychainCalls(fix)).toBe(KEYCHAIN_ARGS);
    expect(helperFinished(fix)).toBe(false);
  });
});
