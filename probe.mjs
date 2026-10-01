import { collect } from "./src/credentials.js";
import { render } from "./src/render.js";
import { formatMoshiResult, syncMoshi } from "./src/moshi-sync.js";

if (process.argv.slice(2).length === 0) {
  console.log(render(await collect()));
} else if (process.argv.slice(2).join(" ") === "--moshi") {
  console.log("Syncing usage to Moshi...");
  try {
    console.log(formatMoshiResult(await syncMoshi()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Moshi sync failed.");
    process.exitCode = 1;
  }
} else {
  console.error("Usage: bun run probe [--moshi]");
  process.exitCode = 1;
}
