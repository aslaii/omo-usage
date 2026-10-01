/**
 * One usage window reported by a provider, such as a 5-hour rolling window.
 * @typedef {object} Window
 * @property {string} label Window name as the provider reports it, for example "5h".
 * @property {number | null} percent Share of the window consumed, or null when the provider reports no cap.
 * @property {string | null} resetsAt ISO timestamp of the next reset, or null when the provider reports none.
 * @property {string} status Provider-reported state, for example "ok" or "rate-limited".
 * @property {"quota" | "credit"} [kind] "credit" marks a pool that expires rather than resets. Defaults to "quota".
 */

/**
 * The slice of `fetch` these adapters actually use. Typing the seam structurally
 * keeps a test double from having to satisfy Bun's `fetch`, which carries extras
 * such as `preconnect`.
 * @typedef {(url: string, init: { headers: Record<string, string>, method?: string, signal?: AbortSignal, body?: string }) => Promise<Response>} FetchLike
 */

/**
 * Normalized result every provider module returns. See AGENTS.md.
 * @typedef {object} ProviderUsage
 * @property {"codex" | "claude" | "commandcode" | "opencode-go"} id Provider id.
 * @property {string | null} account Account label the provider exposes, or null when it exposes none.
 * @property {Window[]} windows Windows the provider reported.
 * @property {string} [note] Plan name, status line, or anything else worth a footnote.
 * @property {string} [accountId] Non-secret provider-local identity. Never a label, a token, or a token hash.
 */

/**
 * Moshi pairing as the collector reads it from the user's config.
 * @typedef {object} MoshiPairing
 * @property {string} baseUrl
 * @property {string} hostId
 * @property {string} displayName
 * @property {string} hostSecret
 */

/**
 * One window in a Moshi snapshot. `resetsAt` rides along only when the provider
 * reported a valid one, so an absent reset stays absent instead of becoming an
 * invented timestamp.
 * @typedef {object} MoshiWindow
 * @property {string} label
 * @property {number} usedPercentage
 * @property {string} [resetsAt]
 */

/**
 * One account's usage as Moshi receives it.
 * @typedef {object} MoshiSnapshot
 * @property {string} accountId Non-secret provider-local identity.
 * @property {string} accountLabel
 * @property {"codex" | "claude-code" | "opencode"} agent
 * @property {string} hostName
 * @property {string} capturedAt ISO timestamp.
 * @property {MoshiWindow[]} windows
 */

/**
 * @typedef {object} MoshiBatch
 * @property {MoshiSnapshot[]} snapshots
 * @property {string[]} omissions One reason per row that could not be exported.
 */

/**
 * @typedef {object} MoshiSyncResult
 * @property {number} count
 * @property {string[]} omissions
 */

/**
 * @typedef {object} MoshiStatus
 * @property {boolean} enabled
 * @property {boolean} inFlight
 * @property {number} intervalMs
 * @property {string | null} lastOutcome
 */

/**
 * @typedef {object} MoshiLoop
 * @property {() => Promise<void>} on
 * @property {() => Promise<void>} off
 * @property {() => MoshiStatus} status
 */

export {};
