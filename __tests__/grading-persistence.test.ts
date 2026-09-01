import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { processedAssignmentFingerprint } from "@/lib/ai/recording-identity";
import { legacyAssignmentToGradingAssignment } from "@/lib/grading/legacy-adapter";

const localDbPath = path.join(os.tmpdir(), "speaklab-grading-persistence-test.db");

async function loadDbModule() {
  vi.resetModules();
  return import("@/lib/db");
}

type DbModule = Awaited<ReturnType<typeof loadDbModule>>;

async function createFixture(db: DbModule, label: string) {
  const teacherEmail = `${label}@example.com`;
  const createdClass = await db.createClass(`${label} Class`, teacherEmail);
  const assignment = await db.createAssignment({
    classId: createdClass.id,
    ownerEmail: teacherEmail,
    title: `${label} Assignment`,
    description: "Synthetic grading persistence fixture.",
    instructions: "Give a short answer.",
    maxPoints: 10,
    maxSubmissions: 0,
    maxRecordingSeconds: 180,
    rubric: null,
    attachmentName: "",
    attachmentUrl: "",
    attachmentContentType: "",
  });
  const submission = await db.createSubmission({
    assignmentId: assignment.id,
    studentName: "Synthetic Student",
    studentEmail: `${label}-student@example.com`,
    audioBlobUrl: `submissions/${label}/answer.webm`,
  });
  return { assignment, teacherEmail, submission };
}

describe("grading persistence", () => {
  let db: DbModule;

  beforeAll(async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.HABLA_LOCAL_DB_PATH = localDbPath;
    fs.rmSync(localDbPath, { force: true });
    db = await loadDbModule();
  });

  it("round-trips owner-scoped, unexpired grading results", async () => {
    const { teacherEmail, submission } = await createFixture(db, "cache-owner");
    const now = Date.UTC(2026, 7, 20, 12);
    const cached = await db.upsertGradingResultCache({
      cacheKey: "cache-key-1",
      submissionId: submission.id,
      teacherEmail,
      resultJson: JSON.stringify({ score: 8, maximumScore: 10 }),
      provider: "mock",
      model: "mock-grader-v1",
      promptVersion: "prompt-v1",
      expiresAt: now + 60_000,
      now,
    });

    expect(cached).toMatchObject({
      cacheKey: "cache-key-1",
      submissionId: submission.id,
      teacherEmail,
      provider: "mock",
      model: "mock-grader-v1",
      promptVersion: "prompt-v1",
    });
    await expect(
      db.findValidGradingResultCache("cache-key-1", "other-teacher@example.com", now)
    ).resolves.toBeNull();
    await expect(
      db.findValidGradingResultCache("cache-key-1", teacherEmail, now + 60_000)
    ).resolves.toBeNull();
  });

  it("rejects assignment point reductions below an existing saved grade", async () => {
    const { assignment, teacherEmail, submission } = await createFixture(db, "points-owner");
    await db.updateSubmission(submission.id, teacherEmail, {
      studentName: submission.studentName,
      grade: 9,
      feedback: "Saved teacher grade.",
      rubricScores: null,
    });

    const update = {
      title: assignment.title,
      description: assignment.description,
      instructions: assignment.instructions,
      targetLanguage: assignment.targetLanguage,
      maxPoints: 8,
      maxSubmissions: assignment.maxSubmissions,
      maxRecordingSeconds: assignment.maxRecordingSeconds,
      rubric: assignment.rubric,
      attachmentName: assignment.attachmentName,
      attachmentUrl: assignment.attachmentUrl,
      attachmentContentType: assignment.attachmentContentType,
      autoTranscribe: assignment.autoTranscribe,
    };

    await expect(
      db.updateAssignment(assignment.id, teacherEmail, update)
    ).rejects.toThrow("saved grade of 9");
    await expect(db.findAssignmentById(assignment.id, teacherEmail)).resolves.toMatchObject({
      maxPoints: 10,
    });

    await expect(
      db.updateAssignment(assignment.id, teacherEmail, { ...update, maxPoints: 9 })
    ).resolves.toMatchObject({ maxPoints: 9 });
  });

  it("rechecks the submission limit inside the insertion transaction", async () => {
    const teacherEmail = "limit-owner@example.com";
    const createdClass = await db.createClass("Limit Class", teacherEmail);
    const assignment = await db.createAssignment({
      classId: createdClass.id,
      ownerEmail: teacherEmail,
      title: "One attempt",
      description: "",
      instructions: "Speak once.",
      maxPoints: 10,
      maxSubmissions: 1,
      maxRecordingSeconds: 180,
      rubric: null,
      attachmentName: "",
      attachmentUrl: "",
      attachmentContentType: "",
    });

    await db.createSubmission({
      id: "sub_limit_a",
      assignmentId: assignment.id,
      studentName: "Student",
      studentEmail: "limit-student@example.com",
      audioBlobUrl: "submissions/limit/a.webm",
    });

    await expect(
      db.createSubmission({
        id: "sub_limit_b",
        assignmentId: assignment.id,
        studentName: "Student",
        studentEmail: "limit-student@example.com",
        audioBlobUrl: "submissions/limit/b.webm",
      })
    ).rejects.toMatchObject({ name: "SubmissionLimitReachedError" });
    await expect(
      db.countStudentSubmissions(assignment.id, "limit-student@example.com")
    ).resolves.toBe(1);
  });

  it("persists extended attempt metadata without weakening owner-scoped reads", async () => {
    const { assignment, teacherEmail, submission } = await createFixture(db, "attempt-owner");
    const attempt = await db.createAiGradingAttempt({
      submissionId: submission.id,
      teacherEmail,
      status: "completed",
      transcript: "Synthetic answer.",
      detectedLanguage: "English",
      transcriptQuality: "good",
      durationSeconds: 4,
      suggestedScore: 8,
      rubricScores: [],
      feedback: "Synthetic feedback.",
      strengths: [],
      improvements: [],
      evidence: ["Synthetic answer"],
      confidence: "high",
      warnings: [],
      teacherAttention: "review",
      transcriptionProvider: "mock",
      gradingProvider: "mock",
      transcriptionModel: "mock-transcriber-v1",
      gradingModel: "mock-grader-v1",
      cacheKey: "attempt-cache-key",
      assignmentFingerprint: processedAssignmentFingerprint(
        legacyAssignmentToGradingAssignment({
          submissionId: submission.id,
          assignmentId: assignment.id,
          assignmentTitle: assignment.title,
          audioBlobUrl: submission.audioBlobUrl,
          description: assignment.description,
          instructions: assignment.instructions,
          targetLanguage: assignment.targetLanguage,
          rubric: assignment.rubric,
          maxPoints: assignment.maxPoints,
          finalGrade: null,
          finalFeedback: "",
        }),
      ),
      cacheHit: true,
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 20,
      latencyMs: 250,
      retries: 1,
      escalated: true,
      escalationReason: "low_confidence",
      estimatedCostMicrousd: 123,
      promptVersion: "prompt-v1",
      resultSource: "escalation",
    });

    expect(attempt).toMatchObject({ cacheHit: true, inputTokens: 100, estimatedCostMicrousd: 123 });
    await expect(
      db.markAiGradingAttemptNotApplicable({
        attemptId: attempt.id,
        ownerEmail: teacherEmail,
      }),
    ).resolves.toBe(true);
    await expect(db.listAiGradingAttemptsForSubmission(submission.id, teacherEmail)).resolves.toEqual([
      expect.objectContaining({
        id: attempt.id,
        deliveryStatus: "not_applicable",
        cacheKey: "attempt-cache-key",
        cachedInputTokens: 40,
        outputTokens: 20,
        retries: 1,
        escalated: true,
        escalationReason: "low_confidence",
        promptVersion: "prompt-v1",
        resultSource: "escalation",
      }),
    ]);
    await expect(
      db.listAiGradingAttemptsForSubmission(submission.id, "other-teacher@example.com")
    ).resolves.toEqual([]);
  });

  it("records owner-scoped provider metadata and aggregates exact integer usage", async () => {
    const { teacherEmail, submission } = await createFixture(db, "usage-owner");
    const now = Date.UTC(2026, 7, 20, 12);

    await expect(
      db.recordGradingProviderRequest({
        submissionId: submission.id,
        teacherEmail: "other-teacher@example.com",
        requestStage: "cheap_grade",
        provider: "mock",
        model: "mock-grader-v1",
      })
    ).resolves.toBeNull();

    const request = await db.recordGradingProviderRequest({
      submissionId: submission.id,
      teacherEmail,
      requestStage: "cheap_grade",
      provider: "mock",
      model: "mock-grader-v1",
      providerRequestId: "provider-request-1",
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 20,
      latencyMs: 250,
      retries: 1,
      escalated: true,
      escalationReason: "verification_disagreement",
      estimatedCostMicrousd: 123,
      promptVersion: "prompt-v1",
      createdAt: now,
    });

    expect(request).toMatchObject({
      teacherEmail,
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 20,
      estimatedCostMicrousd: 123,
    });
    await expect(db.listGradingProviderRequestsForSubmission(submission.id, teacherEmail)).resolves.toEqual([
      expect.objectContaining({ id: request?.id, providerRequestId: "provider-request-1" }),
    ]);
    await expect(db.getTeacherGradingUsageSince(teacherEmail, now - 1)).resolves.toEqual({
      requestCount: 1,
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 20,
      latencyMs: 250,
      retries: 1,
      escalations: 1,
      estimatedCostMicrousd: 123,
    });
    await expect(db.getTeacherGradingUsageForUtcMonth(teacherEmail, now)).resolves.toMatchObject({
      requestCount: 1,
      estimatedCostMicrousd: 123,
    });
  });

  it("deletes expired cache entries and provider metadata past its retention cutoff", async () => {
    const { teacherEmail, submission } = await createFixture(db, "retention-owner");
    const now = Date.UTC(2026, 7, 20, 12);
    await db.upsertGradingResultCache({
      cacheKey: "retention-cache-key",
      submissionId: submission.id,
      teacherEmail,
      resultJson: JSON.stringify({ score: 7 }),
      expiresAt: now + 10,
      now,
    });
    await db.recordGradingProviderRequest({
      submissionId: submission.id,
      teacherEmail,
      requestStage: "cheap_grade",
      provider: "mock",
      model: "mock-grader-v1",
      createdAt: now,
    });

    const cleanup = await db.cleanupGradingPersistence({
      now: now + 10,
      providerRequestCutoff: now + 1,
    });
    expect(cleanup.cacheEntriesDeleted).toBe(1);
    expect(cleanup.providerRequestsDeleted).toBeGreaterThanOrEqual(1);
    await expect(db.findValidGradingResultCache("retention-cache-key", teacherEmail, now)).resolves.toBeNull();
    await expect(db.listGradingProviderRequestsForSubmission(submission.id, teacherEmail)).resolves.toEqual([]);
  });
});
