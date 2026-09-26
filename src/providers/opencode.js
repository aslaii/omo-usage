/** @import {FetchLike, ProviderUsage} from "../types.js" */

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

// Cloudflare answers error 1010 "browser_signature_banned" to the default agent
// User-Agent, so the usage endpoint is only reachable with a browser signature.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const id = "opencode-go";

export function label() {
  return "OpenCode Zen Go";
}

const WINDOW_NAMES = ["rolling", "weekly", "monthly"];

/**
 * @param {{token: string, accountId?: string}} creds
 * @param {FetchLike} fetchImpl
 * @returns {Promise<ProviderUsage>}
 */
export async function fetch(creds, fetchImpl) {
  if (!creds.token) {
    throw new Error("opencode-go: missing API token");
  }
  const response = await fetchImpl(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${creds.token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`opencode-go: GET usage returned ${response.status}`);
  }
  const { usage } = await response.json();
  return {
    id,
    account: null,
    windows: WINDOW_NAMES.map((name) => {
      const window = usage[name];
      return {
        label: name,
        percent: window.percent,
        resetsAt: window.resetsAt,
        status: window.status,
      };
    }),
  };
}
