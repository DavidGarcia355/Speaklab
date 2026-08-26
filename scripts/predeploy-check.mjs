import { spawnSync } from "node:child_process";

const allowDirty = process.argv.includes("--allow-dirty");

function git(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "unknown Git error").trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout.trim();
}

function fail(message) {
  console.error(`Release baseline check failed: ${message}`);
  process.exitCode = 1;
}

try {
  const root = git(["rev-parse", "--show-toplevel"]);
  const topLevel = process.cwd().replaceAll("\\", "/").toLowerCase();
  if (root.replaceAll("\\", "/").toLowerCase() !== topLevel) {
    fail("run this command from the repository root.");
  }

  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status && !allowDirty) {
    fail("the worktree is not clean. Commit the reviewed release candidate before deployment.");
  }

  git([
    "fetch",
    "--prune",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
  ]);
  git(["rev-parse", "--verify", "origin/main"]);
  const behind = Number(git(["rev-list", "--count", "HEAD..origin/main"]));
  if (!Number.isSafeInteger(behind) || behind > 0) {
    fail(`HEAD is ${behind || "an unknown number of"} commit(s) behind local origin/main. Fetch and rebase the release branch.`);
  }

  const whitespace = spawnSync("git", ["diff", "--check", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  if (whitespace.status !== 0) {
    fail((whitespace.stdout || whitespace.stderr || "the diff contains whitespace errors").trim());
  }

  if (!process.exitCode) {
    console.log(
      allowDirty
        ? "Release baseline is current with origin/main; dirty-worktree enforcement was explicitly bypassed for local verification."
        : "Release baseline is clean and current with origin/main.",
    );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : "unexpected release baseline error");
}
