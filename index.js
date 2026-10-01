import { collect } from "./src/credentials.js";
import { render } from "./src/render.js";
import { createMoshiLoop, formatMoshiResult, syncMoshi } from "./src/moshi-sync.js";

/**
 * @typedef {object} CommandContext
 * @property {{ notify(message: string, type?: "info" | "warning" | "error"): void }} ui
 */

/**
 * @typedef {object} ExtensionApi
 * @property {(name: string, options: { description?: string, handler: (args: string, ctx: CommandContext) => Promise<void> }) => void} registerCommand
 * @property {(event: "session_shutdown", handler: () => Promise<void>) => void} on
 */

/**
 * @param {ExtensionApi} pi
 * @returns {void}
 */
export default function activate(pi) {
  const loop = createMoshiLoop();
  pi.on("session_shutdown", () => loop.off());
  pi.registerCommand("omo-usage", {
    description: "Show usage and quota, or sync supported accounts to Moshi",
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify("Checking usage...", "info");
        ctx.ui.notify(render(await collect()), "info");
        return;
      }
      const words = args.trim().split(/\s+/);
      if (words.length !== 2 || words[0] !== "moshi" ||
        !["sync", "on", "off", "status"].includes(words[1])) {
        ctx.ui.notify("Usage: /omo-usage [moshi sync|on|off|status]", "error");
        return;
      }
      if (words[1] === "status") {
        const status = loop.status();
        ctx.ui.notify([
          `Moshi background sync: ${status.enabled ? "on" : "off"} (every 5m).`,
          `Request in flight: ${status.inFlight ? "yes" : "no"}.`,
          status.lastOutcome ?? "No sync attempted.",
        ].join("\n"), "info");
        return;
      }
      ctx.ui.notify(words[1] === "off" ? "Stopping Moshi sync..." : "Syncing usage to Moshi...", "info");
      try {
        switch (words[1]) {
          case "sync":
            ctx.ui.notify(formatMoshiResult(await syncMoshi()), "info");
            break;
          case "on":
            await loop.on();
            ctx.ui.notify(`Moshi background sync is on (every 5m).\n${loop.status().lastOutcome}`, "info");
            break;
          case "off":
            await loop.off();
            ctx.ui.notify("Moshi background sync is off.", "info");
            break;
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "Moshi sync failed.", "error");
      }
    },
  });
}
