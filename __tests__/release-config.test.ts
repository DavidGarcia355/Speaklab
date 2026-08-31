import { spawnSync } from "node:child_process";
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

  it("normalizes whitespace and casing with the same semantics as runtime", () => {
    expect(
      assertTeacherRegistrationReleasePolicy({
        environment: { ALLOW_TEACHER_SELF_REGISTRATION: "  TRUE\t" },
      }),
    ).toBe("public");

    expect(
      assertTeacherRegistrationReleasePolicy({
        environment: { ALLOW_TEACHER_SELF_REGISTRATION: "\nFaLsE  " },
        privateDeployment: true,
      }),
    ).toBe("private");
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
    expect(script).toContain('process.argv.includes("--registration-only")');
  });

  it("runs the registration gate before every public production build", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.build).toMatch(
      /^node scripts\/predeploy-check\.mjs --registration-only && next build$/,
    );
    expect(packageJson.scripts["build:private"]).toContain(
      "--registration-only --private-deployment",
    );
    expect(packageJson.scripts["release:check:private"]).toContain("npm run check:private");
  });

  it("blocks a closed public build while preserving an explicit private build", () => {
    const runBuildGate = (privateDeployment = false) =>
      spawnSync(
        process.execPath,
        [
          "scripts/predeploy-check.mjs",
          "--registration-only",
          ...(privateDeployment ? ["--private-deployment"] : []),
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            ALLOW_TEACHER_SELF_REGISTRATION: "  FALSE\t",
          },
        },
      );

    const publicBuild = runBuildGate();
    expect(publicBuild.status).toBe(1);
    expect(publicBuild.stderr).toMatch(/public Start free experience/);

    const privateBuild = runBuildGate(true);
    expect(privateBuild.status).toBe(0);
    expect(privateBuild.stdout).toMatch(/private deployment/);
  });

  it("requires explicit registration intent before syncing production", () => {
    const script = readFileSync("scripts/sync-vercel-env.ps1", "utf8");

    expect(script).toContain('$Targets -contains "production"');
    expect(script).toContain("must be explicit for production");
    expect(script).toContain("requires -PrivateDeployment");
  });
});
