import { afterEach, describe, expect, test } from "bun:test";
import { createMoshiLoop } from "../src/moshi-sync.js";

/** @import {MoshiLoop, MoshiSyncResult} from "../src/types.js" */

/** @type {MoshiLoop[]} */
const loops = [];
afterEach(async () => {
  await Promise.all(loops.splice(0).map((loop) => loop.off()));
});

function clock() {
  /** @type {Set<() => void>} */
  const scheduled = new Set();
  /** @param {() => void} callback */
  const schedule = (callback) => {
    const run = () => { scheduled.delete(run); callback(); };
    scheduled.add(run);
    return () => { scheduled.delete(run); };
  };
  return { scheduled, schedule };
}

function gate() {
  /** @type {(value: MoshiSyncResult) => void} */
  let resolve = () => {};
  /** @type {(reason: unknown) => void} */
  let reject = () => {};
  /** @type {Promise<MoshiSyncResult>} */
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("Moshi background lifecycle", () => {
  test("starts no work before opt-in and repeated on shares the first attempt", async () => {
    const { scheduled, schedule } = clock();
    const first = gate();
    let calls = 0;
    const loop = createMoshiLoop(async () => { calls += 1; return first.promise; }, schedule);
    loops.push(loop);
    expect(calls).toBe(0);
    expect(scheduled.size).toBe(0);
    const enabled = loop.on();
    const repeated = loop.on();
    expect(calls).toBe(1);
    expect(loop.status().inFlight).toBe(true);
    expect(scheduled.size).toBe(0);
    first.resolve({ count: 4, omissions: [] });
    await Promise.all([enabled, repeated]);
    expect(loop.status().inFlight).toBe(false);
    expect(scheduled.size).toBe(1);
    await loop.off();
    expect(scheduled.size).toBe(0);
  });

  test("off aborts and awaits pending work without rearming a timer", async () => {
    const { scheduled, schedule } = clock();
    const first = gate();
    /** @type {AbortSignal | undefined} */
    let signal;
    const loop = createMoshiLoop(async (current) => {
      signal = current;
      current.addEventListener("abort", () => first.reject(current.reason), { once: true });
      return first.promise;
    }, schedule);
    loops.push(loop);
    const enabled = loop.on();
    await loop.off();
    await enabled;
    expect(signal?.aborted).toBe(true);
    expect(loop.status().enabled).toBe(false);
    expect(loop.status().inFlight).toBe(false);
    expect(scheduled.size).toBe(0);
    await loop.off();
    expect(scheduled.size).toBe(0);
  });

  test("a captured timer starts the next attempt only after settlement", async () => {
    const { scheduled, schedule } = clock();
    let calls = 0;
    const loop = createMoshiLoop(async () => { calls += 1; return { count: calls, omissions: [] }; }, schedule);
    loops.push(loop);
    await loop.on();
    expect(calls).toBe(1);
    const next = [...scheduled.values()][0];
    next();
    await loop.on();
    expect(calls).toBe(2);
    expect(scheduled.size).toBe(1);
    await loop.off();
    expect(scheduled.size).toBe(0);
  });

  test("an old attempt cannot clear a newly enabled attempt's controller", async () => {
    const { scheduled, schedule } = clock();
    const first = gate();
    const second = gate();
    /** @type {AbortSignal[]} */
    const signals = [];
    const loop = createMoshiLoop(async (signal) => {
      signals.push(signal);
      return signals.length === 1 ? first.promise : second.promise;
    }, schedule);
    loops.push(loop);
    const initial = loop.on();
    const stopping = loop.off();
    const restarted = loop.on();
    first.reject(new Error("fixture cancelled"));
    await Promise.all([initial, stopping]);
    expect(signals[0].aborted).toBe(true);
    const stoppedAgain = loop.off();
    const newAttemptAborted = signals[1].aborted;
    second.reject(new Error("fixture cancelled"));
    await Promise.all([restarted, stoppedAgain]);
    expect(newAttemptAborted).toBe(true);
    expect(loop.status().inFlight).toBe(false);
    expect(scheduled.size).toBe(0);
  });
});
