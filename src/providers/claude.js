/** @import {FetchLike, ProviderUsage} from "../types.js" */

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const USER_AGENT = "claude-cli/2.1.0";

/** @type {Record<string, string>} */
const WINDOW_LABELS = {
  five_hour: "5h",
  seven_day: "weekly",
  seven_day_opus: "weekly opus",
  seven_day_sonnet: "weekly sonnet",
  seven_day_oauth_apps: "weekly oauth apps",
  seven_day_cowork: "weekly cowork",
  iguana_necktie: "credits",
  nimbus_quill: "credits promo",
};

export const id = "claude";

export function label() {
  return "Claude";
}

/**
 * @param {{ token: string; accountId?: string }} creds
 * @param {FetchLike} fetchImpl
 * @returns {Promise<ProviderUsage>}
 */
export async function fetch(creds, fetchImpl) {
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

  /** @type {Record<string, {
   *   utilization?: number,
   *   resets_at?: string | null,
   *   locked_reason?: string | null,
   *   remaining_dollars?: number,
   * } | null | undefined>} */
  const body = await response.json();

  // The payload mixes real windows with unrelated objects, so a window is
  // anything carrying a utilization. A zero-percent window with no reset time
  // says nothing, so it is dropped rather than rendered as an empty row.
  /** @type {import("../types.js").Window[]} */
  const windows = [];
  /** @type {string[]} */
  const credits = [];
  for (const [key, raw] of Object.entries(body)) {
    if (!raw || typeof raw.utilization !== "number") continue;
    if (!raw.resets_at && raw.utilization === 0) continue;
    const name = WINDOW_LABELS[key] ?? key;
    const remaining = raw.remaining_dollars;
    windows.push({
      label: name,
      percent: raw.utilization,
      resetsAt: raw.resets_at ?? null,
      status: raw.locked_reason ? "rate-limited" : "ok",
      kind: typeof remaining === "number" ? "credit" : "quota",
    });
    if (typeof remaining === "number") credits.push(`${name} $${remaining.toFixed(2)} left`);
  }

  return {
    id,
    account: null,
    windows,
    note: credits.length > 0 ? credits.join(", ") : undefined,
  };
}
