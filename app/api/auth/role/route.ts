import { NextResponse } from "next/server";
import { requireAuthenticatedEmail } from "@/lib/authz";
import { getUserRoleByEmail } from "@/lib/db";
import { withApiHandler } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiHandler(request, async () => {
    const email = await requireAuthenticatedEmail();
    const role = await getUserRoleByEmail(email);
    return NextResponse.json({ email, role });
  });
}
