import { describe, expect, test } from "bun:test";

import { render } from "../src/render.js";

describe("render", () => {
  test("prints percents, statuses, accounts, and unavailable notes", () => {
    const output = render([
      {
        id: "codex",
        account: "dev@example.com",
        note: "plus",
        windows: [
          { label: "weekly", percent: 12, resetsAt: null, status: "ok" },
          { label: "monthly", percent: null, resetsAt: null, status: "ok" },
          { label: "5h", percent: 100, resetsAt: null, status: "rate-limited" },
        ],
      },
      {
        id: "claude",
        account: null,
        windows: [{ label: "5h", percent: 7, resetsAt: null, status: "ok" }],
      },
      {
        id: "commandcode",
        account: null,
        note: "no credential available",
        windows: [],
      },
    ]);

    const lines = output.split("\n");
    expect(lines[0]).toBe("Codex (ChatGPT) (dev@example.com)");
    expect(lines[1]).toMatch(/^\s+weekly\s+12%$/);
    expect(lines[2]).toMatch(/^\s+monthly\s+unknown$/);
    expect(lines[3]).toMatch(/^\s+5h\s+100%\s+rate-limited$/);

    expect(lines[4]).toBe("");
    expect(lines[5]).toBe("Claude");
    expect(lines[6]).toMatch(/^\s+5h\s+7%$/);

    expect(lines[7]).toBe("");
    expect(lines[8]).toBe("Command Code: unavailable - no credential available");
  });
});
