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
 * @typedef {(url: string, init: { headers: Record<string, string>, method?: string, signal?: AbortSignal }) => Promise<Response>} FetchLike
 */

/**
 * Normalized result every provider module returns. See AGENTS.md.
 * @typedef {object} ProviderUsage
 * @property {"codex" | "claude" | "commandcode" | "opencode-go"} id Provider id.
 * @property {string | null} account Account label the provider exposes, or null when it exposes none.
 * @property {Window[]} windows Windows the provider reported.
 * @property {string} [note] Plan name, status line, or anything else worth a footnote.
 */

export {};
