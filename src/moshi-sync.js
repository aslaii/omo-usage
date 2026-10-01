import { collect } from "./credentials.js";
import { mapMoshi, postMoshiUsage, readMoshiPairing } from "./moshi.js";

/** @import {FetchLike, MoshiLoop, MoshiSyncResult} from "./types.js" */

const INTERVAL_MS = 300000;
const DEADLINE_MS = 15000;

/** @type {{ controller: AbortController, promise: Promise<MoshiSyncResult> } | null} */
let active = null;
/** @type {string | null} */
let lastOutcome = null;

/** @param {MoshiSyncResult} result @returns {string} */
export function formatMoshiResult(result) {
  return [`Synced ${result.count} account${result.count === 1 ? "" : "s"} to Moshi.`, ...result.omissions].join("\n");
}

/**
 * Concurrent manual/background calls share the same host quota read and upload.
 * The clearable deadline belongs to that attempt, not to a caller's timer.
 * @param {AbortSignal} [signal]
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<MoshiSyncResult>}
 */
export function syncMoshi(signal, fetchImpl = globalThis.fetch) {
  if (active) return active.promise;
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const deadline = setTimeout(() => controller.abort(new Error("moshi: sync timed out")), DEADLINE_MS);
  const work = (async () => {
    const pairing = await readMoshiPairing(combined);
    const rows = await collect(fetchImpl, combined);
    const batch = mapMoshi(rows, pairing.displayName, new Date().toISOString());
    if (batch.snapshots.length === 0) {
      throw new Error(["moshi: no exportable account usage", ...batch.omissions].join("\n"));
    }
    const count = await postMoshiUsage(pairing, batch.snapshots, fetchImpl, combined);
    return { count, omissions: batch.omissions };
  })();
  const promise = work.then(
    (result) => {
      clearTimeout(deadline);
      active = null;
      lastOutcome = formatMoshiResult(result);
      return result;
    },
    (error) => {
      clearTimeout(deadline);
      active = null;
      lastOutcome = error instanceof Error ? error.message : "moshi: sync failed";
      throw error;
    },
  );
  active = { controller, promise };
  return promise;
}

/**
 * No timer or request starts until on(). Shutdown/off invalidate the generation
 * before aborting, so a settling request cannot resurrect a stopped timer.
 * @param {(signal: AbortSignal) => Promise<MoshiSyncResult>} [sync]
 * @param {(callback: () => void) => () => void} [schedule]
 * @returns {MoshiLoop}
 */
export function createMoshiLoop(sync = syncMoshi, schedule = (callback) => {
  const timer = setTimeout(callback, INTERVAL_MS);
  return () => clearTimeout(timer);
}) {
  let enabled = false;
  let generation = 0;
  /** @type {(() => void) | undefined} */
  let cancelTimer;
  /** @type {AbortController | undefined} */
  let controller;
  /** @type {Promise<void> | undefined} */
  let pending;
  /** @type {string | null} */
  let outcome = null;

  /** @param {number} current @returns {Promise<void>} */
  async function tick(current) {
    if (!enabled || current !== generation) return;
    const attemptController = new AbortController();
    controller = attemptController;
    try {
      const result = await sync(attemptController.signal);
      if (current === generation) outcome = formatMoshiResult(result);
    } catch (error) {
      if (current === generation) {
        outcome = error instanceof Error ? error.message : "moshi: sync failed";
      }
    } finally {
      if (controller === attemptController) controller = undefined;
      if (enabled && current === generation) {
        cancelTimer = schedule(() => { pending = tick(current); });
      }
    }
  }

  return {
    async on() {
      if (enabled) return pending;
      enabled = true;
      pending = tick(++generation);
      await pending;
    },
    async off() {
      enabled = false;
      const stopping = ++generation;
      cancelTimer?.();
      cancelTimer = undefined;
      controller?.abort();
      active?.controller.abort();
      const attempts = [pending, active?.promise].filter((attempt) => attempt !== undefined);
      await Promise.allSettled(attempts);
      if (stopping === generation) pending = undefined;
    },
    status() {
      return {
        enabled,
        inFlight: controller !== undefined || active !== null,
        intervalMs: INTERVAL_MS,
        lastOutcome: outcome ?? lastOutcome,
      };
    },
  };
}
