/** @import {FetchLike, ProviderUsage} from "../types.js" */

const BASE = "https://api.commandcode.ai";

export const id = "commandcode";

export function label() {
  return "Command Code";
}

/**
 * @param {string} path
 * @param {string} token
 * @param {FetchLike} fetchImpl
 */
async function getJson(path, token, fetchImpl) {
  const response = await fetchImpl(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`commandcode: GET ${path} returned ${response.status}`);
  }
  return response.json();
}

/**
 * @param {string} name
 * @param {{used: number, cap: number, exceeded: boolean, resetAt: number}} limit
 */
function toWindow(name, limit) {
  return {
    label: name,
    percent: limit.cap > 0 && limit.resetAt > 0
      ? Math.round((limit.used / limit.cap) * 100)
      : null,
    resetsAt: limit.resetAt > 0 ? new Date(limit.resetAt * 1000).toISOString() : null,
    status: limit.exceeded ? "rate-limited" : "ok",
  };
}

/**
 * @param {{token: string, accountId?: string}} creds
 * @param {FetchLike} fetchImpl
 * @returns {Promise<ProviderUsage>}
 */
export async function fetch(creds, fetchImpl = globalThis.fetch) {
  if (!creds.token) {
    throw new Error("commandcode: missing API token");
  }
  const whoami = await getJson("/alpha/whoami", creds.token, fetchImpl);
  const orgId = whoami.org?.id;
  const scope = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  const [credits, subscriptions] = await Promise.all([
    getJson(`/alpha/billing/credits${scope}`, creds.token, fetchImpl),
    getJson(`/alpha/billing/subscriptions${scope}`, creds.token, fetchImpl),
  ]);
  const { monthlyCredits, purchasedCredits, freeCredits } = credits.credits;
  const { planId, status } = subscriptions.data;
  return {
    id,
    account: whoami.user.userName || whoami.user.email,
    windows: [
      toWindow("5h", credits.windowLimits.fiveHour),
      toWindow("weekly", credits.windowLimits.weekly),
    ],
    note: `${planId} ${status}, ${monthlyCredits + purchasedCredits + freeCredits} credits left`,
  };
}
