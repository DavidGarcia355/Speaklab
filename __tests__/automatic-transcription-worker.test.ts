import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimJobs: vi.fn(),
  findAssignment: vi.fn(),
  findSubmission: vi.fn(),
  isJobActive: vi.fn(),
  settleJob: vi.fn(),
  getAiConfig: vi.fn(),
  assertProviderConfig: vi.fn(),
  isTeacherDenied: vi.fn(),
  transcribeOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  claimAutomaticTranscriptionJobs: mocks.claimJobs,
  findAssignmentById: mocks.findAssignment,
  findOwnedSubmissionForAiReview: mocks.findSubmission,
  isAutomaticTranscriptionJobActive: mocks.isJobActive,
  settleAutomaticTranscriptionJob: mocks.settleJob,
}));

vi.mock("@/lib/ai/config", () => ({
  getAiConfig: mocks.getAiConfig,
  assertAiTranscriptionProviderConfig: mocks.assertProviderConfig,
  isAiTeacherDenied: mocks.isTeacherDenied,
}));

vi.mock("@/lib/ai/transcript-one", () => ({
  transcribeOneSubmission: mocks.transcribeOne,
}));

import { processAutomaticTranscriptionJobs } from "@/lib/ai/automatic-transcription";

const job = {
  id: "atj_1",
  submissionId: "sub_1",
  assignmentId: "asg_1",
  teacherEmail: "teacher@example.com",
  status: "processing" as const,
  attemptCount: 1,
  leaseToken: "lease_1",
};

describe("automatic transcription worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimJobs.mockResolvedValue([job]);
    mocks.findAssignment.mockResolvedValue({ id: job.assignmentId, autoTranscribe: true });
    mocks.findSubmission.mockResolvedValue({
      submissionId: job.submissionId,
      assignmentId: job.assignmentId,
    });
    mocks.isJobActive.mockResolvedValue(true);
    mocks.getAiConfig.mockReturnValue({ enabled: true });
    mocks.isTeacherDenied.mockReturnValue(false);
    mocks.settleJob.mockResolvedValue(true);
    mocks.transcribeOne.mockResolvedValue({ status: "completed", item: { id: "tr_1" } });
  });

  it("completes a queued transcript through the existing idempotent processor", async () => {
    await expect(processAutomaticTranscriptionJobs({ limit: 2 })).resolves.toEqual({
      claimed: 1,
      completed: 1,
      retried: 0,
      paused: 0,
      failed: 0,
      cancelled: 0,
    });

    expect(mocks.claimJobs).toHaveBeenCalledWith({ limit: 2 });
    expect(mocks.transcribeOne).toHaveBeenCalledWith(expect.objectContaining({
      teacherEmail: job.teacherEmail,
      data: expect.objectContaining({ submissionId: job.submissionId }),
      processingStillAuthorized: expect.any(Function),
    }));
    const authorizationCheck = mocks.transcribeOne.mock.calls[0]?.[0]
      ?.processingStillAuthorized as (() => Promise<boolean>) | undefined;
    await expect(authorizationCheck?.()).resolves.toBe(true);
    expect(mocks.isJobActive).toHaveBeenCalledWith({ id: job.id, leaseToken: job.leaseToken });
    expect(mocks.settleJob).toHaveBeenCalledWith(expect.objectContaining({
      id: job.id,
      leaseToken: job.leaseToken,
      status: "completed",
    }));
  });

  it("cancels without provider work when the assignment is deleted or switched off", async () => {
    mocks.findAssignment.mockResolvedValue({ id: job.assignmentId, autoTranscribe: false });

    await expect(processAutomaticTranscriptionJobs()).resolves.toMatchObject({ cancelled: 1 });
    expect(mocks.findSubmission).not.toHaveBeenCalled();
    expect(mocks.transcribeOne).not.toHaveBeenCalled();
    expect(mocks.settleJob).toHaveBeenCalledWith(expect.objectContaining({
      status: "cancelled",
      errorCode: "automatic_transcription_disabled",
    }));
  });

  it("pauses before provider work when AI access or provider configuration is unavailable", async () => {
    mocks.getAiConfig.mockReturnValue({ enabled: false });

    await expect(processAutomaticTranscriptionJobs()).resolves.toMatchObject({ paused: 1 });
    expect(mocks.assertProviderConfig).not.toHaveBeenCalled();
    expect(mocks.transcribeOne).not.toHaveBeenCalled();
    expect(mocks.settleJob).toHaveBeenCalledWith(expect.objectContaining({
      status: "paused",
      errorCode: "automatic_transcription_unavailable",
      nextAttemptAt: expect.any(Number),
    }));
  });

  it("pauses atomically when the allowance is exhausted", async () => {
    mocks.transcribeOne.mockResolvedValue({
      status: "failed",
      code: "ai_review_limit_reached",
      message: "Allowance reached.",
    });

    await expect(processAutomaticTranscriptionJobs()).resolves.toMatchObject({ paused: 1 });
    expect(mocks.settleJob).toHaveBeenCalledWith(expect.objectContaining({
      status: "paused",
      errorCode: "ai_review_limit_reached",
    }));
  });

  it.each([
    "usage_limit_reached",
    "provider_spend_limit",
    "provider_configuration",
    "provider_rate_limit",
  ])("pauses recoverable %s failures instead of exhausting retries", async (code) => {
    mocks.transcribeOne.mockResolvedValue({
      status: "failed",
      code,
      message: "Temporarily unavailable.",
    });

    await expect(processAutomaticTranscriptionJobs()).resolves.toMatchObject({ paused: 1 });
    expect(mocks.settleJob).toHaveBeenCalledWith(expect.objectContaining({
      status: "paused",
      errorCode: code,
      nextAttemptAt: expect.any(Number),
    }));
  });

  it("fails unusable audio permanently without retrying it", async () => {
    mocks.transcribeOne.mockResolvedValue({
      status: "failed",
      code: "no_speech_detected",
      message: "No speech.",
    });

    await expect(processAutomaticTranscriptionJobs()).resolves.toMatchObject({ failed: 1 });
    expect(mocks.settleJob).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      errorCode: "no_speech_detected",
    }));
  });

  it("fails legacy public-storage audio without pointless provider retries", async () => {
    mocks.transcribeOne.mockResolvedValue({
      status: "failed",
      code: "audio_storage_migration_required",
      message: "Storage update required.",
    });

    await expect(processAutomaticTranscriptionJobs()).resolves.toMatchObject({ failed: 1 });
    expect(mocks.settleJob).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      errorCode: "audio_storage_migration_required",
    }));
  });

  it("retries an in-flight race, then stops retrying at the bounded attempt cap", async () => {
    mocks.transcribeOne.mockResolvedValue({
      status: "failed",
      code: "ai_review_in_progress",
      message: "Already processing.",
    });

    await expect(processAutomaticTranscriptionJobs()).resolves.toMatchObject({ retried: 1 });
    expect(mocks.settleJob).toHaveBeenCalledWith(expect.objectContaining({
      status: "retry",
      errorCode: "ai_review_in_progress",
      nextAttemptAt: expect.any(Number),
    }));

    mocks.claimJobs.mockResolvedValue([{ ...job, attemptCount: 4, leaseToken: "lease_4" }]);
    await expect(processAutomaticTranscriptionJobs()).resolves.toMatchObject({ failed: 1 });
    expect(mocks.settleJob).toHaveBeenLastCalledWith(expect.objectContaining({
      leaseToken: "lease_4",
      status: "failed",
    }));
  });

  it("settles a toggle-off race as cancelled rather than failed", async () => {
    mocks.transcribeOne.mockResolvedValue({
      status: "failed",
      code: "processing_cancelled",
      message: "Automatic transcription was turned off.",
    });

    await expect(processAutomaticTranscriptionJobs()).resolves.toMatchObject({ cancelled: 1 });
    expect(mocks.settleJob).toHaveBeenCalledWith(expect.objectContaining({
      status: "cancelled",
      errorCode: "processing_cancelled",
    }));
  });
});
