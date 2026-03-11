import { NextResponse } from "next/server";
import { requireAuthenticatedEmail } from "@/lib/authz";
import { getUserRoleByEmail, redeemTeacherOnboardingCode } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { onboardingRedeemSchema, parseOrThrow400 } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApiHandler(request, async () => {
    const email = await requireAuthenticatedEmail();
    const currentRole = await getUserRoleByEmail(email);
    if (currentRole === "teacher") {
      return NextResponse.json({ ok: true, role: "teacher" });
    }

    const body = parseOrThrow400(onboardingRedeemSchema, await request.json());
    const result = await redeemTeacherOnboardingCode(body.code ?? "", email);

    if (result === "invalid") {
      throw new HttpError(400, "That code didn't work — double-check it and try again.");
    }
    if (result === "used") {
      throw new HttpError(400, "That code has already been used.");
    }

    return NextResponse.json({ ok: true, role: "teacher" });
  });
}
