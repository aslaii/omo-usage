import { collect } from "./src/credentials.js";
import { render } from "./src/render.js";

/**
 * @typedef {object} CommandContext
 * @property {{ notify(message: string, type?: "info" | "warning" | "error"): void }} ui
 * @property {() => Promise<void>} [waitForIdle]
 */

/**
 * @typedef {object} ExtensionApi
 * @property {(name: string, options: { description?: string, handler: (args: string, ctx: CommandContext) => Promise<void> }) => void} registerCommand
 */

/**
 * @param {ExtensionApi} pi
 * @returns {void}
 */
export default function activate(pi) {
  pi.registerCommand("omo-usage", {
    description: "Show live usage and quota for codex, claude, commandcode, and opencode-go",
    handler: async (_args, ctx) => {
      // Usage is only meaningful once the current turn stopped spending quota.
      await ctx.waitForIdle?.();
      ctx.ui.notify(render(await collect()), "info");
    },
  });
}
