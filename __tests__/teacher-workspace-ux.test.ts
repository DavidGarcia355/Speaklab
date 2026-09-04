import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const classWorkspaceSource = readFileSync("app/teacher/class/[classId]/page.tsx", "utf8");
const teacherDashboardSource = readFileSync("app/teacher/page.tsx", "utf8");
const rosterHubSource = readFileSync("app/teacher/rosters/page.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");

describe("teacher workspace UX safeguards", () => {
  it("keeps every essential teacher-dashboard workflow reachable after compaction", () => {
    expect(teacherDashboardSource).toContain('href="/teacher/class/new"');
    expect(teacherDashboardSource).toContain('href="/teacher/rosters"');
    expect(teacherDashboardSource).toContain('href="/billing"');
    expect(teacherDashboardSource).toContain('href={`/teacher/class/${item.id}`}');

    expect(teacherDashboardSource).toContain('method: "PATCH"');
    expect(teacherDashboardSource).toContain('method: "DELETE"');
    expect(teacherDashboardSource).toContain("startInlineEdit(item)");
    expect(teacherDashboardSource).toContain("setDeleteTarget(item)");
    expect(teacherDashboardSource).toContain('confirmLabel="Delete class"');
    expect(teacherDashboardSource).toContain("onUndo={undoDelete}");

    expect(teacherDashboardSource).not.toContain('href="#teacher-classes"');
    expect(teacherDashboardSource).not.toContain("View classes");
  });

  it("uses one accessible Manage class menu for low-frequency row actions", () => {
    const buttonSources = [...teacherDashboardSource.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(
      (match) => match[0],
    );
    const manageTrigger = buttonSources.find((button) => button.includes("Manage class"));
    const renameMenuItem = buttonSources.find(
      (button) => button.includes('role="menuitem"') && button.includes("Rename"),
    );
    const deleteMenuItem = buttonSources.find(
      (button) => button.includes('role="menuitem"') && button.includes("Delete"),
    );

    expect(manageTrigger).toBeDefined();
    expect(manageTrigger).toContain('aria-haspopup="menu"');
    expect(manageTrigger).toContain("aria-expanded=");
    expect(manageTrigger).toContain("aria-controls=");
    expect(manageTrigger).toMatch(/className=(?:"[^"]*\bbtn\b[^"]*"|\{[^}]*\bbtn\b[^}]*\})/);

    expect(teacherDashboardSource).toContain('role="menu"');
    expect(teacherDashboardSource).toMatch(
      /(?:role="menu"[\s\S]{0,250}\bid=|\bid=[\s\S]{0,250}role="menu")/,
    );
    expect(renameMenuItem).toBeDefined();
    expect(deleteMenuItem).toBeDefined();
  });

  it("keeps at most one class menu open and closes it through every expected path", () => {
    const menuState = teacherDashboardSource.match(
      /const \[(\w*[Mm]enu\w*[Ii]d),\s*(set\w+)\]\s*=\s*useState(?:<[^>]*string[^>]*>)?\((?:""|null)\)/,
    );

    expect(menuState).not.toBeNull();
    const [, openMenuId, setOpenMenuId] = menuState!;
    expect(teacherDashboardSource).toContain(`${openMenuId} === item.id`);
    expect(teacherDashboardSource).toMatch(/\.key\s*===\s*["']Escape["']/);
    expect(teacherDashboardSource).toContain("closeMenu(true)");
    expect(teacherDashboardSource).toContain("document.getElementById(triggerId)?.focus()");
    expect(teacherDashboardSource).toContain("firstItem?.focus()");
    expect(teacherDashboardSource).toContain('event.key === "ArrowDown"');
    expect(teacherDashboardSource).toContain('event.key === "ArrowUp"');
    expect(teacherDashboardSource).toContain('event.key === "Home"');
    expect(teacherDashboardSource).toContain('event.key === "End"');
    expect(teacherDashboardSource).toMatch(
      /document\.addEventListener\(["'](?:pointerdown|mousedown|click)["']/,
    );
    expect(teacherDashboardSource).toMatch(
      /document\.removeEventListener\(["'](?:pointerdown|mousedown|click)["']/,
    );

    const menuItemSources = [...teacherDashboardSource.matchAll(/<button\b[\s\S]*?<\/button>/g)]
      .map((match) => match[0])
      .filter((button) => button.includes('role="menuitem"'))
      .filter((button) => button.includes("Rename") || button.includes("Delete"));
    const closeMenu = new RegExp(
      `(?:${setOpenMenuId}\\((?:""|null)\\)|close\\w*[Mm]enu\\(\\))`,
    );

    expect(menuItemSources).toHaveLength(2);
    for (const menuItem of menuItemSources) {
      expect(menuItem).toMatch(closeMenu);
    }
    if (menuItemSources.some((menuItem) => /close\w*[Mm]enu\(\)/.test(menuItem))) {
      expect(teacherDashboardSource).toMatch(
        new RegExp(`function close\\w*[Mm]enu\\([^)]*\\)\\s*\\{[\\s\\S]*?${setOpenMenuId}\\((?:""|null)\\)`),
      );
    }
  });

  it("keeps class and grading disclosure menus clear and above neighboring panels", () => {
    expect(classWorkspaceSource).toContain("More actions");
    expect(classWorkspaceSource).toContain("Download options");
    const groupedMenus = [
      ...classWorkspaceSource.matchAll(
        /<details\b[^>]*name="teacher-class-menu"[^>]*>[\s\S]*?<\/details>/g,
      ),
    ].map((match) => match[0]);
    expect(groupedMenus.length).toBeGreaterThanOrEqual(3);
    for (const label of ["More actions", "Download options", "Student actions"]) {
      expect(groupedMenus.some((menu) => menu.includes(label))).toBe(true);
    }
    expect(classWorkspaceSource.match(/workspace-more-chevron/g)?.length).toBeGreaterThanOrEqual(2);
    expect(styles).toMatch(/\.route-stage-teacher \.teacher-class-header\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?z-index:\s*20;[\s\S]*?overflow:\s*visible;/);
    expect(styles).toMatch(/\.route-stage-teacher \.assignment-main\s*\{[\s\S]*?overflow:\s*visible;/);
    expect(styles).toMatch(/\.workspace-more-popover\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?z-index:\s*12;/);
    expect(styles.match(/overflow-x:\s*clip;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(styles).toContain("animation: fade-up 0.3s ease backwards;");
    expect(styles).toContain("animation: teacher-route-settle 180ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;");
    expect(styles).toMatch(/@keyframes fade-up\s*\{[\s\S]*?to\s*\{[^}]*transform:\s*none;/);
    expect(styles).toMatch(/@keyframes teacher-route-settle\s*\{[\s\S]*?to\s*\{[^}]*transform:\s*none;/);
    expect(styles).toMatch(/html\.dark \.btn-ghost:hover,[\s\S]*?background:\s*var\(--primary-soft\);[\s\S]*?color:\s*var\(--primary\);/);
  });

  it("uses correct invariant grading-count labels", () => {
    expect(classWorkspaceSource).toContain("{workspaceStats.pending} to grade");
    expect(classWorkspaceSource).toContain("`${assignment.ungradedCount} to grade`");
    expect(classWorkspaceSource).not.toContain("{activeAssignment.ungradedCount} ungraded");
    expect(teacherDashboardSource).toContain("`${status.pending} to grade`");
    expect(teacherDashboardSource).toContain('pluralize(totals.classCount, "class", "classes")');
    expect(teacherDashboardSource).toContain("Loading classes...");
    expect(classWorkspaceSource).not.toContain('pluralize(workspaceStats.pending, "to grade")');
    expect(classWorkspaceSource).not.toContain('pluralize(activeAssignment.ungradedCount, "ungraded")');
  });

  it("links tabs to their panels and supports standard keyboard navigation", () => {
    expect(classWorkspaceSource).toContain("onKeyDown={handleAssignmentTabKeyDown}");
    expect(classWorkspaceSource).toContain('aria-controls="assignment-review-panel"');
    expect(classWorkspaceSource).toContain('aria-controls="assignment-details-panel"');
    expect(classWorkspaceSource).toContain('aria-controls="assignment-share-panel"');
    expect(classWorkspaceSource).toContain('aria-labelledby="assignment-review-tab"');
    expect(classWorkspaceSource).toContain('aria-labelledby="assignment-details-tab"');
    expect(classWorkspaceSource).toContain('aria-labelledby="assignment-share-tab"');
    expect(classWorkspaceSource).toContain('["ArrowLeft", "ArrowRight", "Home", "End"]');
    expect(classWorkspaceSource).toContain('event.key === "ArrowRight"');
    expect(classWorkspaceSource).toContain('event.key === "Home"');
    expect(classWorkspaceSource).toContain('event.key === "End"');
    expect(classWorkspaceSource).toContain('aria-selected={assignmentView === "review"}');
    expect(classWorkspaceSource).toContain('tabIndex={assignmentView === "review" ? 0 : -1}');
  });

  it("keeps Classwork and Roster as URL-backed, mutually exclusive workspace views", () => {
    expect(classWorkspaceSource).toContain(
      'const workspaceView = searchParams.get("view") === "roster" ? "roster" : "classwork";',
    );
    expect(classWorkspaceSource).toContain(
      'const requestedAssignmentId = searchParams.get("assignment")?.trim() ?? "";',
    );
    expect(classWorkspaceSource).toContain(
      'const requestedSubmissionId = searchParams.get("submission")?.trim() ?? "";',
    );
    expect(classWorkspaceSource).toContain("const updateWorkspaceUrl = useCallback");
    expect(classWorkspaceSource).toContain('if (nextUrl === currentUrl) return;');
    expect(classWorkspaceSource).toContain('historyMode === "replace" ? "replaceState" : "pushState"');

    expect(classWorkspaceSource).toContain('aria-label="Class workspace sections"');
    expect(classWorkspaceSource).toContain('workspaceView === "classwork" ? styles.viewTabActive');
    expect(classWorkspaceSource).toContain('workspaceView === "roster" ? styles.viewTabActive');
    expect(classWorkspaceSource).toContain('onClick={() => updateWorkspaceUrl({ view: null })}');
    expect(classWorkspaceSource).toContain('onClick={() => updateWorkspaceUrl({ view: "roster" })}');
    expect(classWorkspaceSource).toMatch(
      /\{workspaceView === "classwork" \? \(\s*assignmentViews\.length === 0 \? \(/,
    );
    expect(classWorkspaceSource).toMatch(
      /\{workspaceView === "roster" \? \(\s*<section id="roster"/,
    );
    expect(classWorkspaceSource).toContain(
      'if (!classId || workspaceView !== "roster") return;',
    );
    expect(classWorkspaceSource).not.toContain("void loadRoster(targetClassId)");
    expect(classWorkspaceSource).not.toContain('href="#roster"');
  });

  it("routes the roster hub into the dedicated roster workspace", () => {
    expect(rosterHubSource).toContain('href={`/teacher/class/${roster.id}?view=roster`}');
    expect(rosterHubSource).not.toContain("#roster");
  });

  it("uses an assignment selector that updates the URL and clears stale submission focus", () => {
    const assignmentSelector = classWorkspaceSource.match(
      /<select\b(?=[^>]*\bid="assignment-selector")[^>]*>[\s\S]*?<\/select>/,
    )?.[0];

    expect(assignmentSelector).toBeDefined();
    expect(assignmentSelector).toContain('value={activeAssignment?.id ?? ""}');
    expect(assignmentSelector).toContain("setSelectedAssignmentId(event.target.value)");
    expect(assignmentSelector).toContain('setAssignmentView("review")');
    expect(assignmentSelector).toContain('setStudentFilter("")');
    expect(assignmentSelector).toContain("setShowUngradedOnly(false)");
    expect(assignmentSelector).toContain('disabled={bulkAiWorkflowActive}');
    expect(classWorkspaceSource).toContain('<label htmlFor="assignment-selector">Assignment</label>');
    expect(assignmentSelector).toContain(
      "updateWorkspaceUrl({ view: null, assignment: event.target.value, submission: null })",
    );
    expect(classWorkspaceSource).toContain(
      "assignmentViews.find((assignment) => assignment.id === requestedAssignmentId)",
    );
    expect(classWorkspaceSource).toContain(
      "const nextAssignmentId = requestedAssignment?.id ?? assignmentViews[0].id;",
    );
    expect(classWorkspaceSource).toContain(
      'updateWorkspaceUrl({ assignment: nextAssignmentId, submission: null }, "replace")',
    );
  });

  it("renders a submission queue and only one focused grading card at a time", () => {
    const queue = classWorkspaceSource.match(
      /<aside\b(?=[^>]*className=\{styles\.submissionQueue\})(?=[^>]*aria-label="Submission queue")[^>]*>[\s\S]*?<\/aside>/,
    )?.[0];

    expect(queue).toBeDefined();
    expect(queue).toContain("Choose one to grade");
    expect(queue).toContain("activeFilteredSubmissions.map((submission, index) => {");
    expect(queue).toContain("submission: submission.id");

    expect(classWorkspaceSource).toContain("const focusedSubmission =");
    expect(classWorkspaceSource).toMatch(/focusedSubmission \? \[focusedSubmission\]\.map/);
    expect(classWorkspaceSource).not.toContain(
      "activeFilteredSubmissions.map((submission) => {",
    );
    expect(classWorkspaceSource.match(/className="card submission-card"/g)).toHaveLength(1);

    expect(classWorkspaceSource).toContain("const previousSubmission =");
    expect(classWorkspaceSource).toContain("const nextSubmission =");
    expect(classWorkspaceSource).toContain("Student {focusedSubmissionIndex + 1} of {activeFilteredSubmissions.length}");
    expect(classWorkspaceSource).toContain("submission: previousSubmission.id");
    expect(classWorkspaceSource).toContain("submission: nextSubmission.id");
    expect(classWorkspaceSource).toContain("disabled={!previousSubmission}");
    expect(classWorkspaceSource).toContain("disabled={!nextSubmission}");
    expect(classWorkspaceSource).toContain("ref={submissionQueueListRef}");
    expect(classWorkspaceSource).toContain("data-submission-id={submission.id}");

    expect(classWorkspaceSource).toContain("Student actions");
    expect(classWorkspaceSource).toContain("Rename student");
    expect(classWorkspaceSource).toContain("Delete submission");
  });

  it("keeps unsaved grading work visible and warns before leaving", () => {
    expect(classWorkspaceSource).toContain("function unsavedDraftCountForAssignment");
    expect(classWorkspaceSource).toContain("const hasUnsavedDrafts = assignmentViews.some");
    expect(classWorkspaceSource).toContain('window.addEventListener("beforeunload", warnBeforeLeaving)');
    expect(classWorkspaceSource).toContain('window.removeEventListener("beforeunload", warnBeforeLeaving)');
    expect(classWorkspaceSource).toContain('{isDirty ? "Unsaved"');
    expect(classWorkspaceSource).toContain('${unsavedCount} unsaved`');
  });

  it("reconciles only clean drafts after a successful batch save", () => {
    const batchSaveHandler = classWorkspaceSource.match(
      /async function saveReviewedBulkAiGrades[\s\S]*?\n  async function downloadAllSavedTranscripts/,
    )?.[0];

    expect(batchSaveHandler).toBeDefined();
    expect(batchSaveHandler).toContain("cleanBatchSavedDraftIds({");
    expect(batchSaveHandler).toContain("batchItems: result.batch.items");
    expect(batchSaveHandler).toContain("drafts,");
    expect(batchSaveHandler).toContain("applyBatchSavedGrades({");
    expect(batchSaveHandler).toContain("mergeGradingDraftsFromServer({");
    expect(batchSaveHandler).toMatch(
      /loadData\(classId,\s*\{[\s\S]*?background:\s*true,[\s\S]*?resetDraftSubmissionIds/,
    );
  });

  it("preserves roster, grading, transcript, download, edit, and delete workflows", () => {
    const requiredHandlers = [
      "async function handleAddStudent()",
      "async function handleRemoveStudent(studentEmail: string)",
      "async function handleCsvUpload",
      "async function saveSubmission(submissionId: string)",
      "async function saveSubmissionName(submission: SubmissionItem)",
      "async function aiGradeSubmission(submissionId: string)",
      "async function openBulkAiConfirm(assignmentId: string)",
      "async function runBulkAiGrade(preflight: BulkAiPreflight)",
      "async function downloadAllSavedTranscripts()",
      "async function openBulkTranscriptConfirm()",
      "async function generateAndDownloadTranscripts()",
      "function openAssignmentEditModal()",
      "async function saveAssignmentEdit()",
      "function deleteAssignment(assignment: AssignmentView)",
      "function deleteSubmission(submission: SubmissionItem)",
      "function undoDelete()",
    ];
    for (const handler of requiredHandlers) {
      expect(classWorkspaceSource).toContain(handler);
    }

    const requiredApiPaths = [
      "/api/classes/${targetClassId}/roster",
      "/api/classes/${classId}/roster",
      "/api/classes/${classId}/roster/bulk",
      "/api/classes/${classId}/roster/${encodeURIComponent(studentEmail)}",
      "/api/classes/${targetClassId}/students/${encodeURIComponent(email)}",
      "/api/submissions/${submissionId}",
      "/api/submissions/${submissionId}/ai-grade",
      "/api/assignments/${assignmentId}/ai-grade-all",
      "/api/assignments/${activeAssignment.id}",
      "/api/assignments/${assignment.id}",
      "/api/submissions/${submission.id}",
    ];
    for (const path of requiredApiPaths) {
      expect(classWorkspaceSource).toContain(path);
    }

    expect(classWorkspaceSource).toContain("prepareBulkTranscriptDownload");
    expect(classWorkspaceSource).toContain("preflightBulkTranscripts");
    expect(classWorkspaceSource).toContain("runBulkTranscriptRequests");
    expect(classWorkspaceSource).toContain("<AudioPlayer");
    expect(classWorkspaceSource).toContain("<GoogleDriveExportButton");
    expect(classWorkspaceSource).toContain("<SubmissionTranscript");
    expect(classWorkspaceSource).toContain("Save grade");
    expect(classWorkspaceSource).toContain("Edit assignment");
    expect(classWorkspaceSource).toContain("onUndo={undoDelete}");

    const requiredControlBindings = [
      "onClick={() => void saveSubmission(submission.id)}",
      "onClick={() => void aiGradeSubmission(submission.id)}",
      "onClick={() => void openBulkAiConfirm(activeAssignment.id)}",
      "onClick={() => void openBulkTranscriptConfirm()}",
      "onClick={() => void downloadAllSavedTranscripts()}",
      "onClick={() => void saveSubmissionName(submission)}",
      "onClick={() => void handleAddStudent()}",
      "onChange={(event) => void handleCsvUpload(event)}",
      "onClick={() => void handleRemoveStudent(entry.studentEmail)}",
      "onClick={() => void copyStudentLink(activeAssignment.id)}",
      "onClick={() => copyAssignment(activeAssignment)}",
      "onClick={() => void pasteAssignment()}",
      'href={`/api/classes/${payload.item.id}/gradebook.csv`}',
      "<StudentOralPortfolio",
    ];
    for (const binding of requiredControlBindings) {
      expect(classWorkspaceSource).toContain(binding);
    }
  });
});
