import { describe, expect, test } from "bun:test";

import { render } from "../src/render.js";

describe("render", () => {
  test("prints share remaining, statuses, accounts, and unavailable notes", () => {
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
    expect(lines[1]).toMatch(/^\s+weekly\s+88% left$/);
    expect(lines[2]).toMatch(/^\s+monthly\s+unknown$/);
    expect(lines[3]).toMatch(/^\s+5h\s+0% left\s+rate-limited$/);

    expect(lines[4]).toBe("");
    expect(lines[5]).toBe("Claude");
    expect(lines[6]).toMatch(/^\s+5h\s+93% left$/);

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
    expect(lines[1]).toBe("  weekly  100% left  resets in 7d");
    expect(lines[2]).toBe("  5h      60% left  resets in 5h 30m");
    expect(lines[4]).toBe("Claude");
    expect(lines[5]).toBe("  5h  90% left  resets in 12m");
  });

  test("inverts consumed share so an untouched quota reads as fully available", () => {
    const output = render([
      {
        id: "codex",
        account: null,
        windows: [
          { label: "weekly", percent: 0, resetsAt: null, status: "ok" },
          { label: "5h", percent: 63, resetsAt: null, status: "ok" },
        ],
      },
    ]);

    const lines = output.split("\n");
    expect(lines[1]).toBe("  weekly  100% left");
    expect(lines[2]).toBe("  5h      37% left");
  });

  test("keeps the account label on an unavailable row so named slots stay distinct", () => {
    const output = render([
      { id: "claude", account: "work@example.com", note: "no credential available", windows: [] },
      { id: "claude", account: "personal@example.com", note: "no credential available", windows: [] },
    ]);

    const lines = output.split("\n");
    expect(lines[0]).toBe("Claude (work@example.com): unavailable - no credential available");
    expect(lines[2]).toBe("Claude (personal@example.com): unavailable - no credential available");
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

    expect(output.split("\n")[1]).toBe("  weekly  0% left  resets in 0m");
  });
});
