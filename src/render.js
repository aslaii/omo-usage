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
 * @param {Window[]} windows
 * @returns {string[]}
 */
function windowLines(windows) {
  const width = windows.reduce((max, window) => Math.max(max, window.label.length), 0);
  return windows.map((window) => {
    const parts = [
      `  ${window.label.padEnd(width)}`,
      window.percent === null ? "unknown" : `${window.percent}%`,
    ];
    if (window.resetsAt) parts.push(`resets ${window.resetsAt}`);
    if (window.status !== "ok") parts.push(window.status);
    return parts.join("  ");
  });
}

/**
 * @param {ProviderUsage} usage
 * @returns {string}
 */
function block(usage) {
  const label = LABELS[usage.id];
  if (usage.windows.length === 0) {
    return `${label}: unavailable - ${usage.note ?? "no windows reported"}`;
  }
  const header = usage.account ? `${label} (${usage.account})` : label;
  return [header, ...windowLines(usage.windows)].join("\n");
}

/**
 * @param {ProviderUsage[]} usages
 * @returns {string}
 */
export function render(usages) {
  return usages.map(block).join("\n\n");
}
