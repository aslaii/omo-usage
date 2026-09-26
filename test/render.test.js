import { describe, expect, test } from "bun:test";

import { render } from "../src/render.js";

describe("render", () => {
  test("prints percents, statuses, accounts, and unavailable notes", () => {
    const output = render([
      {
        id: "codex",
        account: "dev@example.com",
        note: "pro",
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
    expect(lines[0]).toBe("Codex (ChatGPT) (dev@example.com)  pro");
    expect(lines[1]).toMatch(/^\s+weekly\s+12%$/);
    expect(lines[2]).toMatch(/^\s+monthly\s+unknown$/);
    expect(lines[3]).toMatch(/^\s+5h\s+100%\s+rate-limited$/);

    expect(lines[4]).toBe("");
    expect(lines[5]).toBe("Claude");
    expect(lines[6]).toMatch(/^\s+5h\s+7%$/);

    expect(lines[7]).toBe("");
    expect(lines[8]).toBe("Command Code: unavailable - no credential available");
  });

  test("shows the note beside the account and counts resets down", () => {
    const now = Date.parse("2026-09-26T17:00:00.000Z");
    const output = render(
      [
        {
          id: "codex",
          account: "dev@example.com",
          note: "pro · 1 reset credit",
          windows: [
            { label: "weekly", percent: 0, resetsAt: "2026-10-03T17:00:00.000Z", status: "ok" },
            { label: "5h", percent: 40, resetsAt: "2026-09-26T22:30:00.000Z", status: "ok" },
          ],
        },
        {
          id: "claude",
          account: null,
          windows: [{ label: "5h", percent: 10, resetsAt: "2026-09-26T17:12:00.000Z", status: "ok" }],
        },
      ],
      now,
    );

    const lines = output.split("\n");
    expect(lines[0]).toBe("Codex (ChatGPT) (dev@example.com)  pro · 1 reset credit");
    expect(lines[1]).toBe("  weekly  0%  resets in 7d");
    expect(lines[2]).toBe("  5h      40%  resets in 5h 30m");
    expect(lines[4]).toBe("Claude");
    expect(lines[5]).toBe("  5h  10%  resets in 12m");
  });

  test("clamps a reset time in the past to zero", () => {
    const now = Date.parse("2026-09-26T17:00:00.000Z");
    const output = render(
      [
        {
          id: "codex",
          account: null,
          windows: [{ label: "weekly", percent: 100, resetsAt: "2026-09-26T16:00:00.000Z", status: "ok" }],
        },
      ],
      now,
    );

    expect(output.split("\n")[1]).toBe("  weekly  100%  resets in 0m");
  });
});
