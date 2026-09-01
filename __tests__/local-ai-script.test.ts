import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("local AI smoke fixture", () => {
  it("seeds an explicit manual AI grant for paid-mode mock testing", () => {
    const script = fs.readFileSync(
      path.join(process.cwd(), "scripts", "local-ai.mjs"),
      "utf8",
    );

    expect(script).toContain("ai_access_grant_source TEXT NOT NULL DEFAULT ''");
    expect(script).toContain("ai_access_grant_source='manual'");
    expect(script).toContain("AI grade: schema-valid and saved");
    expect(script).toContain("Exact AI-grade retry changed the saved result or created a duplicate attempt.");
    expect(script).toContain("db.close()");
  });
});
