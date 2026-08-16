import { NextResponse } from "next/server";
import { requireSchoolStudentEmail } from "@/lib/authz";
import { uploadSubmissionAudio } from "@/lib/audio-storage";
import {
  countStudentSubmissions,
  createSubmission,
  findAssignmentById,
  isStudentOnRoster,
  upsertRosterEntry,
} from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { enforceSubmissionRateLimit } from "@/lib/rate-limit";
import { getEnv } from "@/lib/env";
import { parseAudioDataUrl, parseOrThrow400, submissionCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

function emailDomain(email: string) {
  const [, domain = ""] = email.toLowerCase().split("@");
  return domain.trim();
}

function shouldEnforceStudentDomain() {
  return process.env.ENFORCE_STUDENT_DOMAIN === "true";
}

function shouldRequireRosterForSubmissions() {
  return process.env.REQUIRE_ROSTER_FOR_SUBMISSIONS === "true";
}

function isPublicBlobStoreError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("cannot use private access on a public store")
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  return withApiHandler(request, async () => {
    const { assignmentId } = await context.params;
    const assignment = await findAssignmentById(assignmentId);
    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    const studentEmail = await requireSchoolStudentEmail();
    const bypassEnabled =
      process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_BYPASS_AUTH === "true";
    const enforcedDomain = (process.env.STUDENT_DOMAIN || emailDomain(assignment.ownerEmail)).trim().toLowerCase();
    const studentDomain = emailDomain(studentEmail);
    if (
      !bypassEnabled &&
      shouldEnforceStudentDomain() &&
      enforcedDomain &&
      studentDomain !== enforcedDomain
    ) {
      throw new HttpError(
        403,
        "This class only accepts submissions from the configured school email domain."
      );
    }

    if (!bypassEnabled && shouldRequireRosterForSubmissions()) {
      const onRoster = await isStudentOnRoster(assignment.classId, studentEmail);
      if (!onRoster) {
        throw new HttpError(403, "This assignment only accepts submissions from students on the class roster.");
      }
    }

    await enforceSubmissionRateLimit(studentEmail);

    if (assignment.maxSubmissions > 0) {
      const existing = await countStudentSubmissions(assignmentId, studentEmail);
      if (existing >= assignment.maxSubmissions) {
        throw new HttpError(
          403,
          `You have reached the maximum of ${assignment.maxSubmissions} submission${assignment.maxSubmissions === 1 ? "" : "s"} for this assignment. Delete a previous submission to submit again.`
        );
      }
    }

    const body = parseOrThrow400(submissionCreateSchema, await request.json());
    const studentName = body.studentName ?? "";
    const parsedAudio = parseAudioDataUrl(body.audioData);
    const submissionId = `sub_${crypto.randomUUID()}`;
    let audioBlobUrl = "";
    try {
      audioBlobUrl = await uploadSubmissionAudio({
        assignmentId,
        submissionId,
        mimeType: parsedAudio.mimeType,
        buffer: parsedAudio.buffer,
      });
    } catch (error) {
      if (getEnv().isDev || isPublicBlobStoreError(error)) {
        // Fallback keeps submissions functional while production Blob is public-only.
        // Playback and AI access still go through authenticated server routes.
        audioBlobUrl = body.audioData;
      } else {
        console.warn("Audio upload failed for submission upload", {
          assignmentId,
          errorName: error instanceof Error ? error.name : "unknown",
          errorMessage: error instanceof Error ? error.message : "unknown",
        });
        throw new HttpError(
          503,
          "We couldn't upload your recording right now. If you're on a school network, try opening this link on your phone or switching connections."
        );
      }
    }

    const created = await createSubmission({
      assignmentId,
      studentName,
      studentEmail,
      audioBlobUrl,
    });

    upsertRosterEntry({
      classId: assignment.classId,
      studentEmail,
      studentName,
      addedBy: "submission",
    }).catch((error: unknown) => {
      console.error("roster upsert failed", error);
    });

    return NextResponse.json({ item: created }, { status: 201 });
  });
}
