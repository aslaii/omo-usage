/** @import {FetchLike, ProviderUsage} from "../types.js" */

const ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const USER_AGENT = "codex_cli_rs/0.50.0 (Mac OS 15.3.1; arm64)";

export const id = "codex";

export function label() {
  return "Codex (ChatGPT)";
}

/**
 * @param {{ token: string; accountId?: string }} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<ProviderUsage>}
 */
export async function fetch(creds, fetchImpl = globalThis.fetch) {
  if (!creds.token) throw new Error("codex: missing access token");

  /** @type {Record<string, string>} */
  const headers = {
    authorization: `Bearer ${creds.token}`,
    accept: "application/json",
    "user-agent": USER_AGENT,
  };
  // The usage endpoint resolves the account from the bearer token; the account
  // header is informational and cannot select a different workspace.
  if (creds.accountId) headers["chatgpt-account-id"] = creds.accountId;

  const response = await fetchImpl(ENDPOINT, { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`codex: usage request failed with status ${response.status}`);
  }

  /** @type {{
   *   email: string,
   *   plan_type: string,
   *   rate_limit: { limit_reached: boolean, primary_window: { used_percent: number, reset_at: number } },
   * }} */
  const body = await response.json();
  const { primary_window: primary, limit_reached: limitReached } = body.rate_limit;

  return {
    id,
    account: body.email,
    windows: [
      {
        label: "weekly",
        percent: primary.used_percent,
        resetsAt: new Date(primary.reset_at * 1000).toISOString(),
        status: limitReached ? "rate-limited" : "ok",
      },
    ],
    note: body.plan_type,
  };
}
