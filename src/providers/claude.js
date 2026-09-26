/** @import {FetchLike, ProviderUsage} from "../types.js" */

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const USER_AGENT = "claude-cli/2.1.0";

export const id = "claude";

export function label() {
  return "Claude";
}

/**
 * @param {{ token: string; accountId?: string }} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<ProviderUsage>}
 */
export async function fetch(creds, fetchImpl = globalThis.fetch) {
  if (!creds.token) throw new Error("claude: missing access token");

  const response = await fetchImpl(ENDPOINT, {
    method: "GET",
    headers: {
      authorization: `Bearer ${creds.token}`,
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`claude: usage request failed with status ${response.status}`);
  }

  /** @type {{
   *   five_hour: { utilization: number, resets_at: string|null, locked_reason: string|null },
   *   seven_day: { utilization: number, resets_at: string|null },
   * }} */
  const body = await response.json();

  return {
    id,
    account: null,
    windows: [toWindow("5h", body.five_hour), toWindow("weekly", body.seven_day)],
  };
}

/**
 * Only the 5-hour window carries a lock reason; a locked window reads as
 * rate-limited even when its utilization is still below the cap.
 * @param {string} label
 * @param {{ utilization: number, resets_at?: string|null, locked_reason?: string|null }} window
 */
function toWindow(label, window) {
  return {
    label,
    percent: window.utilization,
    resetsAt: window.resets_at ?? null,
    status: window.locked_reason ? "rate-limited" : "ok",
  };
}
