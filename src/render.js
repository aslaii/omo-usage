import { label as claudeLabel } from "./providers/claude.js";
import { label as codexLabel } from "./providers/codex.js";
import { label as commandcodeLabel } from "./providers/commandcode.js";
import { label as opencodeLabel } from "./providers/opencode.js";

// Placed below the imports on purpose: tsc 7 mis-parses a JSDoc @import that
// directly precedes a relative-path import statement.
/** @import {ProviderUsage, Window} from "./types.js" */

const LABELS = {
  codex: codexLabel(),
  claude: claudeLabel(),
  commandcode: commandcodeLabel(),
  "opencode-go": opencodeLabel(),
};

/**
 * @param {number} ms
 * @returns {string}
 */
function duration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/**
 * @param {Window[]} windows
 * @param {number} now
 * @returns {string[]}
 */
function windowLines(windows, now) {
  const width = windows.reduce((max, window) => Math.max(max, window.label.length), 0);
  return windows.map((window) => {
    // Every provider reports share CONSUMED. Quota reads as remaining, so 0%
    // consumed must not print as "0%" beside a window it has not touched.
    const left = window.percent === null ? null : 100 - window.percent;
    const parts = [
      `  ${window.label.padEnd(width)}`,
      left === null ? "unknown" : `${left}% left`,
    ];
    if (window.resetsAt) {
      const verb = window.kind === "credit" ? "expires" : "resets";
      parts.push(`${verb} in ${duration(new Date(window.resetsAt).getTime() - now)}`);
    }
    if (window.status !== "ok") parts.push(window.status);
    return parts.join("  ");
  });
}

/**
 * @param {ProviderUsage} usage
 * @param {number} now
 * @returns {string}
 */
function block(usage, now) {
  const label = LABELS[usage.id];
  if (usage.windows.length === 0) {
    return `${label}: unavailable - ${usage.note ?? "no windows reported"}`;
  }
  const account = usage.account ? ` (${usage.account})` : "";
  const header = [`${label}${account}`, usage.note].filter(Boolean).join("  ");
  return [header, ...windowLines(usage.windows, now)].join("\n");
}

/**
 * `now` is a parameter so the countdown is deterministic under test.
 * @param {ProviderUsage[]} usages
 * @param {number} [now]
 * @returns {string}
 */
export function render(usages, now = Date.now()) {
  return usages.map((usage) => block(usage, now)).join("\n\n");
}
