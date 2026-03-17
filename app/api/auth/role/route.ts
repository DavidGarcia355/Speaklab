import { NextResponse } from "next/server";
import { requireAuthenticatedEmail } from "@/lib/authz";
import { getUserRoleByEmail, setUserRoleTeacher } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    const email = await requireAuthenticatedEmail();
    const role = await getUserRoleByEmail(email);
    return NextResponse.json({ email, role });
  });
}

export async function POST(request: Request) {
  return withApiHandler(request, async () => {
    const email = await requireAuthenticatedEmail();
    const body = (await request.json()) as { role?: string };

    if (body.role !== "teacher") {
      throw new HttpError(400, "Only teacher self-registration is supported right now.");
    }

    await setUserRoleTeacher(email);
    const role = await getUserRoleByEmail(email);
    return NextResponse.json({ email, role });
  });
}
