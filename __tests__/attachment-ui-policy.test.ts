import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MAX_ASSIGNMENT_ATTACHMENT_BYTES } from "@/lib/attachment-policy";

describe("assignment attachment UI policy", () => {
  it("uses the canonical server byte limit in both teacher upload surfaces", () => {
    expect(MAX_ASSIGNMENT_ATTACHMENT_BYTES).toBe(3 * 1024 * 1024);

    for (const file of [
      "app/teacher/class/[classId]/assignment/new/page.tsx",
      "app/teacher/class/[classId]/page.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('import { MAX_ASSIGNMENT_ATTACHMENT_BYTES } from "@/lib/attachment-policy";');
      expect(source).toContain("file.size > MAX_ASSIGNMENT_ATTACHMENT_BYTES");
      expect(source).not.toContain("10 * 1024 * 1024");
      expect(source).not.toContain("10MB");
    }
  });
});
