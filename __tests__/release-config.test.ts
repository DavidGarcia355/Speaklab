import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertTeacherRegistrationReleasePolicy } from "@/scripts/teacher-registration-release-policy.mjs";

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

  it("requires explicit open registration for the public Start free release", () => {
    expect(
      assertTeacherRegistrationReleasePolicy({
        environment: { ALLOW_TEACHER_SELF_REGISTRATION: "true" },
      }),
    ).toBe("public");

    expect(() =>
      assertTeacherRegistrationReleasePolicy({ environment: {} }),
    ).toThrow(/must be explicit/);
    expect(() =>
      assertTeacherRegistrationReleasePolicy({
        environment: { ALLOW_TEACHER_SELF_REGISTRATION: "false" },
      }),
    ).toThrow(/public Start free experience/);
  });

  it("preserves invite-only releases behind an explicit setting and flag", () => {
    expect(
      assertTeacherRegistrationReleasePolicy({
        environment: { ALLOW_TEACHER_SELF_REGISTRATION: "false" },
        privateDeployment: true,
      }),
    ).toBe("private");

    expect(() =>
      assertTeacherRegistrationReleasePolicy({
        environment: { ALLOW_TEACHER_SELF_REGISTRATION: "true" },
        privateDeployment: true,
      }),
    ).toThrow(/conflicts with --private-deployment/);
  });

  it("rejects malformed registration settings instead of choosing silently", () => {
    expect(() =>
      assertTeacherRegistrationReleasePolicy({
        environment: { ALLOW_TEACHER_SELF_REGISTRATION: "truthy" },
      }),
    ).toThrow(/must be either true or false/);
  });

  it("runs the registration policy gate in the release baseline check", () => {
    const script = readFileSync("scripts/predeploy-check.mjs", "utf8");

    expect(script).toContain("assertTeacherRegistrationReleasePolicy");
    expect(script).toContain('process.argv.includes("--private-deployment")');
  });

  it("requires explicit registration intent before syncing production", () => {
    const script = readFileSync("scripts/sync-vercel-env.ps1", "utf8");

    expect(script).toContain('$Targets -contains "production"');
    expect(script).toContain("must be explicit for production");
    expect(script).toContain("requires -PrivateDeployment");
  });
});
