import { NextResponse } from "next/server";
import { requireAdminEmail } from "@/lib/admin";
import { setUserPaid } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { parseOrThrow400 } from "@/lib/validation";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({ isPaid: z.boolean() });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ email: string }> }
) {
  return withApiHandler(request, async () => {
    const { allowed } = await requireAdminEmail();
    if (!allowed) throw new HttpError(403, "Forbidden");

    const { email } = await context.params;
    const { isPaid } = parseOrThrow400(bodySchema, await request.json());

    const updated = await setUserPaid(decodeURIComponent(email), isPaid);
    if (!updated) throw new HttpError(404, "Teacher not found.");

    return NextResponse.json({ ok: true, isPaid });
  });
}
