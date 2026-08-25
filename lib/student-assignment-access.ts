import "server-only";
import { isStudentOnRoster } from "@/lib/db";
import { HttpError } from "@/lib/http";

function emailDomain(email: string) {
  const [, domain = ""] = email.toLowerCase().split("@");
  return domain.trim();
}

export async function enforceStudentAssignmentAccessPolicy(input: {
  classId: string;
  ownerEmail: string;
  studentEmail: string;
}) {
  const bypassEnabled =
    process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_BYPASS_AUTH === "true";
  const enforcedDomain = (
    process.env.STUDENT_DOMAIN || emailDomain(input.ownerEmail)
  ).trim().toLowerCase();

  if (
    !bypassEnabled &&
    process.env.ENFORCE_STUDENT_DOMAIN === "true" &&
    enforcedDomain &&
    emailDomain(input.studentEmail) !== enforcedDomain
  ) {
    throw new HttpError(
      403,
      "This class only accepts submissions from the configured school email domain."
    );
  }

  if (!bypassEnabled && process.env.REQUIRE_ROSTER_FOR_SUBMISSIONS === "true") {
    const onRoster = await isStudentOnRoster(input.classId, input.studentEmail);
    if (!onRoster) {
      throw new HttpError(
        403,
        "This assignment only accepts submissions from students on the class roster."
      );
    }
  }
}
