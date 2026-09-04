import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts", "local-demo.mjs");

describe("local demo data fixture", () => {
  it("is explicitly local-only and refuses ambiguous database targets", () => {
    const source = fs.readFileSync(scriptPath, "utf8");

    expect(source).toContain('path.resolve(root, "data", "local.db")');
    expect(source).toContain(
      'effective("NODE_ENV") || "").toLowerCase() === "production"',
    );
    expect(source).toContain('effective("LOCAL_DEV_BYPASS_AUTH") !== "true"');
    expect(source).toContain('isDeclared("TURSO_DATABASE_URL")');
    expect(source).toContain('isDeclared("TURSO_AUTH_TOKEN")');
    expect(source).toContain('isDeclared("HABLA_LOCAL_DB_PATH")');
    expect(source).toContain("stat.isSymbolicLink()");
    expect(source).not.toContain("fetch(");
  });

  it("refreshes only its four deterministic demo classes in one transaction", () => {
    const source = fs.readFileSync(scriptPath, "utf8");

    expect(source).toContain('id: "local_demo_spanish_2_period_3"');
    expect(source).toContain('id: "local_demo_spanish_1_period_1"');
    expect(source).toContain('id: "local_demo_ap_spanish"');
    expect(source).toContain('id: "local_demo_french_1_period_6"');
    expect(source).toContain("DELETE FROM classes WHERE id IN");
    expect(source).not.toMatch(/DELETE FROM classes[^\n]+LIKE/i);
    expect(source).toContain('db.transaction("write")');
    expect(source).toContain("await transaction.commit()");
    expect(source).toContain("await transaction.rollback()");
    expect(source.indexOf("verifiedStatus = await collectStatus(transaction)")).toBeLessThan(
      source.indexOf("await transaction.commit()"),
    );
    expect(source).toContain("Existing local_ai_* data was left untouched.");
  });

  it("registers repeatable seed, reset, and status commands", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

    expect(packageJson.scripts["demo:seed"]).toBe("node scripts/local-demo.mjs seed");
    expect(packageJson.scripts["demo:reset"]).toBe("node scripts/local-demo.mjs reset");
    expect(packageJson.scripts["demo:status"]).toBe("node scripts/local-demo.mjs status");
  });
});
