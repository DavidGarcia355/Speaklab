import { describe, expect, it } from "vitest";
import { rosterAddSchema, rosterBulkSchema } from "@/lib/validation";

describe("rosterAddSchema", () => {
  it("accepts valid name and email", () => {
    const result = rosterAddSchema.safeParse({ name: "Ana García", email: "ana@school.edu" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = rosterAddSchema.safeParse({ name: "", email: "ana@school.edu" });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only name", () => {
    const result = rosterAddSchema.safeParse({ name: "   ", email: "ana@school.edu" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = rosterAddSchema.safeParse({ name: "Ana", email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("normalizes email to lowercase", () => {
    const result = rosterAddSchema.safeParse({ name: "Ana", email: "ANA@SCHOOL.EDU" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("ana@school.edu");
  });

  it("rejects HTML in name", () => {
    const result = rosterAddSchema.safeParse({ name: "<script>alert(1)</script>", email: "ana@school.edu" });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from name", () => {
    const result = rosterAddSchema.safeParse({ name: "  Ana García  ", email: "ana@school.edu" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Ana García");
  });

  it("rejects email over 254 characters", () => {
    const longEmail = `${"a".repeat(250)}@b.co`;
    const result = rosterAddSchema.safeParse({ name: "Ana", email: longEmail });
    expect(result.success).toBe(false);
  });
});

describe("rosterBulkSchema", () => {
  it("accepts an array of valid students", () => {
    const result = rosterBulkSchema.safeParse({
      students: [
        { name: "Ana García", email: "ana@school.edu" },
        { name: "Ben Smith", email: "ben@school.edu" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty array", () => {
    const result = rosterBulkSchema.safeParse({ students: [] });
    expect(result.success).toBe(false);
  });

  it("rejects arrays over 500 students", () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      name: `Student ${i}`,
      email: `s${i}@school.edu`,
    }));
    const result = rosterBulkSchema.safeParse({ students: tooMany });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 500 students", () => {
    const exactly500 = Array.from({ length: 500 }, (_, i) => ({
      name: `Student ${i}`,
      email: `s${i}@school.edu`,
    }));
    const result = rosterBulkSchema.safeParse({ students: exactly500 });
    expect(result.success).toBe(true);
  });

  it("rejects if any student has an invalid email", () => {
    const result = rosterBulkSchema.safeParse({
      students: [
        { name: "Ana", email: "ana@school.edu" },
        { name: "Bad", email: "not-valid" },
      ],
    });
    expect(result.success).toBe(false);
  });
});
