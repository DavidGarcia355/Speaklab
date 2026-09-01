import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/teacher/class/[classId]/page.tsx", "utf8");

function sourceBetween(start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("teacher assignment edit fields", () => {
  it("initializes the description and preserves common or custom response languages", () => {
    const openEditSource = sourceBetween(
      "function openAssignmentEditModal()",
      "async function handleAssignmentAttachmentChange"
    );

    expect(source).toContain("targetLanguage: string;");
    expect(openEditSource).toContain("setAssignmentDescriptionDraft(activeAssignment.description)");
    expect(openEditSource).toContain("setAssignmentTargetLanguageDraft(targetLanguage)");
    expect(openEditSource).toContain("ASSIGNMENT_LANGUAGE_OPTIONS.some");
  });

  it("sends, optimistically applies, confirms, and rolls back both editable fields", () => {
    const saveEditSource = sourceBetween(
      "async function saveAssignmentEdit()",
      "async function copyStudentLink"
    );

    expect(saveEditSource).toContain("description: activeAssignment.description");
    expect(saveEditSource).toContain("targetLanguage: activeAssignment.targetLanguage");
    expect(saveEditSource).toMatch(/\.\.\.row,\s+title,\s+description,\s+instructions,\s+targetLanguage,/);
    expect(saveEditSource).toMatch(/JSON\.stringify\(\{\s+title,\s+description,\s+instructions,\s+targetLanguage,/);
    expect(saveEditSource).toContain("description: data.item!.description");
    expect(saveEditSource).toContain("targetLanguage: data.item!.targetLanguage");
    expect(saveEditSource).toContain("{ ...row, ...rollback }");
  });

  it("uses clear native controls with an accessible custom-language path", () => {
    expect(source).toContain('htmlFor="edit-assignment-description"');
    expect(source).toContain('id="edit-assignment-description"');
    expect(source).toContain('htmlFor="edit-assignment-language"');
    expect(source).toMatch(/<select\s+id="edit-assignment-language"/);
    expect(source).toContain('className="input select-input"');
    expect(source).toContain('<ChevronDown size={18} aria-hidden="true" />');
    expect(source).toContain('htmlFor="edit-assignment-custom-language"');
    expect(source).toContain('id="edit-assignment-custom-language"');
    expect(source).toContain('aria-describedby="edit-assignment-language-help"');
  });
});
