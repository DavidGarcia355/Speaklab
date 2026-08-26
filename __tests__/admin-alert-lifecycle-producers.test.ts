import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deriveAdminAlertIdentity: vi.fn(),
  enqueueAdminAlert: vi.fn(),
  isInternalTestEmail: vi.fn(),
}));

vi.mock("@/lib/admin-alerts", () => ({
  deriveAdminAlertIdentity: mocks.deriveAdminAlertIdentity,
  enqueueAdminAlert: mocks.enqueueAdminAlert,
}));

vi.mock("@/lib/internal-accounts", () => ({
  isInternalTestEmail: mocks.isInternalTestEmail,
}));

import {
  enqueueFirstAssignmentPublishedAlert,
  enqueueFirstClassCreatedAlert,
  enqueueFirstRecordingReceivedAlert,
  enqueueSchoolLeadAlert,
  enqueueSuccessfulAiReviewAlerts,
  enqueueTeacherSignedUpAlert,
} from "@/lib/admin-alert-lifecycle";

describe("admin alert lifecycle producers", () => {
  beforeEach(() => {
    mocks.deriveAdminAlertIdentity.mockReset().mockImplementation((kind: string) => ({
      ref: kind === "lead" ? "L-ABCDEF123456" : "T-ABCDEF123456",
      dedupeSubject: `${kind}:opaque-subject`,
    }));
    mocks.enqueueAdminAlert.mockReset().mockResolvedValue({ inserted: true });
    mocks.isInternalTestEmail.mockReset().mockReturnValue(false);
  });

  it("emits signup, first-class, and first-assignment events with opaque dedupe keys", async () => {
    await enqueueTeacherSignedUpAlert({
      teacherEmail: "Teacher@Example.com",
      source: "direct",
    });
    await enqueueFirstClassCreatedAlert({
      teacherEmail: "Teacher@Example.com",
      teacherJoinedAt: 1_000,
      classCreatedAt: 121_000,
    });
    await enqueueFirstAssignmentPublishedAlert({
      teacherEmail: "Teacher@Example.com",
      teacherJoinedAt: 1_000,
      assignmentCreatedAt: 181_000,
    });

    expect(mocks.enqueueAdminAlert).toHaveBeenNthCalledWith(
      1,
      {
        type: "teacher.signed_up",
        teacherRef: "T-ABCDEF123456",
        source: "direct",
      },
      { dedupeKey: "teacher:opaque-subject:teacher-signed-up" },
    );
    expect(mocks.enqueueAdminAlert).toHaveBeenNthCalledWith(
      2,
      {
        type: "class.first_created",
        teacherRef: "T-ABCDEF123456",
        minutesFromSignup: 2,
      },
      { dedupeKey: "teacher:opaque-subject:first-class" },
    );
    expect(mocks.enqueueAdminAlert).toHaveBeenNthCalledWith(
      3,
      {
        type: "assignment.first_published",
        teacherRef: "T-ABCDEF123456",
        minutesFromSignup: 3,
      },
      { dedupeKey: "teacher:opaque-subject:first-assignment" },
    );
    expect(JSON.stringify(mocks.enqueueAdminAlert.mock.calls)).not.toContain(
      "teacher@example.com",
    );
  });

  it("emits the first recording and activation without student data", async () => {
    await enqueueFirstRecordingReceivedAlert({
      teacherEmail: "teacher@example.com",
      teacherJoinedAt: 1_000,
      assignmentCreatedAt: 61_000,
      recordingCreatedAt: 181_000,
    });

    expect(mocks.enqueueAdminAlert).toHaveBeenCalledWith(
      {
        type: "recording.first_received",
        teacherRef: "T-ABCDEF123456",
        minutesFromAssignment: 2,
      },
      { dedupeKey: "teacher:opaque-subject:first-recording" },
    );
    expect(mocks.enqueueAdminAlert).toHaveBeenCalledWith(
      {
        type: "teacher.activated",
        teacherRef: "T-ABCDEF123456",
        minutesToActivation: 3,
      },
      { dedupeKey: "teacher:opaque-subject:teacher-activated" },
    );
  });

  it("emits a usable first review and both exact free-trial thresholds at exhaustion", async () => {
    await enqueueSuccessfulAiReviewAlerts({
      teacherEmail: "teacher@example.com",
      teacherJoinedAt: 1_000,
      durationSeconds: 75,
      estimatedCostMicrousd: 25_000,
      allowance: { status: "free_lifetime", used: 30, consumed: 30, limit: 30 },
      completedAt: 172_801_000,
    });

    expect(mocks.enqueueAdminAlert).toHaveBeenCalledWith(
      {
        type: "ai.first_review",
        teacherRef: "T-ABCDEF123456",
        durationBucket: "1_to_2_minutes",
        estimatedCostCents: 3,
      },
      { dedupeKey: "teacher:opaque-subject:first-ai-review" },
    );
    expect(mocks.enqueueAdminAlert).toHaveBeenCalledWith(
      {
        type: "trial.half_used",
        teacherRef: "T-ABCDEF123456",
        used: 15,
        limit: 30,
      },
      { dedupeKey: "teacher:opaque-subject:trial-half-used" },
    );
    expect(mocks.enqueueAdminAlert).toHaveBeenCalledWith(
      {
        type: "trial.exhausted",
        teacherRef: "T-ABCDEF123456",
        daysSinceSignup: 2,
        upgradeStatus: "free",
      },
      { dedupeKey: "teacher:opaque-subject:trial-exhausted" },
    );
  });

  it("does not classify paid allowance usage as a free-trial threshold", async () => {
    await enqueueSuccessfulAiReviewAlerts({
      teacherEmail: "teacher@example.com",
      teacherJoinedAt: 1,
      durationSeconds: 20,
      estimatedCostMicrousd: 0,
      allowance: { status: "manual_lifetime", used: 300, limit: 300 },
    });

    expect(mocks.enqueueAdminAlert).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueAdminAlert).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ai.first_review" }),
      expect.any(Object),
    );
  });

  it("emits the 250 and 300 paid-period signals only after delivered usage", async () => {
    await enqueueSuccessfulAiReviewAlerts({
      teacherEmail: "teacher@example.com",
      teacherJoinedAt: 1,
      durationSeconds: 20,
      estimatedCostMicrousd: 0,
      allowance: {
        status: "teacher_period",
        used: 300,
        consumed: 300,
        limit: 300,
      },
    });

    expect(mocks.enqueueAdminAlert).toHaveBeenCalledWith(
      {
        type: "allowance.near_limit",
        teacherRef: "T-ABCDEF123456",
        used: 250,
        limit: 300,
      },
      { dedupeKey: "teacher:opaque-subject:allowance-near-limit" },
    );
    expect(mocks.enqueueAdminAlert).toHaveBeenCalledWith(
      {
        type: "allowance.exhausted",
        teacherRef: "T-ABCDEF123456",
        used: 300,
        limit: 300,
        outreachState: "not_started",
        adminPath: "/admin",
      },
      { dedupeKey: "teacher:opaque-subject:allowance-exhausted" },
    );
  });

  it("does not count an in-flight reservation as delivered threshold usage", async () => {
    await enqueueSuccessfulAiReviewAlerts({
      teacherEmail: "teacher@example.com",
      teacherJoinedAt: 1,
      durationSeconds: 20,
      estimatedCostMicrousd: 0,
      allowance: {
        status: "teacher_period",
        used: 300,
        consumed: 249,
        limit: 300,
      },
    });

    expect(mocks.enqueueAdminAlert).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueAdminAlert).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ai.first_review" }),
      expect.any(Object),
    );
  });

  it("keeps school leads opaque and behind the protected admin route", async () => {
    await enqueueSchoolLeadAlert({
      feedbackId: "fb_opaque_1",
    });

    expect(mocks.deriveAdminAlertIdentity).toHaveBeenCalledWith("lead", "fb_opaque_1");
    expect(mocks.enqueueAdminAlert).toHaveBeenCalledWith(
      {
        type: "school.lead",
        leadRef: "L-ABCDEF123456",
        adminPath: "/admin",
      },
      { dedupeKey: "lead:opaque-subject:school-lead" },
    );
  });

  it("swallows persistence failure with a PII-free diagnostic", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.enqueueAdminAlert.mockRejectedValue(new Error("database unavailable"));

    await expect(
      enqueueTeacherSignedUpAlert({ teacherEmail: "private@example.com" }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith("Admin alert enqueue failed", {
      code: "admin_alert_enqueue_failed",
      eventType: "teacher.signed_up",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private@example.com");
    warn.mockRestore();
  });

  it("excludes known internal test accounts", async () => {
    mocks.isInternalTestEmail.mockReturnValue(true);

    await enqueueTeacherSignedUpAlert({ teacherEmail: "internal@example.com" });

    expect(mocks.deriveAdminAlertIdentity).not.toHaveBeenCalled();
    expect(mocks.enqueueAdminAlert).not.toHaveBeenCalled();
  });
});
