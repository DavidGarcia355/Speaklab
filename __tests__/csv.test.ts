import { describe, expect, it } from "vitest";

import { parseCsvRows } from "@/lib/csv";

describe("parseCsvRows", () => {
  it("keeps commas inside quoted fields", () => {
    expect(parseCsvRows('name,email\n"Lovelace, Ada",ada@example.com')).toEqual([
      ["name", "email"],
      ["Lovelace, Ada", "ada@example.com"],
    ]);
  });

  it("unescapes doubled quotes inside quoted fields", () => {
    expect(parseCsvRows('"Ada ""Ace"" Lovelace",ada@example.com')).toEqual([
      ['Ada "Ace" Lovelace', "ada@example.com"],
    ]);
  });

  it("treats CRLF as one record separator", () => {
    expect(parseCsvRows("name,email\r\nAda,ada@example.com\r\nGrace,grace@example.com\r\n")).toEqual([
      ["name", "email"],
      ["Ada", "ada@example.com"],
      ["Grace", "grace@example.com"],
    ]);
  });

  it("preserves embedded newlines inside quoted fields", () => {
    expect(parseCsvRows('name,notes,email\r\nAda,"Line one\r\nLine two",ada@example.com')).toEqual([
      ["name", "notes", "email"],
      ["Ada", "Line one\r\nLine two", "ada@example.com"],
    ]);
  });

  it("preserves trailing blank fields without adding a row for the final line break", () => {
    expect(parseCsvRows("Ada,ada@example.com,,\r\n")).toEqual([
      ["Ada", "ada@example.com", "", ""],
    ]);
  });

  it("rejects unterminated quoted fields", () => {
    expect(() => parseCsvRows('Ada,"unfinished')).toThrow(
      "CSV contains an unterminated quoted field.",
    );
  });
});
