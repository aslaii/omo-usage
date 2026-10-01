/** @import {FetchLike, ProviderUsage} from "../types.js" */

const ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const USER_AGENT = "codex_cli_rs/0.50.0 (Mac OS 15.3.1; arm64)";
const ACCOUNT_NAMESPACE = "https://api.openai.com/auth";

/**
 * The identity Moshi needs is the account this very response was billed to, so the
 * usage body's account uuid wins over anything the request carried. The stored
 * credential's accountId is a sibling hint that only steers a header, never the
 * answer to "which account is this".
 * @param {unknown} body
 * @param {string} token
 * @returns {string | undefined}
 */
function identityOf(body, token) {
  if (body && typeof body === "object") {
    const reported = /** @type {{ account_id?: unknown }} */ (body).account_id;
    if (typeof reported === "string" && reported.trim()) return reported;
  }
  // The exact access token's own claim is the fallback; a token that is not a JWT
  // proves nothing, and an unreadable one must not blank the row.
  const claims = token.split(".")[1];
  if (!claims) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(claims, "base64url").toString("utf8"));
    const claimed = payload?.[ACCOUNT_NAMESPACE]?.chatgpt_account_id;
    return typeof claimed === "string" && claimed ? claimed : undefined;
  } catch (error) {
    // A token that is not a JWT names no account. The row stays usable and simply
    // carries no identity, so Moshi skips it instead of the table losing the usage.
    if (!(error instanceof SyntaxError)) throw error;
    console.error("codex: access token has no readable account identity");
    return undefined;
  }
}

export const id = "codex";

export function label() {
  return "Codex (ChatGPT)";
}

/**
 * @param {{ token: string; accountId?: string }} creds
 * @param {FetchLike} fetchImpl
 * @returns {Promise<ProviderUsage>}
 */
export async function fetch(creds, fetchImpl) {
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
   *   account_id?: string,
   *   email: string,
   *   plan_type: string,
   *   rate_limit: { limit_reached: boolean, primary_window: { used_percent: number, reset_at: number } },
   *   rate_limit_reset_credits?: { available_count: number },
   * }} */
  const body = await response.json();
  const { primary_window: primary, limit_reached: limitReached } = body.rate_limit;
  const resetCredits = body.rate_limit_reset_credits?.available_count ?? 0;
  const accountId = identityOf(body, creds.token);

  return {
    id,
    account: body.email,
    ...(accountId ? { accountId } : {}),
    windows: [
      {
        label: "weekly",
        percent: primary.used_percent,
        resetsAt: new Date(primary.reset_at * 1000).toISOString(),
        status: limitReached ? "rate-limited" : "ok",
      },
    ],
    note: [
      body.plan_type,
      resetCredits > 0
        ? `${resetCredits} reset credit${resetCredits === 1 ? "" : "s"}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
