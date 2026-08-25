import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("release environment sync", () => {
  it("manages the teacher registration controls used by the runtime", () => {
    const script = readFileSync("scripts/sync-vercel-env.ps1", "utf8");

    expect(script).toContain('"TEACHER_ALLOWLIST"');
    expect(script).toContain('"ALLOW_TEACHER_SELF_REGISTRATION"');
    expect(script).not.toContain('"TEACHER_EMAILS"');
    expect(script).not.toContain('"SCHOOL_GOOGLE_DOMAIN"');
    expect(script).toContain("cleared optional $key");
    expect(script).toContain("--force -y");
    expect(script).toContain("if ($LASTEXITCODE -ne 0)");
  });
});
