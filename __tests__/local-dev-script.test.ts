import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("local development process detection", () => {
  it("matches the current repository root instead of a stale folder name", () => {
    const source = readFileSync("scripts/local-dev.mjs", "utf8");

    expect(source).toContain("path.resolve(root)");
    expect(source).not.toContain("Speaklab-main");
  });
});
